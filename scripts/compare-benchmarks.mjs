/**
 * Compares two sets of benchmark results and fails on a regression.
 *
 * Plain Node with no dependencies, because a performance gate that cannot run
 * without an install step is one more thing to go wrong on a runner.
 *
 * Usage:
 *   node scripts/compare-benchmarks.mjs <referenceDir> <currentDir>
 *
 * Both directories hold the per-suite JSON that `writeBenchmarkResults` emits.
 * The intended reference is a run of the merge base on the same machine,
 * minutes apart, rather than the committed baselines: comparing two runs on one
 * machine cancels most of the variance that makes hosted-runner timings
 * untrustworthy. The committed baselines are for local comparison and for
 * watching a trend over time, which is a different job.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const [referenceDir, currentDir] = process.argv.slice(2);

if (!referenceDir || !currentDir) {
	console.error("usage: compare-benchmarks.mjs <referenceDir> <currentDir>");
	process.exit(2);
}

const thresholds = JSON.parse(
	fs.readFileSync(new URL("../packages/engine/benchmarks/thresholds.json", import.meta.url), "utf8"),
);

/** Load every suite file in a directory, keyed by suite name. */
function loadSuites(dir) {
	if (!fs.existsSync(dir)) return {};
	const out = {};
	for (const entry of fs.readdirSync(dir)) {
		if (!entry.endsWith(".json")) continue;
		const parsed = JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8"));
		// Only the canonical shape is comparable. The pool and parse-compile
		// suites persist their own structures and are skipped rather than
		// misread as timings.
		if (parsed && typeof parsed === "object" && parsed.results && parsed.suite) {
			out[parsed.suite] = parsed.results;
		}
	}
	return out;
}

/**
 * Which harness produced a set of results, or null for runs from before the
 * field existed.
 */
function harnessOf(dir) {
	if (!fs.existsSync(dir)) return null;
	for (const entry of fs.readdirSync(dir)) {
		if (!entry.endsWith(".json")) continue;
		const parsed = JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8"));
		if (parsed && typeof parsed === "object" && parsed.harness) return parsed.harness;
	}
	return null;
}

/**
 * The figure a case is compared on, or null if the entry is not a timing.
 *
 * Median where there is one. A mean over per-iteration deltas is dominated by
 * outliers, and a single garbage collection pause during ten thousand
 * iterations moves it while leaving the median alone.
 *
 * The null case is not defensive padding. A suite once persisted a
 * dimensionless ratio alongside its timings, and taking the logarithm of the
 * resulting undefined turned a whole suite's geometric mean into NaN, which
 * compared false against every threshold and so reported success.
 */
function comparisonValue(sample) {
	if (typeof sample !== "object" || sample === null) return null;
	const value = sample.medianMs ?? sample.meanMs;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

const reference = loadSuites(referenceDir);
const current = loadSuites(currentDir);

// Refuse to compare two runs that measured differently. A ratio across a change
// of harness describes the change of harness, not the code: replacing the old
// `performance.now()` loop with mitata made identical code read up to 2.6x
// slower, because that loop's per-iteration deltas were mostly zero for
// anything faster than the clock, so its mean understated the real cost.
//
// This is a pass rather than a failure. The run still publishes both sets of
// numbers; there is simply no honest ratio to draw between them, and the next
// run has both sides on the same harness.
const referenceHarness = harnessOf(referenceDir);
const currentHarness = harnessOf(currentDir);

if (referenceHarness !== currentHarness) {
	const describe = (h) => h ?? "an earlier harness that did not record one";
	const message =
		`Benchmark harness changed: the reference was measured with ${describe(referenceHarness)} ` +
		`and this run with ${describe(currentHarness)}. Ratios between them would describe the ` +
		`change of measurement rather than any change in the code, so the comparison is skipped ` +
		`for this run. The next run has both sides on the same harness.`;

	console.log(message);
	if (process.env.GITHUB_STEP_SUMMARY) {
		fs.appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`## Benchmarks\n\n${message}\n`,
			"utf8",
		);
	}
	process.exit(0);
}

const rows = [];
const failures = [];
const warnings = [];
const improvements = [];
const skipped = [];
const suiteSummaries = [];

