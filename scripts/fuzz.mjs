/**
 * The fuzzer's soak mode: many iterations, random seeds, in a process that is
 * allowed to die.
 *
 * The work itself happens in a child (`packages/engine/tools/fuzz/Runner.ts`,
 * bundled on the fly). This file never executes generated input. That division
 * is the whole point: the inputs here are designed to break things, and two of
 * the three failures worth finding cannot be observed from inside the process
 * suffering them.
 *
 * - An out-of-memory abort is uncatchable. V8 ends the process; no `try` in the
 *   engine, the runner or Jest contains it. Seen from here it is an exit code,
 *   and the heartbeat file names the case that caused it.
 * - A hang cannot report itself. A wedged synchronous loop never reaches
 *   another line of its own code, so nothing inside can time it out. Seen from
 *   here it is a heartbeat that stopped advancing.
 *
 * The child therefore gets a small heap (`--max-old-space-size`), so that an
 * allocation bug aborts quickly and cheaply instead of taking the machine's
 * memory with it, and the parent restarts it and carries on from the next seed.
 *
 * Usage:
 *   npm run fuzz                                  both generators, random seeds
 *   npm run fuzz -- --generator=bytecode          one generator only
 *   npm run fuzz -- --seed=12345 --count=50000    a specific run, reproducibly
 *   npm run fuzz -- --minutes=10                  run for a wall-clock budget
 *   npm run fuzz -- --no-save                     do not write to the corpus
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineRoot = path.join(repoRoot, "packages", "engine");
const corpusDirectory = path.join(engineRoot, "__tests__", "fuzz", "corpus");
const buildDirectory = path.join(repoRoot, "node_modules", ".cache", "solve-fuzz");

// ── Command line ──────────────────────────────────────────────────────────

const args = new Map();
for (const arg of process.argv.slice(2)) {
	const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
	if (match) args.set(match[1], match[2] ?? "true");
}

const options = {
	generators: args.has("generator") ? [args.get("generator")] : ["bytecode", "expression"],
	seed: args.has("seed") ? Number(args.get("seed")) : null,
	count: Number(args.get("count") ?? 20000),
	minutes: args.has("minutes") ? Number(args.get("minutes")) : 0,
	// Per-case wall clock. A case that takes longer than this is a hang as far
	// as anyone waiting on the engine is concerned, whatever it is doing.
	caseTimeoutMs: Number(args.get("caseTimeout") ?? 5000),
	slowMs: Number(args.get("slowMs") ?? 250),
	// Wall clock for reducing one finding. Generous, because a good reproducer
	// is most of a finding's value, but bounded, because a run that spends
	// twenty minutes on one shrink stops being a soak.
	shrinkMs: Number(args.get("shrinkMs") ?? 120000),
	heapMb: Number(args.get("heap") ?? 256),
	save: args.get("save") !== "false" && !args.has("no-save"),
	shrink: !args.has("no-shrink"),
};

// ── Build ─────────────────────────────────────────────────────────────────

/**
 * Resolve this repo's own path aliases for esbuild.
 *
 * The engine source is written against `@solve-js/*` and the fuzzer against
 * `@tools/*`, neither of which is a real package. Jest maps them through
 * `moduleNameMapper`; a bundle needs the same mapping, expressed here rather
 * than through `tsconfig` `paths` so that one file describes the whole build.
 */
