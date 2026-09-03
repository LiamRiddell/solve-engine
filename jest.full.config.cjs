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
 * Coverage is measured on this same suite by `jest.coverage.config.cjs`, on a
 * schedule rather than per pull request; see that file for why.
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
};
