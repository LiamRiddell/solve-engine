/**
 * One run of the `solve` command, from its arguments to its exit code.
 *
 * Everything the run needs from outside is passed in: the engine functions
 * ({@link EngineKit}) and the streams ({@link CliIO}). The bin entry passes the
 * real ones; a test passes an engine with a stub data source and collects what
 * was written, so the whole command runs in-process with nothing on the network.
 */

import type { CalendarBackend, CreateEngineOptions, DateCalendarOptions, ExpressionEngine, Value } from "solve-engine";
import type { ParsingResult } from "solve-engine/engine";
import { DEFAULT_WAIT_MS, EXIT, MAX_WAIT_MS, parseArguments, type CliOptions, type ExitCode } from "./arguments";
import { classifyInput, decodeDocument, readDocumentFile, tooLarge, MAX_INPUT_BYTES } from "./input";
import {
	checkSummary,
	documentAnswers,
	documentChecks,
	expressionDisplay,
	hasPending,
	isFailure,
	plural,
	renderRows,
	statusOf,
	type ReportedAnswer,
} from "./report";
import { escapeForTerminal, quoted } from "./terminal";

/** The engine functions a run calls, so a test can hand in its own. */
export interface EngineKit {
	/** Builds an engine, `createEngine` from `solve-engine`. */
	createEngine(options: CreateEngineOptions): ExpressionEngine;
	/** Evaluates a whole document, `evaluateDocument` from `solve-engine/engine`. */
	evaluateDocument(engine: ExpressionEngine, text: string): ParsingResult;
	/** A `Date` calendar in a named zone, `dateCalendarInZone` from `solve-engine`. */
	dateCalendarInZone(zone: string, options?: DateCalendarOptions): CalendarBackend;
	/** The engine's version, for `--version`. */
	engineVersion: string;
	/** This command's own version, for `--version`. */
	cliVersion: string;
}

/** Where a run writes, and where it reads standard input from. */
export interface CliIO {
	/** Writes to standard output. */
	out(text: string): void;
	/** Writes to standard error. */
	err(text: string): void;
	/** Reads standard input, stopping once more than `limit` bytes have arrived. */
	readStdin(limit: number): Promise<Uint8Array>;
	/** The zone the machine is in, for `--now` given without `--tz`. */
	systemZone(): string;
}

/** The most times a run re-evaluates while waiting for live values, whatever the wait. */
const MAX_SETTLE_ROUNDS = 8;

/** The help text, `solve --help`. */
export const HELP = `solve: evaluate a Solve expression or document from the command line.

Usage:
  solve [options] <expression>     evaluate one expression: solve "5 km in miles"
  solve [options] <file>           evaluate a document, one answer per line
  solve [options] -                read the document from standard input
  solve check [options] <file|->   report the document's check lines, and exit 1 if any fails

Options:
  --json             print one JSON object instead of text
  --tz <zone>        read dates in this IANA time zone, such as Europe/London
  --now <instant>    the moment "today" and "now" read: 2026-01-01T09:00:00Z, or milliseconds since 1970
  --seed <value>     make random draws the same on every run
  --network on|off   allow or refuse live data (weather, rates, prices); on unless given
  --wait <ms>        how long to wait for live data, 0 to ${MAX_WAIT_MS}; ${DEFAULT_WAIT_MS} unless given
  --strict           count a line the engine could not read as a failure
  -e, --expression   read the words as an expression, even when one names a file
  -h, --help         show this help
  -V, --version      show the version

Exit status: 0 when every line answered (or every check passed), 1 when a line
failed or a check did not pass, 2 when the command could not run as asked.
`;

/**
 * Runs the command once.
 *
 * The engine is cleared before this returns, whatever happened, so no timer or
 * cached query it armed outlives the run; the bin entry then exits explicitly.
 *
 * @param argv - The arguments after the program name.
 * @param io - Where to write and read.
 * @param kit - The engine functions to call.
 * @returns The exit code: {@link EXIT}.
 */