function aliasPlugin() {
	const roots = [
		["@solve-js/", path.join(engineRoot, "src")],
		["@tools/", path.join(engineRoot, "tools")],
	];
	return {
		name: "solve-aliases",
		setup(build) {
			build.onResolve({ filter: /^@(solve-js|tools)\// }, (candidate) => {
				for (const [prefix, root] of roots) {
					if (!candidate.path.startsWith(prefix)) continue;
					const base = path.join(root, candidate.path.slice(prefix.length));
					for (const suffix of [".ts", ".tsx", "/index.ts", ".js", ""]) {
						const full = base + suffix;
						if (fs.existsSync(full) && fs.statSync(full).isFile()) return { path: full };
					}
					return { path: base };
				}
				return null;
			});
			// The compilation worker is imported for its side-effect-free
			// factory and never started here. Bundling the real one would pull
			// in a module that touches `self` at load time, which does not exist
			// in a plain Node process, so it is stubbed exactly as the Jest run
			// stubs it.
			build.onResolve({ filter: /\.worker$/ }, () => ({ path: "solve-fuzz-worker-stub", namespace: "stub" }));
			build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
				contents: "export default function createWorker() { throw new Error('workers are not available in the fuzz process'); }",
				loader: "js",
			}));
		},
	};
}

/** Bundle the runner, returning the path to the built file. */
async function buildRunner() {
	const esbuild = require("esbuild");
	fs.mkdirSync(buildDirectory, { recursive: true });
	const outfile = path.join(buildDirectory, "runner.mjs");
	await esbuild.build({
		entryPoints: [path.join(engineRoot, "tools", "fuzz", "Runner.ts")],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		// Sourcemaps would make a crash report readable, but they also make V8
		// hold the map in memory, and this child is deliberately heap-starved.
		sourcemap: false,
		logLevel: "warning",
		plugins: [aliasPlugin()],
	});
	return outfile;
}

// ── Child supervision ─────────────────────────────────────────────────────

/**
 * Run one block of seeds in a fresh, heap-limited child.
 *
 * Resolves with what the block produced, including the reason it stopped. The
 * caller decides whether to continue from the next seed.
 */
function runBlock(runner, generator, seed, count, heartbeatFile) {
	return new Promise((resolve) => {
		try {
			fs.rmSync(heartbeatFile, { force: true });
		} catch {
			// A stale heartbeat that cannot be removed is not worth stopping for.
		}

		const child = spawn(
			process.execPath,
			[
				`--max-old-space-size=${options.heapMb}`,
				runner,
				"--mode=soak",
				`--generator=${generator}`,
				`--seed=${seed}`,
				`--count=${count}`,
				`--heartbeat=${heartbeatFile}`,
				`--slowMs=${options.slowMs}`,
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);

		const findings = [];
		const slow = [];
		const asyncFailures = [];
		let executed = 0;
		let lastHeartbeat = readHeartbeat(heartbeatFile);
		let lastProgressAt = Date.now();
		let stderr = "";
		let buffer = "";
		let settled = false;

		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearInterval(watchdog);
			resolve(result);
		};

		// The watchdog reads the heartbeat rather than the child's stdout,
		// because stdout is buffered: a child in a tight synchronous loop has
		// nothing to flush, and one that dies loses whatever it had queued.
		const watchdog = setInterval(() => {
			const beat = readHeartbeat(heartbeatFile);
			if (beat && (!lastHeartbeat || beat.index !== lastHeartbeat.index)) {
				lastHeartbeat = beat;
				lastProgressAt = Date.now();
				return;
			}
			if (Date.now() - lastProgressAt > options.caseTimeoutMs) {
				child.kill("SIGKILL");
				finish({ stopped: "hang", inFlight: lastHeartbeat, findings, slow, asyncFailures, executed, stderr });
			}
		}, 250);

		child.stdout.on("data", (chunk) => {
			buffer += chunk.toString();
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (!line.trim()) continue;
				let record;
				try {
					record = JSON.parse(line);
				} catch {
					stderr += `unparsable child output: ${line}\n`;
					continue;
				}
				if (record.t === "finding") findings.push(record);
				else if (record.t === "slow") slow.push(record);
				else if (record.t === "async") asyncFailures.push(record.detail);
				else if (record.t === "progress") executed = record.done;
				else if (record.t === "done") executed = record.executed;
				else if (record.t === "generator-error") stderr += `generator error at seed ${record.seed}: ${record.detail}\n`;
				// Any protocol line is also proof of life.
				lastProgressAt = Date.now();
			}
		});

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
			lastProgressAt = Date.now();
		});

		child.on("error", (error) => {
			finish({ stopped: "spawn-error", findings, slow, asyncFailures, executed, stderr: `${stderr}${error.message}` });
		});

		child.on("exit", (code, signal) => {
			const beat = readHeartbeat(heartbeatFile);
			if (code === 0) finish({ stopped: "complete", findings, slow, asyncFailures, executed, stderr });
			else finish({ stopped: "crash", exitCode: code, signal, inFlight: beat, findings, slow, asyncFailures, executed, stderr });
		});
	});
}

