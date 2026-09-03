/**
 * The full suite with coverage measured against a floor.
 *
 * Measured on the full configuration because it is the run that executes
 * every suite: a figure measured against a subset would move with the subset.
 * The threshold is a floor rather than a target. It exists so coverage cannot
 * fall without a build saying so, and it sits a few points under the measured
 * value so that ordinary churn does not trip it while a real drop does.
 *
 * Run on a schedule (`.github/workflows/coverage.yml`) rather than on every
 * pull request. The v8 provider converts coverage for every loaded source
 * file once per test file, which for 380 spec files over this engine is the
 * bulk of the run: single-threaded on a two-core runner it turned a two and a
 * half minute job into one of over twenty. The babel provider does not
 * instrument ts-jest output here at all. A daily floor catches a drop within a
 * day, which is the right price for keeping the pull-request gate fast; run
 * `npm run test:coverage` locally to check a change that removes tests.
 */

const full = require("./jest.full.config.cjs");

/** @type {import('jest').Config} */
module.exports = {
	...full,
	collectCoverage: true,
	collectCoverageFrom: [
		"packages/engine/src/**/*.ts",
		// The inline worker is a build artefact of esbuild-plugin-inline-worker
		// and throws when imported directly, so nothing can execute it here.
		"!packages/engine/src/workers/**",
	],
	coverageReporters: ["text-summary"],
	// Measured when the floor was set, over every source file including the
	// ones no test imports: 95.9% statements, 86.1% branches, 91.0% functions,
	// 95.9% lines. Each floor sits about three points under.
	coverageThreshold: {
		global: {
			statements: 93,
			branches: 83,
			functions: 88,
			lines: 93,
		},
	},
};