for (const suite of Object.keys(reference).sort()) {
	if (!current[suite]) {
		console.log(`suite "${suite}" is missing from the current run, skipping`);
		continue;
	}

	const ratios = [];

	for (const name of Object.keys(reference[suite]).sort()) {
		const ref = reference[suite][name];
		const cur = current[suite][name];
		if (!cur) continue;

		const refValue = comparisonValue(ref);
		const curValue = comparisonValue(cur);

		if (refValue === null || curValue === null) {
			skipped.push(`${suite} / ${name}: not a comparable timing`);
			continue;
		}

		if (refValue < thresholds.noiseFloorMs) {
			rows.push({ suite, name, refValue, curValue, ratio: null, verdict: "below noise floor" });
			continue;
		}

		const ratio = curValue / refValue;
		ratios.push(ratio);

		let verdict = "ok";
		if (ratio > thresholds.failRatio) {
			verdict = "FAIL";
			failures.push(`${suite} / ${name}: ${ratio.toFixed(2)}x slower`);
		} else if (ratio > thresholds.warnRatio) {
			verdict = "warn";
			warnings.push(`${suite} / ${name}: ${ratio.toFixed(2)}x slower`);
		} else if (ratio < thresholds.improvementRatio) {
			verdict = "faster";
			improvements.push(`${suite} / ${name}: ${(1 / ratio).toFixed(2)}x faster`);
		}

		rows.push({ suite, name, refValue, curValue, ratio, verdict });
	}

	if (ratios.length > 0) {
		// Geometric mean, since these are ratios. An arithmetic mean of ratios
		// lets one 3x outlier hide several small improvements, and treats 2x
		// slower and 2x faster as unequal in magnitude when they are not.
		const geomean = Math.exp(ratios.reduce((a, r) => a + Math.log(r), 0) / ratios.length);
		if (!Number.isFinite(geomean)) {
			// Should be unreachable: every ratio comes from two positive finite
			// values. Failing loudly beats reporting a suite as passing on a NaN.
			failures.push(`${suite}: geometric mean was not a finite number, which means a value reached it that should have been filtered`);
			continue;
		}
		const suiteFailed = geomean > thresholds.suiteGeomeanFailRatio;
		if (suiteFailed) {
			failures.push(
				`${suite}: geometric mean ${geomean.toFixed(3)}x across ${ratios.length} cases, over the ${thresholds.suiteGeomeanFailRatio}x suite limit`,
			);
		}
		suiteSummaries.push({ suite, geomean, cases: ratios.length, failed: suiteFailed });
	}
}

// ── Report ────────────────────────────────────────────────────────────────

const lines = [];
lines.push("## Benchmark comparison", "");

if (rows.length === 0) {
	lines.push("No comparable cases were found in both runs.");
} else {
	lines.push("| Suite | Case | Reference | Current | Ratio | |");
	lines.push("| --- | --- | ---: | ---: | ---: | --- |");
	for (const r of rows) {
		const ratio = r.ratio === null ? "-" : `${r.ratio.toFixed(2)}x`;
		const mark =
			r.verdict === "FAIL" ? "**slower**"
			: r.verdict === "warn" ? "slower"
			: r.verdict === "faster" ? "faster"
			: r.verdict === "below noise floor" ? "too small to compare"
			: "";
		lines.push(
			`| ${r.suite} | ${r.name} | ${(r.refValue * 1000).toFixed(2)}µs | ${(r.curValue * 1000).toFixed(2)}µs | ${ratio} | ${mark} |`,
		);
	}

	lines.push("", "### Per suite", "");
	lines.push("| Suite | Cases | Geometric mean |");
	lines.push("| --- | ---: | ---: |");
	for (const s of suiteSummaries) {
		lines.push(`| ${s.suite} | ${s.cases} | ${s.geomean.toFixed(3)}x${s.failed ? " **over limit**" : ""} |`);
	}
}

if (improvements.length > 0) {
	lines.push("", "### Faster", "");
	for (const i of improvements) lines.push(`- ${i}`);
}
if (warnings.length > 0) {
	lines.push("", "### Warnings", "");
	for (const w of warnings) lines.push(`- ${w}`);
}
if (skipped.length > 0) {
	lines.push("", "### Skipped", "");
	for (const s of skipped) lines.push(`- ${s}`);
}
if (failures.length > 0) {
	lines.push("", "### Failures", "");
	for (const f of failures) lines.push(`- ${f}`);
}

const report = lines.join("\n");
console.log(report);

// The step summary works on pull requests from forks, where the default token
// cannot post a comment. That makes it the primary channel rather than a nicety.
if (process.env.GITHUB_STEP_SUMMARY) {
	fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

if (failures.length > 0) {
	console.error(`\n${failures.length} regression(s) over threshold.`);
	process.exit(1);
}
console.log("\nNo regression over threshold.");