/** The case a dead child was working on, or null if it never wrote one. */
function readHeartbeat(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

// ── Reproduction and shrinking ────────────────────────────────────────────

/**
 * Run one stored case in its own child and report how it ended.
 *
 * This is what makes a crash or a hang shrinkable: the predicate has to survive
 * the thing it is testing for, so it cannot run in this process.
 */
function verifyInChild(runner, fuzzCase, expect, expectDetail) {
	const inputFile = path.join(buildDirectory, `candidate-${process.pid}.json`);
	fs.writeFileSync(inputFile, JSON.stringify(fuzzCase), "utf8");
	const result = spawnSync(
		process.execPath,
		[
			`--max-old-space-size=${options.heapMb}`,
			runner,
			"--mode=verify",
			`--input=${inputFile}`,
			`--slowMs=${options.slowMs}`,
			...(expect ? [`--expect=${expect}`] : []),
			...(expectDetail ? [`--expectDetail=${expectDetail}`] : []),
		],
		{ timeout: options.caseTimeoutMs, encoding: "utf8" },
	);

	// A child that was killed for taking too long reproduces a hang. One that
	// died on its own reproduces a crash. Exit 3 is the runner saying the
	// in-process invariant broke the way the caller asked about.
	const timedOut = result.error?.code === "ETIMEDOUT" || (result.status === null && result.signal != null);
	if (timedOut) return "hang";
	if (result.status === 3) return expect ?? "failed";
	if (result.status !== 0) return "crash";
	return "ok";
}

/** Reduce a finding, using whichever predicate can observe it. */
async function shrinkFinding(runner, finding, kindOfFailure, expectDetail) {
	const { shrink } = await loadShrinkerModule();
	// A wall clock as well as an attempt budget. A candidate that hangs costs a
	// full case timeout to reject, and a case whose neighbourhood is full of
	// those turns a three-hundred-attempt budget into half an hour. Past the
	// deadline the predicate simply says no, which ends the shrink on the next
	// pass with whatever it has, rather than abandoning it.
	const deadline = Date.now() + options.shrinkMs;
	const predicate = (candidate) => {
		if (Date.now() > deadline) return false;
		return verifyInChild(runner, candidate, kindOfFailure, expectDetail) === kindOfFailure;
	};
	return shrink(finding, predicate, 300);
}

/**
 * Load the shrinker itself.
 *
 * Bundled separately from the runner because this process must not pull the
 * engine into its own heap: it is supervising a memory experiment, and being a
 * participant in it would defeat the point.
 */
let shrinkerModule = null;
async function loadShrinkerModule() {
	if (shrinkerModule) return shrinkerModule;
	const esbuild = require("esbuild");
	const outfile = path.join(buildDirectory, "shrink.mjs");
	await esbuild.build({
		entryPoints: [path.join(engineRoot, "tools", "fuzz", "Shrink.ts")],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "warning",
		plugins: [aliasPlugin()],
	});
	shrinkerModule = await import(`file://${outfile.split(path.sep).join("/")}?t=${Date.now()}`);
	return shrinkerModule;
}

/** Load the corpus writer, bundled the same way and for the same reason. */
let corpusModule = null;
async function loadCorpusModule() {
	if (corpusModule) return corpusModule;
	const esbuild = require("esbuild");
	const outfile = path.join(buildDirectory, "corpus.mjs");
	await esbuild.build({
		entryPoints: [path.join(engineRoot, "tools", "fuzz", "Corpus.ts")],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		logLevel: "warning",
		plugins: [aliasPlugin()],
	});
	corpusModule = await import(`file://${outfile.split(path.sep).join("/")}?t=${Date.now()}`);
	return corpusModule;
}

// ── Reporting ─────────────────────────────────────────────────────────────

/** A short, readable rendering of a case, for the console. */
function describeCase(fuzzCase) {
	if (!fuzzCase) return "(unknown)";
	if (fuzzCase.kind === "expression") return JSON.stringify(fuzzCase.source);
	const { opcodes, numbers, strings } = fuzzCase.program;
	const head = opcodes.slice(0, 24).join(",");
	return `opcodes=[${head}${opcodes.length > 24 ? ",..." : ""}] (${opcodes.length}) numbers=${numbers.length} strings=${strings.length}${fuzzCase.origin ? ` from ${JSON.stringify(fuzzCase.origin)}` : ""}`;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
	const runner = await buildRunner();
	const heartbeatFile = path.join(os.tmpdir(), `solve-fuzz-heartbeat-${process.pid}.json`);
	const deadline = options.minutes > 0 ? Date.now() + options.minutes * 60_000 : Infinity;
	const startSeed = options.seed ?? ((Date.now() ^ (process.pid * 2654435761)) >>> 0) % 1_000_000_000;

	const { makeEntry, saveEntry, caseId, failureSignature, loadCorpus } = await loadCorpusModule();
	const summary = { executed: 0, findings: 0, saved: 0, slow: 0, crashes: 0, hangs: 0, asyncFailures: 0 };

	// Signatures already accounted for, seeded from the committed corpus.
	//
	// Without this the run spends nearly all of its time re-shrinking the same
	// shallow bug: one bad opcode is reachable from thousands of seeds, each
	// reduction costs a few hundred child processes, and the soak stops being a
	// soak. Skipping a known signature is what lets the run get through enough
	// cases to reach something new, which is the only reason to run it at all.
	const seen = new Set();
	for (const entry of loadCorpus(corpusDirectory)) {
		seen.add(failureSignature({ kind: entry.outcome, detail: entry.detail }));
	}

	console.log(`fuzzing from seed ${startSeed}, ${options.count} cases per generator per block, heap ${options.heapMb}MB`);

	for (const generator of options.generators) {
		let seed = startSeed;
		let remaining = options.count;

		while (remaining > 0 && Date.now() < deadline) {
			// Blocks are bounded so that a crash costs at most one block's worth
			// of progress, and so that a leak in the engine or in V8 itself
			// cannot accumulate across a whole run and be blamed on one case.
			const block = Math.min(remaining, 5000);
			const result = await runBlock(runner, generator, seed, block, heartbeatFile);
			summary.executed += result.executed || 0;
			summary.slow += result.slow.length;
			summary.asyncFailures += result.asyncFailures.length;

			for (const detail of new Set(result.asyncFailures)) {
				console.log(`  async failure: ${detail}`);
			}

			for (const slowCase of result.slow.slice(0, 3)) {
				console.log(`  slow (${slowCase.elapsedMs.toFixed(0)}ms) seed=${slowCase.seed}: ${describeCase(slowCase.input)}`);
			}

			const collected = result.findings.map((record) => ({
				seed: record.seed,
				outcome: record.outcome,
				input: record.input,
			}));

			// A block that died was working on something. Whatever the heartbeat
			// named is the reproducer candidate, and it is by definition not in
			// the findings list, since the child never got to report it.
			if (result.stopped === "crash" || result.stopped === "hang") {
				const kind = result.stopped;
				summary[kind === "crash" ? "crashes" : "hangs"]++;
				const at = result.inFlight;
				console.log(
					`  ${kind.toUpperCase()} in ${generator} block at seed ${at ? at.seed : "unknown"}` +
					(result.exitCode != null ? ` (exit ${result.exitCode}${result.signal ? `, ${result.signal}` : ""})` : ""),
				);
				if (result.stderr.trim()) console.log(indent(result.stderr.trim()));
				if (at) {
					const derived = deriveCase(runner, generator, at.seed);
					if (derived) collected.push({ seed: at.seed, outcome: { kind, detail: `${kind} during ${generator} soak`, elapsedMs: 0 }, input: derived });
				}
				// Skip past the offending seed so the next block makes progress.
				seed = (at ? at.seed : seed) + 1;
				remaining -= Math.max(1, result.executed || 1);
			} else {
				seed += block;
				remaining -= block;
			}

			for (const finding of collected) {
				summary.findings++;
				const signature = failureSignature(finding.outcome);
				if (seen.has(signature)) continue;
				seen.add(signature);

				console.log(`  FINDING [${finding.outcome.kind}] seed=${finding.seed}: ${finding.outcome.detail}`);
				console.log(indent(`before shrink: ${describeCase(finding.input)}`));

				let reduced = { input: finding.input, steps: 0, attempts: 0 };
				if (options.shrink) {
					const detail = finding.outcome.thrownName ?? finding.outcome.code ?? "";
					reduced = await shrinkFinding(runner, finding.input, finding.outcome.kind, detail);
				}
				console.log(indent(`after shrink (${reduced.steps} steps): ${describeCase(reduced.input)}`));

				if (options.save) {
					const entry = makeEntry({
						seed: finding.seed,
						generator,
						outcome: finding.outcome,
						input: reduced.input,
						shrinkSteps: reduced.steps,
					});
					if (saveEntry(corpusDirectory, entry)) {
						summary.saved++;
						console.log(indent(`saved corpus/${entry.generator}-${entry.outcome}-${caseId(reduced.input)}.json`));
					}
				}
			}
		}
	}

	try {
		fs.rmSync(heartbeatFile, { force: true });
	} catch {
		// Best effort. A leftover heartbeat in the temp directory harms nothing.
	}

	console.log("");
	console.log(`executed ${summary.executed} cases`);
	console.log(`findings ${summary.findings} (${summary.saved} new corpus entries)`);
	console.log(`crashes ${summary.crashes}, hangs ${summary.hangs}, slow ${summary.slow}, async failures ${summary.asyncFailures}`);
	process.exitCode = summary.crashes > 0 || summary.hangs > 0 || summary.findings > 0 ? 1 : 0;
}

/**
 * Ask a child to write out the case a seed stands for, without running it.
 *
 * Generation is separated from execution precisely so this is safe: a seed that
 * kills the process when run is still generated harmlessly, which is what makes
 * a crash reproducible at all. Deriving it here instead would mean loading the
 * engine into the supervisor, and the supervisor has to outlive the experiment.
 */
function deriveCase(runner, generator, seed) {
	const outFile = path.join(buildDirectory, `derived-${process.pid}.json`);
	spawnSync(
		process.execPath,
		[
			`--max-old-space-size=${options.heapMb}`,
			runner,
			"--mode=generate",
			`--generator=${generator}`,
			`--seed=${seed}`,
			`--out=${outFile}`,
		],
		{ timeout: 60000, encoding: "utf8" },
	);
	try {
		const derived = JSON.parse(fs.readFileSync(outFile, "utf8"));
		fs.rmSync(outFile, { force: true });
		return derived;
	} catch {
		// The generator itself did not survive the seed, which is a finding of
		// its own but not one this path can characterise. The seed is what the
		// report carries in that case.
		return null;
	}
}

/** Indent a block of text for the console. */
function indent(text) {
	return text.split("\n").map((line) => `      ${line}`).join("\n");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
