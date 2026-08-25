/**
 * The half of the fuzzer that runs inside the throwaway process.
 *
 * Everything here executes generated input, which is the part that can die.
 * That is why it is a separate process with a small heap: an out-of-memory
 * abort is a data point the parent records and recovers from, rather than the
 * end of the session. `scripts/fuzz.mjs` is the parent, and this is what it
 * bundles and spawns.
 *
 * The two sides talk over stdout in newline-delimited JSON, plus one small
 * heartbeat file. The heartbeat is what makes a hang reportable: a wedged
 * process cannot tell anyone what it is stuck on, so it writes down what it is
 * about to do before doing it, and the parent reads that after killing it.
 *
 * @module Runner
 */

import * as fs from "node:fs";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { buildVocabulary, type Vocabulary } from "@tools/fuzz/Vocabulary";
import { generateExpressionCase, generateSeedExpressions } from "@tools/fuzz/ExpressionFuzzer";
import { buildMutationPool, generateBytecodeCase } from "@tools/fuzz/BytecodeFuzzer";
import { runCase, type OracleOptions } from "@tools/fuzz/Oracle";
import { isFailure, type FuzzCase, type Outcome } from "@tools/fuzz/FuzzCase";

// Re-exported so a one-off investigation can drive the same oracle this file
// drives, through the same bundle, rather than building a second entry point
// that could disagree with it about what a case does.
export { runCase } from "@tools/fuzz/Oracle";

/** Which generator a run is exercising. */
export type Generator = "bytecode" | "expression";

/** Parsed command line. */
interface RunnerArgs {
	mode: "soak" | "verify" | "generate";
	generator: Generator;
	seed: number;
	count: number;
	heartbeat?: string;
	input?: string;
	/** Only for `generate`: where to write the generated case. */
	out?: string;
	slowMs: number;
	/** Only for `verify`: the outcome kind the caller is trying to reproduce. */
	expect?: string;
	/** Only for `verify`: the thrown constructor name or error code to match alongside it. */
	expectDetail?: string;
}

/** Read `--name=value` pairs off the command line. */
function parseArgs(argv: readonly string[]): RunnerArgs {
	const values = new Map<string, string>();
	for (const arg of argv) {
		const match = /^--([^=]+)=(.*)$/.exec(arg);
		if (match) values.set(match[1], match[2]);
	}
	return {
		mode: (values.get("mode") as RunnerArgs["mode"]) ?? "soak",
		generator: (values.get("generator") as Generator) ?? "bytecode",
		seed: Number(values.get("seed") ?? 1),
		count: Number(values.get("count") ?? 1000),
		heartbeat: values.get("heartbeat"),
		input: values.get("input"),
		out: values.get("out"),
		slowMs: Number(values.get("slowMs") ?? 250),
		expect: values.get("expect"),
		expectDetail: values.get("expectDetail"),
	};
}

/**
 * Emit one protocol line to the parent.
 *
 * `fs.writeSync` rather than `process.stdout.write`, because stdout here is a
 * pipe and a pipe is asynchronous: buffered lines are lost when the process is
 * killed, and the lines that matter most are the ones written just before
 * something goes wrong. Writing straight to the descriptor also means the
 * process can exit the instant it decides to, with nothing left queued, which
 * is what makes {@link shutdown} reliable.
 *
 * An `EAGAIN` from a full pipe is retried rather than thrown: the parent drains
 * continuously, so a full pipe is a momentary condition, and losing the run over
 * it would be absurd.
 */
function emit(record: object): void {
	const line = `${JSON.stringify(record)}\n`;
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			fs.writeSync(1, line);
			return;
		} catch (thrown) {
			if ((thrown as { code?: string }).code !== "EAGAIN") return;
		}
	}
}

/**
 * Cut the process off from the network, deterministically.
 *
 * Three packages resolve through `fetch`, and a fuzz run reaches them by
 * accident constantly. Left alone the run would be slow, non-deterministic and
 * dependent on whether the machine is online, none of which is a property a
 * reproducer can have. Rejecting is the honest stub: being offline is a state
 * the engine already has to handle, so the failure path exercised here is a
 * real one.
 */
function disableNetwork(): void {
	const globals = globalThis as { fetch?: unknown };
	globals.fetch = () => Promise.reject(new Error("fuzz: network is disabled in this process"));
}

/**
 * Keep an async failure from ending the run, while still reporting it.
 *
 * An unhandled rejection terminates Node by default, which would arrive at the
 * parent looking exactly like a crash caused by the case in flight. Some of
 * those rejections are genuine findings (a resolver that never attaches a
 * handler), so they are reported as their own kind of event rather than
 * swallowed, and the run continues so one of them does not cost the rest of the
 * soak.
 */
