/**
 * Every unit test, including the ones the default run skips.
 *
 * `jest.config.js` excludes four suites (`heavy/MemoryLeak`, `LexerFuzz`,
 * `LexerVocabularyFuzz`, `LongDocumentRobustness`) so the normal dev cycle
 * stays fast. That is the right default, but it means `npm run verify` leaves
 * them unexecuted, and a suite nothing runs is a suite that quietly rots.
 *
 * Benchmarks stay out. They are timing measurements rather than assertions
 * about behaviour, they take minutes, and they have their own workflow with a
 * comparison against the merge base.
 *
 * Run through `npm run test:full`, which raises the heap and pins
 * `--runInBand`: the fuzz and long-document suites are memory-hungry enough
 * that parallel workers on a two-core runner start failing on allocation rather
 * than on anything real.
 *
 * This is also the run that measures coverage, because it is the run that
 * executes every suite: a figure measured against a subset would move with
 * the subset. The threshold is a floor rather than a target. It exists so
 * coverage cannot fall without the build saying so, and it sits a few points
 * under the measured value so that ordinary churn does not trip it while a
 * real drop does.
 */

const base = require("./jest.config.js");

/** @type {import('jest').Config} */
module.exports = {
	...base,
	testPathIgnorePatterns: [
		"\\\\node_modules\\\\",
		"/node_modules/",
		"__mocks__",
		"benchmarks/",
	],
	// These suites generate large inputs; the default timeout is not generous
	// enough for the long-document robustness cases on a cold runner.
	testTimeout: 120000,

	collectCoverage: true,
	collectCoverageFrom: [
		"packages/engine/src/**/*.ts",
		// The inline worker is a build artefact of esbuild-plugin-inline-worker
		// and throws when imported directly, so nothing can execute it here.
		"!packages/engine/src/workers/**",
	],
	coverageReporters: ["text-summary"],
	// Measured when the floor was set: 97.3% statements, 88.3% branches, 92.0%
	// functions, 97.3% lines. Each floor sits three to four points under.
	coverageThreshold: {
		global: {
			statements: 94,
			branches: 84,
			functions: 88,
			lines: 94,
		},
	},
};