export async function run(argv: readonly string[], io: CliIO, kit: EngineKit): Promise<ExitCode> {
	const parsed = parseArguments(argv);
	if (!parsed.ok) return usage(io, parsed.message);
	const options = parsed.options;
	if (options.command === "help") {
		io.out(HELP);
		return EXIT.OK;
	}
	if (options.command === "version") {
		io.out(`solve ${kit.cliVersion} (solve-engine ${kit.engineVersion})\n`);
		return EXIT.OK;
	}

	const input = classifyInput(options.positionals, options.forceExpression);
	if (input.kind === "refused") return usage(io, input.message);
	if (options.command === "check" && input.kind === "expression") {
		return usage(io, `solve check reads a document, and ${quoted(input.text)} is not a file.`);
	}

	let text: string;
	let name: string;
	if (input.kind === "expression") {
		text = input.text;
		name = "the expression";
	} else if (input.kind === "stdin") {
		const bytes = await io.readStdin(MAX_INPUT_BYTES);
		name = "standard input";
		if (bytes.length > MAX_INPUT_BYTES) return usage(io, tooLarge(name, MAX_INPUT_BYTES));
		const decoded = decodeDocument(bytes, name);
		if (!decoded.ok) return usage(io, decoded.message);
		text = decoded.text;
	} else {
		const read = readDocumentFile(input.path);
		if (!read.ok) return usage(io, read.message);
		text = read.text;
		name = quoted(input.path);
	}

	const built = buildEngine(options, io, kit);
	if (!built.ok) return usage(io, built.message);
	const engine = built.engine;
	try {
		if (input.kind === "expression") return await runExpression(engine, text, options, io);
		return await runDocument(engine, text, name, options, io, kit);
	} catch (error) {
		return usage(io, `${name} could not be evaluated: ${messageOf(error)}`);
	} finally {
		// The query cache arms a collection timer per fetched value, ten
		// minutes long, which keeps Node running after the answer is printed.
		// clear() releases every one, and a waiting settle() with them.
		engine.clear();
	}
}

/** Writes a usage error and returns its exit code. */
function usage(io: CliIO, message: string): ExitCode {
	io.err(`solve: ${escapeForTerminal(message)}\n`);
	return EXIT.USAGE;
}

/** A thrown value's message, whatever was thrown. */
function messageOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** A thrown value's code, when it carries one. */
function codeOf(error: unknown): string | null {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : null;
}

/** The engine the options describe, or why it could not be built. */
function buildEngine(options: CliOptions, io: CliIO, kit: EngineKit): { ok: true; engine: ExpressionEngine } | { ok: false; message: string } {
	const engineOptions: CreateEngineOptions = {};
	if (options.network !== undefined) engineOptions.config = { network: { enabled: options.network } };
	if (options.seed !== undefined) engineOptions.random = { seed: options.seed };
	if (options.tz !== undefined || options.now !== undefined) {
		const zone = options.tz ?? io.systemZone();
		if (!isKnownZone(zone)) {
			return { ok: false, message: `--tz ${quoted(zone)} is not a time zone this machine knows. Give an IANA name, such as Europe/London or America/New_York.` };
		}
		const now = options.now;
		try {
			engineOptions.calendar = kit.dateCalendarInZone(zone, now === undefined ? {} : { now: () => now });
		} catch (error) {
			return { ok: false, message: `--tz ${quoted(zone)} could not be used: ${messageOf(error)}` };
		}
	}
	const engine = kit.createEngine(engineOptions);
	// The run reads a live value by evaluating again once it has settled, so
	// it needs no per-line push; wiring an empty one tells the engine a host
	// is listening, and it does not warn that nobody is.
	engine.getBatcher().onLineResult = () => {};
	return { ok: true, engine };
}