function reportAsyncFailures(): void {
	process.on("unhandledRejection", (reason) => {
		emit({ t: "async", detail: describe(reason) });
	});
	process.on("uncaughtException", (error) => {
		emit({ t: "async", detail: `uncaught: ${describe(error)}` });
	});
}

/** A one-line description of an arbitrary thrown value. */
function describe(thrown: unknown): string {
	if (thrown instanceof Error) return `${thrown.constructor.name}: ${thrown.message}`;
	return String(thrown);
}

/**
 * How wide a heartbeat record is, padded, so a rewrite always covers the last one.
 *
 * The file is overwritten in place at offset zero rather than truncated and
 * recreated, so a shorter record than the one before it would leave the tail of
 * the old one behind and the parent would read a mixture of two. Padding to a
 * fixed width makes every write cover the whole record. JSON tolerates the
 * trailing spaces, so the parent needs to know nothing about this.
 */
const HEARTBEAT_WIDTH = 96;

/** The descriptor the heartbeat is written through, opened once. */
let heartbeatFd: number | null = null;

/**
 * What the parent needs to know if this process stops answering.
 *
 * Written before every case. A file rather than a stdout line because a hang
 * has to be diagnosable after the process is killed, and this is the only thing
 * that survives that.
 *
 * Through a descriptor opened once rather than `writeFileSync`, which opens and
 * closes every time. That measured at roughly three milliseconds a call on
 * Windows, which is more than a bytecode case costs to generate and run: the
 * first version of this spent fifty-seven seconds of a fifty-nine second run
 * recording where it was rather than going there.
 */
function writeHeartbeat(pathName: string | undefined, index: number, seed: number, generator: Generator): void {
	if (!pathName) return;
	if (heartbeatFd === null) heartbeatFd = fs.openSync(pathName, "w");
	const record = JSON.stringify({ index, seed, generator }).padEnd(HEARTBEAT_WIDTH, " ");
	fs.writeSync(heartbeatFd, record, 0, "utf8");
}

/** Everything a generator needs, built once per process. */
interface RunContext {
	engine: ExpressionEngine;
	/** Null in `verify` mode, which never generates and so never reads it. */
	vocabulary: Vocabulary | null;
	mutationPool: { programs: ReturnType<typeof buildMutationPool>["programs"]; origins: string[] };
	oracle: OracleOptions;
}

/**
 * Build the per-process state a run needs.
 *
 * The engine is constructed once and cleared before each case rather than
 * rebuilt, because construction registers twenty packages and would dominate
 * the run. `Oracle.runExpressionCase()` clears it, which is what keeps a case
 * reproducible on its own.
 *
 * @param generator - Which fuzzer is running. The mutation pool is only built
 * for the bytecode one, since compiling a few dozen expressions is wasted work
 * otherwise.
 * @param slowMs - The soft budget above which a completed case is reported slow.
 * @param needsGenerators - Whether this process is going to generate cases.
 * `verify` mode is handed a case that already exists, and building a vocabulary
 * and a mutation pool it will never draw from is most of that process's
 * lifetime. Shrinking spawns one of these per candidate, hundreds of times, so
 * the saving is the difference between a shrink taking seconds and minutes.
 * @returns The context.
 */
export function buildRunContext(generator: Generator, slowMs: number, needsGenerators = true): RunContext {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const empty = { programs: [], origins: [] };
	if (!needsGenerators) {
		return { engine, vocabulary: null, mutationPool: empty, oracle: { slowMs } };
	}
	const vocabulary = buildVocabulary(engine);
	const mutationPool = generator === "bytecode"
		? buildMutationPool(engine, generateSeedExpressions(1, 60, vocabulary))
		: empty;
	return { engine, vocabulary, mutationPool, oracle: { slowMs } };
}

/**
 * Generate the case a given seed stands for.
 *
 * Kept as one function so the parent, the shrinker and the Jest suite all agree
 * on what a seed means. A seed that generated one thing in a soak and another
 * in a replay would make every recorded seed a lie.
 *
 * @param generator - Which fuzzer.
 * @param seed - The seed.
 * @param context - Per-process state.
 * @returns The case.
 */
export function caseForSeed(generator: Generator, seed: number, context: RunContext): FuzzCase {
	if (!context.vocabulary) throw new Error("this context was built without generators");
	if (generator === "expression") return generateExpressionCase(seed, context.vocabulary);
	return generateBytecodeCase(seed, {
		mutationPool: context.mutationPool.programs,
		mutationOrigins: context.mutationPool.origins,
	});
}

