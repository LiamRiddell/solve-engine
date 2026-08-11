/**
 * Evaluates one expression, or a file of them, in both builds side by side.
 *
 * The triage tool. `report.mjs` says which shapes of difference exist; this
 * answers "what exactly does each build do with THIS", which is the question
 * every classification decision comes down to. It applies the same clock,
 * timezone, random and network pinning as `probe.mjs`, so what it prints is
 * what the run saw rather than something subtly different.
 *
 * Usage:
 *   node tools/differential/compare.mjs --baseline=<dir> "2 ^ 3 ^ 2" "200 + 10%"
 *   node tools/differential/compare.mjs --baseline=<dir> --file=expressions.txt
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const args = [];
const flags = new Map();
for (const arg of process.argv.slice(2)) {
	const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
	if (match) flags.set(match[1], match[2] ?? "true");
	else args.push(arg);
}

const baseline = flags.get("baseline");
const candidate = flags.get("candidate") ?? path.join(ROOT, "packages", "engine", "dist");
if (baseline === undefined) {
	console.error("--baseline=<directory containing index.js> is required");
	process.exit(2);
}

const sources = flags.has("file")
	? fs.readFileSync(flags.get("file"), "utf8").split(/\r?\n/).filter((line) => line !== "")
	: args;
if (sources.length === 0) {
	console.error("nothing to compare: pass expressions as arguments or --file=<path>");
	process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "solve-compare-"));
const corpusFile = path.join(scratch, "corpus.json");
fs.writeFileSync(corpusFile, JSON.stringify(sources.map((source) => ({ source, origin: "cli" }))));

/** Runs the probe against one build and reads its results back in corpus order. */
function probe(root, tag) {
	const outFile = path.join(scratch, `${tag}.jsonl`);
	spawnSync(
		process.execPath,
		[
			path.join(HERE, "probe.mjs"),
			`--root=${root}`,
			`--corpus=${corpusFile}`,
			`--out=${outFile}`,
			`--progress=${path.join(scratch, `${tag}.progress`)}`,
		],
		{ stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, TZ: "UTC" } },
	);
	const records = new Array(sources.length).fill(null);
	if (!fs.existsSync(outFile)) return records;
	for (const line of fs.readFileSync(outFile, "utf8").split("\n")) {
		if (line === "") continue;
		const parsed = JSON.parse(line);
		records[parsed.i] = parsed.record;
	}
	return records;
}

/** One result, on one line. */
function render(record) {
	if (record === null) return "died before answering";
	if (record.ok === false) return `THREW ${record.error.code ?? record.error.name}: ${record.error.message}`;
	return record.values
		.map((value) =>
			value.present === false
				? "(no value)"
				: `${value.formatted}   [${value.typeName}${value.unit === null ? "" : `, unit ${value.unit}`}]`,
		)
		.join("  |  ");
}

const before = probe(baseline, "baseline");
const after = probe(candidate, "candidate");

for (let i = 0; i < sources.length; i++) {
	const same = JSON.stringify(before[i]) === JSON.stringify(after[i]);
	console.log(`${same ? "  " : "≠ "} ${JSON.stringify(sources[i])}`);
	console.log(`     base  ${render(before[i])}`);
	console.log(`     cand  ${render(after[i])}`);
}

fs.rmSync(scratch, { recursive: true, force: true });