/** Whether this runtime can compute in a zone. */
export function isKnownZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat("en", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/**
 * Evaluates, and while anything is still waiting for live data, waits for it
 * to settle and evaluates again, within the one deadline the run was given.
 *
 * `settle` waits for the fetches already started; a value whose first fetch
 * reveals a second needs another round, which is why this loops. The rounds
 * are capped as well as the time, so a data source that starts a new fetch on
 * every run cannot keep the loop turning until the deadline.
 */
async function evaluateSettled<T>(engine: ExpressionEngine, evaluate: () => T, pending: (result: T) => boolean, waitMs: number): Promise<T> {
	const deadline = Date.now() + waitMs;
	let result = evaluate();
	for (let round = 0; round < MAX_SETTLE_ROUNDS && pending(result); round++) {
		const left = deadline - Date.now();
		if (left <= 0) break;
		try {
			await engine.settle({ timeoutMs: left });
		} catch (error) {
			if (codeOf(error) !== "SETTLE_TIMEOUT") throw error;
			return evaluate();
		}
		result = evaluate();
	}
	return result;
}

/** One expression's outcome: a value, or the error that stopped it being read. */
type ExpressionOutcome = { value: Value } | { error: unknown };

/** Evaluates one expression and writes its answer. */
async function runExpression(engine: ExpressionEngine, text: string, options: CliOptions, io: CliIO): Promise<ExitCode> {
	const outcome = await evaluateSettled<ExpressionOutcome>(
		engine,
		() => {
			try {
				return { value: engine.evaluateExpression(text) };
			} catch (error) {
				return { error };
			}
		},
		(o) => "value" in o && o.value.isPending(),
		options.waitMs,
	);

	let answer: ReportedAnswer;
	if ("value" in outcome) {
		const status = statusOf(outcome.value);
		answer = {
			line: 1,
			text,
			status,
			display: status === "pending" ? `no answer from live data within ${options.waitMs} ms` : engine.formatValue(outcome.value),
			code: status === "answered" ? null : outcome.value.errorCode ?? null,
			value: outcome.value.toJSON(),
		};
	} else {
		answer = { line: 1, text, status: "not-read", display: messageOf(outcome.error), code: codeOf(outcome.error), value: null };
	}

	// An expression the engine could not read is a failure here, strict or
	// not: the command was asked for this expression, not handed a note that
	// may hold prose.
	const failed = answer.status !== "answered";
	const exit = failed ? EXIT.FAILED : EXIT.OK;
	if (options.json) {
		io.out(`${JSON.stringify({ expression: text, status: answer.status, display: answer.display, code: answer.code, value: answer.value, exitCode: exit }, null, 2)}\n`);
	} else if (failed) {
		const label = answer.status === "pending" ? "pending" : "error";
		const message = escapeForTerminal(answer.display);
		io.err(message.startsWith("check failed") ? `${message}\n` : `${label}: ${message}\n`);
	} else {
		io.out(`${escapeForTerminal(expressionDisplay(answer.display))}\n`);
	}
	return exit;
}

/** Evaluates a document and writes its answers, or, for `solve check`, its checks. */
async function runDocument(engine: ExpressionEngine, text: string, name: string, options: CliOptions, io: CliIO, kit: EngineKit): Promise<ExitCode> {
	const result = await evaluateSettled(engine, () => kit.evaluateDocument(engine, text), hasPending, options.waitMs);
	const format = (value: Value) => engine.formatValue(value);

	if (options.command === "check") {
		const checks = documentChecks(result, format, options.waitMs);
		const exit = checks.every((c) => c.status === "passed") ? EXIT.OK : EXIT.FAILED;
		if (options.json) {
			const count = (s: string) => checks.filter((c) => c.status === s).length;
			const summary = { passed: count("passed"), failed: count("failed"), unevaluated: count("error") + count("not-read"), pending: count("pending") };
			io.out(`${JSON.stringify({ checks, ...summary, exitCode: exit }, null, 2)}\n`);
		} else if (checks.length === 0) {
			io.out(`No check lines in ${name}.\n`);
		} else {
			io.out(renderRows(checks));
			io.out(`${checkSummary(checks)}\n`);
		}
		return exit;
	}

	const answers = documentAnswers(result, format, options.waitMs);
	const failures = answers.filter((a) => isFailure(a, options.strict));
	const exit = failures.length > 0 ? EXIT.FAILED : EXIT.OK;
	if (options.json) {
		io.out(`${JSON.stringify({ lines: answers, failed: failures.length, exitCode: exit }, null, 2)}\n`);
	} else {
		io.out(renderRows(answers, (a) => a.status !== "not-read" || options.strict));
		const failedLines = new Set(failures.map((a) => a.line)).size;
		if (failedLines > 0) io.err(`solve: ${plural(failedLines, "line")} in ${name} failed.\n`);
	}
	return exit;
}
