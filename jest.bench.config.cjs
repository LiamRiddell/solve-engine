/**
 * Benchmark runner configuration.
 *
 * A separate file rather than a flag on the main config, because
 * `testPathIgnorePatterns` wins over `--testPathPattern`: the main config
 * excludes `benchmarks/`, so no command-line pattern can select those specs
 * back in. Inheriting and overriding the exclusion is the only way to run them.
 *
 * Run it through `npm run bench`, which also pins `--runInBand`. Parallel
 * workers competing for two cores are the largest single source of noise
 * available on a hosted runner, and a benchmark that measures scheduler
 * contention measures nothing useful.
 */

const base = require("./jest.config.js");

/** @type {import('jest').Config} */
module.exports = {
	...base,

	// The point of this config. Everything else the main run skips stays
	// skipped, since a fuzz suite has no place in a timing run.
	testPathIgnorePatterns: base.testPathIgnorePatterns.filter((p) => p !== "benchmarks/"),

	testMatch: ["**/__tests__/benchmarks/**/*.spec.ts"],

	// Timing loops run for a while and are not a coverage target.
	collectCoverage: false,
	maxWorkers: 1,
	testTimeout: 120000,
};