/** Run a block of seeds, reporting findings as they happen. */
function soak(args: RunnerArgs): void {
	const context = buildRunContext(args.generator, args.slowMs);
	// Announce readiness only after construction, which takes long enough that
	// the parent's watchdog would otherwise count it against the first case.
	emit({ t: "ready", seed: args.seed, count: args.count, generator: args.generator });

	let slowCount = 0;
	for (let index = 0; index < args.count; index++) {
		const seed = args.seed + index;
		writeHeartbeat(args.heartbeat, index, seed, args.generator);

		let fuzzCase: FuzzCase;
		try {
			fuzzCase = caseForSeed(args.generator, seed, context);
		} catch (thrown) {
			// The generator itself failing is a bug in the fuzzer, not a finding
			// about the engine, and saying so plainly beats reporting it as one.
			emit({ t: "generator-error", seed, detail: describe(thrown) });
			continue;
		}

		const outcome: Outcome = runCase(fuzzCase, context.engine, context.oracle);
		if (outcome.kind === "slow") {
			slowCount++;
			emit({ t: "slow", seed, elapsedMs: outcome.elapsedMs, detail: outcome.detail, input: fuzzCase });
			continue;
		}
		if (isFailure(outcome)) {
			emit({ t: "finding", seed, outcome, input: fuzzCase });
		}

		if ((index & 0x3ff) === 0x3ff) emit({ t: "progress", done: index + 1 });
	}

	emit({ t: "done", executed: args.count, slow: slowCount });
	shutdown(context);
}

/**
 * End the process rather than waiting for it to run out of work.
 *
 * A soak reaches expressions that start an async lookup, and a cached query
 * arms a garbage-collection timer that keeps a Node process alive for ten
 * minutes on its own (the same thing that used to leave the Jest suite sitting
 * after every spec had passed, see `ExpressionEngine.clear()`'s own comment).
 * From the parent's side that is indistinguishable from a wedged case, so a
 * child that has finished says so and leaves, rather than being killed by the
 * watchdog and recorded as a hang that never happened.
 *
 * `clear()` first, so the exit is a decision rather than a way of ignoring
 * whatever is still armed.
 *
 * The exit is unconditional. An earlier version waited for a stdout flush
 * callback before exiting, and a zero-length write never delivered one, so a
 * child that had finished its whole block sat there holding the parent's
 * watchdog open. {@link emit} writes synchronously, so there is nothing left to
 * flush and nothing to wait for.
 */
function shutdown(context: RunContext): never {
	context.engine.clear();
	process.exit(0);
}

/**
 * Run one stored case and answer whether it failed in a particular way.
 *
 * This is the shrinker's predicate when the failure is one this process cannot
 * survive. The answer is the exit code rather than a stdout line, because a
 * candidate that crashes the process has no chance to print anything, and the
 * parent reads "died" as "yes, still fails".
 */
function verify(args: RunnerArgs): never {
	if (!args.input) {
		process.stderr.write("verify needs --input=<file>\n");
		process.exit(2);
	}
	const fuzzCase = JSON.parse(fs.readFileSync(args.input, "utf8")) as FuzzCase;
	const context = buildRunContext(fuzzCase.kind, args.slowMs, false);
	const outcome = runCase(fuzzCase, context.engine, context.oracle);
	emit({ t: "verdict", outcome });

	if (!args.expect) process.exit(isFailure(outcome) ? 3 : 0);
	if (outcome.kind !== args.expect) process.exit(0);
	if (args.expectDetail && (outcome.thrownName ?? outcome.code ?? "") !== args.expectDetail) process.exit(0);
	process.exit(3);
}

/**
 * Write out the case a seed stands for, without running it.
 *
 * The parent calls this after a child died, to recover the input that killed
 * it. Generation touches the engine only to build the vocabulary and the
 * mutation pool, neither of which executes generated input, so this survives
 * seeds that execution does not.
 */
function generate(args: RunnerArgs): void {
	const context = buildRunContext(args.generator, args.slowMs);
	const fuzzCase = caseForSeed(args.generator, args.seed, context);
	if (args.out) fs.writeFileSync(args.out, JSON.stringify(fuzzCase), "utf8");
	else emit({ t: "case", input: fuzzCase });
	shutdown(context);
}

/** Entry point. Reads argv, runs, exits. */
export function main(): void {
	disableNetwork();
	reportAsyncFailures();
	const args = parseArgs(process.argv.slice(2));
	if (args.mode === "verify") verify(args);
	else if (args.mode === "generate") generate(args);
	else soak(args);
}

// The bundle is built with this file as its entry, so importing it is running
// it. Guarded on argv so the module can also be imported by a test without the
// import itself starting a soak.
if (process.argv.some((arg) => arg.startsWith("--mode="))) main();
