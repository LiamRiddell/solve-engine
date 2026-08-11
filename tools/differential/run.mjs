/**
 * The differential run: one corpus, two builds, every difference classified.
 *
 * A test suite answers "does the thing I asserted still hold". Before a release
 * the question is the other one: "did anything change that I did not intend",
 * and no assertion can answer it, because the changes worth finding are the
 * ones nobody thought to write down. So this runs a large corpus through the
 * last published build and the candidate, and reports every place they part
 * company.
 *
 * The baseline is an installed package rather than a git checkout, deliberately.
 * The artefact a user receives is the tarball, and comparing against the
 * previous working tree would compare two things no consumer ever ran.
 *
 * Usage:
 *   node tools/differential/run.mjs --baseline=<dir with index.js>
 *   node tools/differential/run.mjs --baseline=... --count=30000 --seed=20260811
 *   node tools/differential/run.mjs --baseline=... --skip-generate   reuse the last generated batch
 *
 * See README.md in this directory for how to prepare the baseline.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { buildCorpus } from "./corpus.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const ENGINE = path.join(ROOT, "packages", "engine");
const WORK = path.join(ROOT, "node_modules", ".cache", "solve-differential");

const args = new Map();
for (const arg of process.argv.slice(2)) {
	const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
	if (match) args.set(match[1], match[2] ?? "true");
}

const options = {
	baseline: args.get("baseline"),
	candidate: args.get("candidate") ?? path.join(ENGINE, "dist"),
	seed: Number(args.get("seed") ?? 20260811),
	count: Number(args.get("count") ?? 30000),
	// A case that has not finished in this long is a hang from the point of
	// view of anything waiting on the engine, whatever it is doing inside. An
	// ordinary expression finishes in single-digit milliseconds, so this is
	// three orders of magnitude of headroom and still bounds the run: the
	// baseline has no allocation budget, and the corpus deliberately contains
	// the inputs that budget was added for.
	caseTimeoutMs: Number(args.get("caseTimeout") ?? 8000),
	heapMb: Number(args.get("heap") ?? 1024),
	// Shards run concurrently over disjoint slices. The work is CPU-bound and
	// entirely independent per expression, so this is close to linear, and it
	// matters more than it looks: an unguarded baseline spends whole seconds on
	// inputs the candidate refuses instantly, and there are hundreds of them.
	shards: Number(args.get("shards") ?? Math.max(1, Math.min(8, os.cpus().length - 1))),
	skipGenerate: args.has("skip-generate"),
	repeat: args.get("repeat") !== "false",
};

if (options.baseline === undefined) {
	console.error("--baseline=<directory containing index.js and format.js> is required");
	process.exit(2);
}

fs.mkdirSync(WORK, { recursive: true });

// ── Generated expressions ─────────────────────────────────────────────────

/** Resolves this repository's own path aliases for esbuild, the way Jest's moduleNameMapper does. */
function aliasPlugin() {
	const roots = [
		["@solve-js/", path.join(ENGINE, "src")],
		["@tools/", path.join(ENGINE, "tools")],
	];
	return {
		name: "solve-aliases",
		setup(build) {
			build.onResolve({ filter: /^@(solve-js|tools)\// }, (candidate) => {
				for (const [prefix, base] of roots) {
					if (!candidate.path.startsWith(prefix)) continue;
					const stem = path.join(base, candidate.path.slice(prefix.length));
					for (const suffix of [".ts", ".tsx", "/index.ts", ".js", ""]) {
						const full = stem + suffix;
						if (fs.existsSync(full) && fs.statSync(full).isFile()) return { path: full };
					}
					return { path: stem };
				}
				return null;
			});
			// The compilation worker touches `self` at load time, which a plain
			// Node process does not have. Stubbed exactly as the fuzz runner
			// and the Jest run stub it.
			build.onResolve({ filter: /\.worker$/ }, () => ({ path: "differential-worker-stub", namespace: "stub" }));
			build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
				contents: "export default function createWorker() { throw new Error('workers are not available here'); }",
				loader: "js",
			}));
		},
	};
}

const generatedFile = path.join(WORK, `generated-${options.seed}-${options.count}.jsonl`);

async function generate() {
	if (options.skipGenerate && fs.existsSync(generatedFile)) {
		console.log(`reusing ${path.relative(ROOT, generatedFile)}`);
		return;
	}
	const esbuild = require("esbuild");
	const bundle = path.join(WORK, "fuzzEntry.mjs");
	await esbuild.build({
		entryPoints: [path.join(HERE, "fuzzEntry.mjs")],
		outfile: bundle,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		sourcemap: false,
		logLevel: "warning",
		plugins: [aliasPlugin()],
	});
	await new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[bundle, `--seed=${options.seed}`, `--count=${options.count}`, `--out=${generatedFile}`],
			{ stdio: "inherit" },
		);
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`generator exited ${code}`))));
	});
}

// ── Supervised probing ────────────────────────────────────────────────────

