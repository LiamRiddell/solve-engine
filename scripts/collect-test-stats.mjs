/**
 * Records how big the test suite actually is, for the landing page to quote.
 *
 * A number like "3908 tests" on a marketing page is worth exactly as much as
 * the reader's confidence that someone still counts them. Typing it in means it
 * is wrong within a fortnight and nobody notices, which is worse than not
 * claiming it at all.
 *
 * So it is derived. The full suite already runs in CI and already knows the
 * numbers, so this reads them out of Jest's own report and writes them where
 * the site can import them. `--check` then fails the build if the committed
 * file has drifted, which makes the number self-maintaining: a pull request
 * that adds tests has to update it, and one that does not cannot claim a total
 * it did not produce.
 *
 * Usage:
 *   node scripts/collect-test-stats.mjs           write from the last report
 *   node scripts/collect-test-stats.mjs --check   fail if the file is stale
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".jest-report.json");
const TARGET = path.join(ROOT, "docs/src/data/testStats.json");
const DOCS_ROOT = path.join(ROOT, "docs/src/content/docs");

/**
 * Counts the documented examples that carry an asserted result.
 *
 * Deliberately the same rule `DocExamples.spec.ts` applies when it decides what
 * to execute: a line inside a ```solve block with a `//` expectation on it. Two
 * counts of the same thing that disagree would be worse than one, so if that
 * rule ever changes, both have to change together.
 *
 * @param {string} dir - Directory to walk.
 * @returns {number} How many lines the doc-example suite asserts.
 */
function countDocExamples(dir) {
	let total = 0;

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			total += countDocExamples(full);
			continue;
		}
		if (!/\.mdx?$/.test(entry.name)) continue;

		let inBlock = false;
		for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
			if (line.trimStart().startsWith("```")) {
				inBlock = /^```solve\b/.test(line.trim());
				continue;
			}
			if (inBlock && line.includes("//") && line.trim() !== "") total++;
		}
	}

	return total;
}

/**
 * Reads the totals out of Jest's report.
 *
 * @returns {{ tests: number, suites: number }} The counts.
 */
function readReport() {
	// Read and handle the failure, rather than asking whether the file exists
	// and then reading it. The two-step version is a time-of-check to
	// time-of-use race: the answer can stop being true between the question
	// and the read, and there is no reason to ask a question whose answer the
	// read gives anyway.
	let raw;
	try {
		raw = fs.readFileSync(REPORT, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		console.error(
			`No Jest report at ${path.relative(ROOT, REPORT)}.
` +
				"Run `npm run test:full` first; it writes one as a side effect.",
		);
		process.exit(1);
	}

	const report = JSON.parse(raw);
	return {
		tests: report.numTotalTests,
		suites: report.numTotalTestSuites,
	};
}

/**
 * Counts the language packages the engine registers by default.
 *
 * Read off the array rather than off a comment above it, so adding a package
 * moves the number on the site without anyone remembering to.
 *
 * @returns {number} How many entries `BUILTIN_PACKAGES` has.
 */
function countBuiltinPackages() {
	const source = fs.readFileSync(
		path.join(ROOT, "packages/engine/src/packages/builtins.ts"),
		"utf8",
	);
	const list = source.match(/export const BUILTIN_PACKAGES[^=]*=\s*\[([^\]]*)\]/);
	if (!list) {
		console.error("Could not find BUILTIN_PACKAGES in builtins.ts.");
		process.exit(1);
	}
	// Strip comments first: the array carries inline `//` notes whose own commas
	// would otherwise be counted as extra entries (they made the figure read 26
	// for a 25-package array).
	return list[1]
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0).length;
}

/**
 * The engine's runtime dependency count and its number of subpath exports.
 *
 * Both are quoted on the landing page and both had already gone stale once: the
 * page claimed no runtime dependencies while there were four, and then four
 * after one was ported in-house and there were three. Neither is a number
 * anybody will remember to update, so neither is written down.
 *
 * @returns {{ runtimeDependencies: number, subpathExports: number }} The counts.
 */
function readPackageShape() {
	const pkg = JSON.parse(
		fs.readFileSync(path.join(ROOT, "packages/engine/package.json"), "utf8"),
	);
	return {
		runtimeDependencies: Object.keys(pkg.dependencies ?? {}).length,
		subpathExports: Object.keys(pkg.exports ?? {}).length,
	};
}

const stats = {
	...readReport(),
	docExamples: countDocExamples(DOCS_ROOT),
	builtinPackages: countBuiltinPackages(),
	...readPackageShape(),
};

const next = `${JSON.stringify(stats, null, 2)}\n`;
/** The committed copy, or "" when there is not one yet. Same reasoning as above. */
function readCommitted() {
	try {
		return fs.readFileSync(TARGET, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return "";
		throw error;
	}
}

const current = readCommitted();

if (process.argv.includes("--check")) {
	if (current !== next) {
		console.error(
			"docs/src/data/testStats.json is out of date.\n" +
				`  committed: ${current.trim() || "(missing)"}\n` +
				`  actual:    ${next.trim()}\n` +
				"Run `npm run stats:tests` and commit the result.",
		);
		process.exit(1);
	}
	console.log(`Test stats are current: ${stats.tests} tests in ${stats.suites} suites.`);
} else {
	fs.writeFileSync(TARGET, next);
	console.log(`Wrote ${path.relative(ROOT, TARGET)}: ${stats.tests} tests in ${stats.suites} suites.`);
}
