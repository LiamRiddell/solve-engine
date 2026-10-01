/**
 * Re-measures the benchmark cases a first comparison put over their limit, and
 * fails only if they are still over.
 *
 * The benchmark job measures the merge base once and the pull request once, and
 * a single measurement on a hosted runner can put an unchanged case over its
 * limit: the thresholds file records spreads of 0.51x to 1.95x on identical
 * code, and a second pass that runs minutes after the first on a machine the
 * first has warmed. The contributing guide used to answer that by hand (compare
 * locally, then re-run the whole sixteen-minute job). This does the second
 * measurement in the job, for the over-limit cases only (#790).
 *
 * What it re-runs is the suite file that holds each over-limit case, since a
 * suite file is the smallest unit the harness runs; only the over-limit cases
 * and suites are judged again. Each round runs the base and the head one after
 * the other, alternating which goes first, so neither side always gets the
 * warmer machine. A case fails when the median of its per-round ratios is still
 * over `failRatio`; a suite fails when the median of its per-round geometric
 * means is still over `suiteGeomeanFailRatio`. The thresholds and the reference
 * (the merge base on the same runner) are the ones the first comparison used.
 *
 * Usage:
 *   node scripts/remeasure-benchmarks.mjs --reference=<dir> --current=<dir>
 *     --base-tree=<dir> --head-tree=<dir> [--rounds=3] [--runner=<script>]
 *
 * `--reference` and `--current` are the first measurement's result folders.
 * Each tree is a checkout with its own install; its suite is run with its own
 * `npm run bench -- <spec>`, or with `node <runner> <tree> <spec>` when
 * `--runner` is given (the tests use that to stand in for a timing run).
 *
 * @module remeasure-benchmarks
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compareRuns, comparisonValue, loadSuites, own, thresholds } from "./compare-benchmarks.mjs";

/** Where a tree's benchmark specs live, and where a run writes its results. */
const SPEC_DIR = "packages/engine/__tests__/benchmarks";
const RESULT_DIR = "packages/engine/benchmarks/current";

/**
 * The median of a list of numbers, or null for an empty list.
 *
 * @param values - Any finite numbers.
 * @returns The middle value, or the mean of the two middle values.
 */
export function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Which spec file writes each suite, read from the `writeBenchmarkResults("<suite>"`
 * call in each file.
 *
 * @param tree - A checkout's root.
 * @returns Suite name to the spec's path relative to the tree, posix separators.
 */