/** Runs one probe child over `start, start+stride, ...` for `count` cases, resolving with why it stopped and where. */
function probeBlock(root, corpusFile, outFile, progressFile, start, count, stride) {
	return new Promise((resolve) => {
		try {
			fs.rmSync(progressFile, { force: true });
		} catch {
			// A stale progress file that will not delete is not worth stopping for.
		}
		const child = spawn(
			process.execPath,
			[
				`--max-old-space-size=${options.heapMb}`,
				path.join(HERE, "probe.mjs"),
				`--root=${root}`,
				`--corpus=${corpusFile}`,
				`--out=${outFile}`,
				`--progress=${progressFile}`,
				`--start=${start}`,
				`--limit=${count}`,
				`--stride=${stride}`,
			],
			// TZ is pinned alongside the clock. `today` renders through the
			// host's timezone, so an unpinned one makes a run reproduce only on
			// the machine that produced it.
			{ stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, TZ: "UTC" } },
		);

		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
			if (stderr.length > 4000) stderr = stderr.slice(-4000);
		});

		let lastIndex = start;
		let lastMovedAt = Date.now();
		let settled = false;

		const readProgress = () => {
			try {
				const raw = fs.readFileSync(progressFile, "utf8").trim();
				const parsed = Number(raw);
				return Number.isFinite(parsed) ? parsed : lastIndex;
			} catch {
				return lastIndex;
			}
		};

		const watchdog = setInterval(() => {
			const current = readProgress();
			if (current !== lastIndex) {
				lastIndex = current;
				lastMovedAt = Date.now();
				return;
			}
			if (Date.now() - lastMovedAt > options.caseTimeoutMs && !settled) {
				settled = true;
				clearInterval(watchdog);
				child.kill("SIGKILL");
				resolve({ reason: "hang", index: current, stderr });
			}
		}, 500);

		child.on("exit", (code, signal) => {
			if (settled) return;
			settled = true;
			clearInterval(watchdog);
			const current = readProgress();
			if (code === 0) resolve({ reason: "done", index: current, stderr });
			else resolve({ reason: `exit ${code ?? signal}`, index: current, stderr });
		});
	});
}

/**
 * Probes the whole corpus, restarting past whatever kills the child.
 *
 * Returns the results indexed by corpus position. An expression the child never
 * survived is recorded as such rather than dropped, because "this input kills
 * the process in one build and not the other" is the most interesting kind of
 * difference there is.
 */
async function probeAll(label, root, corpusFile, corpusLength, tag) {
	const results = new Array(corpusLength).fill(null);
	const startedAt = Date.now();
	let restarts = 0;

	// Interleaved, not contiguous. The corpus is grouped by where an expression
	// came from, so the costly inputs arrive in clumps, and a contiguous split
	// hands one shard every denial-of-service literal in the suite while the
	// others finish and idle.
	const stride = options.shards;
	const shards = [];
	for (let shard = 0; shard < stride && shard < corpusLength; shard++) {
		shards.push(shard);
	}

	await Promise.all(
		shards.map(async (shard) => {
			const outFile = path.join(WORK, `results-${tag}-${shard}.jsonl`);
			const progressFile = path.join(WORK, `progress-${tag}-${shard}`);
			fs.rmSync(outFile, { force: true });

			let cursor = shard;
			let localRestarts = 0;
			while (cursor < corpusLength) {
				const remaining = Math.ceil((corpusLength - cursor) / stride);
				const outcome = await probeBlock(root, corpusFile, outFile, progressFile, cursor, remaining, stride);
				if (outcome.reason === "done") break;
				restarts += 1;
				localRestarts += 1;
				const victim = Math.max(cursor, Math.min(outcome.index, corpusLength - 1));
				results[victim] = { fatal: outcome.reason, stderr: outcome.stderr.slice(-600) };
				console.log(`  ${label}[${shard}]: ${outcome.reason} at #${victim}, resuming at ${victim + stride}`);
				cursor = victim + stride;
				if (localRestarts > 400) {
					console.log(`  ${label}[${shard}]: too many restarts, stopping`);
					break;
				}
			}

			for (const line of fs.readFileSync(outFile, "utf8").split("\n")) {
				if (line === "") continue;
				const parsed = JSON.parse(line);
				results[parsed.i] = parsed.record;
			}
		}),
	);

	console.log(
		`  ${label}: ${results.filter((entry) => entry !== null).length}/${corpusLength} in ${((Date.now() - startedAt) / 1000).toFixed(0)}s, ${restarts} restart(s)`,
	);
	return results;
}

// ── Main ──────────────────────────────────────────────────────────────────

await generate();

const corpus = buildCorpus(generatedFile);
const corpusFile = path.join(WORK, "corpus.json");
fs.writeFileSync(corpusFile, JSON.stringify(corpus));

const byOrigin = new Map();
for (const entry of corpus) {
	const kind = entry.origin.split(":")[0];
	byOrigin.set(kind, (byOrigin.get(kind) ?? 0) + 1);
}
console.log(`corpus: ${corpus.length} distinct expressions across ${options.shards} shard(s)`);
for (const [kind, total] of [...byOrigin].sort((a, b) => b[1] - a[1])) console.log(`  ${kind}: ${total}`);

console.log("\nprobing baseline");
const baseline = await probeAll("baseline", options.baseline, corpusFile, corpus.length, "baseline");

console.log("\nprobing candidate");
const candidate = await probeAll("candidate", options.candidate, corpusFile, corpus.length, "candidate");

/**
 * A second pass over each side, used only to discard expressions that disagree
 * with themselves. Pinning the clock and the random source covers what we know
 * about; this covers what we do not.
 */
let baselineRepeat = null;
let candidateRepeat = null;
if (options.repeat) {
	console.log("\nrepeating baseline (self-stability)");
	baselineRepeat = await probeAll("baseline#2", options.baseline, corpusFile, corpus.length, "baseline2");
	console.log("\nrepeating candidate (self-stability)");
	candidateRepeat = await probeAll("candidate#2", options.candidate, corpusFile, corpus.length, "candidate2");
}

fs.writeFileSync(
	path.join(WORK, "run.json"),
	JSON.stringify({
		seed: options.seed,
		count: options.count,
		baselineRoot: options.baseline,
		candidateRoot: options.candidate,
		corpus,
		baseline,
		candidate,
		baselineRepeat,
		candidateRepeat,
	}),
);

console.log(`\nwrote ${path.relative(ROOT, path.join(WORK, "run.json"))}`);
console.log("now run: node tools/differential/report.mjs");