export function suiteFiles(tree) {
	const dir = path.join(tree, SPEC_DIR);
	const out = Object.create(null);
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir)) {
		if (!entry.endsWith(".spec.ts")) continue;
		const source = fs.readFileSync(path.join(dir, entry), "utf8");
		for (const match of source.matchAll(/writeBenchmarkResults\(\s*["']([\w-]+)["']/g)) {
			out[match[1]] = `${SPEC_DIR}/${entry}`;
		}
	}
	return out;
}

/**
 * Decide, from the rounds of a re-measure, whether each over-limit item is
 * confirmed or cleared.
 *
 * @param first - What `compareRuns` returned for the first measurement.
 * @param rounds - One `{ base, head }` per round, each suite name to case results.
 * @param rules - The thresholds to judge by.
 * @returns One verdict per over-limit case and suite.
 */
export function judge(first, rounds, rules = thresholds) {
	const verdicts = [];
	for (const { suite, name, ratio } of first.failingCases) {
		const ratios = [];
		for (const { base, head } of rounds) {
			const b = comparisonValue(own(own(base, suite) ?? {}, name));
			const h = comparisonValue(own(own(head, suite) ?? {}, name));
			if (b !== null && h !== null) ratios.push(h / b);
		}
		const mid = median(ratios);
		// A case the second measurement could not read is not cleared by that:
		// the first measurement is the only evidence left, and it was over.
		const confirmed = mid === null || mid > rules.failRatio;
		verdicts.push({ kind: "case", suite, name, first: ratio, rounds: ratios, median: mid, limit: rules.failRatio, confirmed });
	}
	for (const { suite, geomean } of first.failingSuites) {
		const means = [];
		for (const { base, head } of rounds) {
			const round = compareRuns({ [suite]: own(base, suite) ?? {} }, { [suite]: own(head, suite) ?? {} }, rules);
			const summary = round.suiteSummaries.find((s) => s.suite === suite);
			if (summary && Number.isFinite(summary.geomean)) means.push(summary.geomean);
		}
		const mid = median(means);
		const confirmed = mid === null || mid > rules.suiteGeomeanFailRatio;
		verdicts.push({ kind: "suite", suite, name: null, first: geomean, rounds: means, median: mid, limit: rules.suiteGeomeanFailRatio, confirmed });
	}
	return verdicts;
}

/** The verdicts as markdown, appended below the first comparison. */
export function renderVerdicts(verdicts, roundCount) {
	const lines = ["", "### Re-measured", ""];
	lines.push(
		`Each item over its limit on the first measurement was measured again, ${roundCount} round(s) of base and head ` +
			"one after the other, alternating which ran first. It fails only if the median is still over the limit.",
		"",
	);
	lines.push("| Item | First | Re-measured | Median | Limit | Verdict |");
	lines.push("| --- | ---: | --- | ---: | ---: | --- |");
	for (const v of verdicts) {
		const item = v.kind === "case" ? `${v.suite} / ${v.name}` : `${v.suite} (geometric mean)`;
		const first = Number.isFinite(v.first) ? `${v.first.toFixed(2)}x` : "not a number";
		const again = v.rounds.length > 0 ? v.rounds.map((r) => `${r.toFixed(2)}x`).join(", ") : "not measured";
		const mid = v.median === null ? "-" : `${v.median.toFixed(2)}x`;
		lines.push(`| ${item} | ${first} | ${again} | ${mid} | ${v.limit}x | ${v.confirmed ? "**confirmed regression**" : "cleared: noise on the first measurement"} |`);
	}
	const confirmed = verdicts.filter((v) => v.confirmed).length;
	lines.push(
		"",
		confirmed > 0
			? `${confirmed} of ${verdicts.length} item(s) are still over the limit when measured again.`
			: `All ${verdicts.length} item(s) cleared when measured again, so the first measurement was noise.`,
	);
	return lines.join("\n");
}

/** Run one suite in one tree and return what it wrote, suite name to case results. */
function measure(tree, spec, suite, runner) {
	const resultFile = path.join(tree, RESULT_DIR, `${suite}.json`);
	fs.rmSync(resultFile, { force: true });
	const run = runner
		? spawnSync(process.execPath, [runner, tree, spec], { cwd: tree, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] })
		: spawnSync("npm", ["run", "bench", "--", spec], { cwd: tree, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" });
	if (run.status !== 0) console.log(`::warning::${spec} reported failures in ${tree}; its timings are still read.`);
	return loadSuites(path.dirname(resultFile))[suite] ?? {};
}

function main() {
	const args = process.argv.slice(2);
	const option = (name) => {
		const found = args.find((a) => a.startsWith(`--${name}=`));
		return found ? found.slice(name.length + 3) : null;
	};
	const referenceDir = option("reference");
	const currentDir = option("current");
	const baseTree = option("base-tree");
	const headTree = option("head-tree");
	const rounds = Number(option("rounds") ?? 3);
	const runner = option("runner") ? path.resolve(option("runner")) : null;
	if (!referenceDir || !currentDir || !baseTree || !headTree || !Number.isInteger(rounds) || rounds < 1) {
		console.error("usage: remeasure-benchmarks.mjs --reference=<dir> --current=<dir> --base-tree=<dir> --head-tree=<dir> [--rounds=N] [--runner=<script>]");
		process.exit(2);
	}

	const first = compareRuns(loadSuites(referenceDir), loadSuites(currentDir));
	if (first.failingCases.length === 0 && first.failingSuites.length === 0) {
		console.log("Nothing was over its limit on the first measurement, so there is nothing to re-measure.");
		return;
	}

	const suites = [...new Set([...first.failingCases, ...first.failingSuites].map((f) => f.suite))].sort();
	const baseSpecs = suiteFiles(path.resolve(baseTree));
	const headSpecs = suiteFiles(path.resolve(headTree));

	const measured = [];
	for (let round = 0; round < rounds; round++) {
		const base = Object.create(null);
		const head = Object.create(null);
		for (const suite of suites) {
			const sides = [
				["base", path.resolve(baseTree), baseSpecs[suite], base],
				["head", path.resolve(headTree), headSpecs[suite], head],
			];
			if (round % 2 === 1) sides.reverse();
			for (const [, tree, spec, into] of sides) {
				if (spec) into[suite] = measure(tree, spec, suite, runner);
			}
		}
		measured.push({ base, head });
	}

	const verdicts = judge(first, measured);
	const report = renderVerdicts(verdicts, rounds);
	console.log(report);
	if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

	const confirmed = verdicts.filter((v) => v.confirmed);
	if (confirmed.length > 0) {
		console.error(`\n${confirmed.length} regression(s) still over threshold when measured again.`);
		process.exit(1);
	}
	console.log("\nEvery first-measurement regression cleared when measured again.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
