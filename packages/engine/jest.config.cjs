/**
 * Standalone Jest config for solve-engine: lets this package run its own
 * test suite (`npm test` from packages/engine) independent of the monorepo
 * root config, which is what an eventual standalone repository would need.
 *
 * Kept in step with the root `jest.config.js` by hand, module mocks included.
 * It used to lack the three editor-library mocks the language tests need, so
 * the standalone run could not actually run the suite; nothing in CI
 * exercised it, which is how that stayed true.
 */

/** @type {import('jest').Config} */
const config = {
	coverageProvider: "v8",
	maxWorkers: 2,
	workerIdleMemoryLimit: "512MB",
	moduleDirectories: ["node_modules"],
	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
		"@solve-js-examples/(.*)": "<rootDir>/examples/$1",
		"@solve-js/(.*)": "<rootDir>/src/$1",
		"@tools/(.*)": "<rootDir>/tools/$1",
		"test/(.*)": "<rootDir>/__tests__/$1",
		"^@codemirror/language$": "<rootDir>/__tests__/__mocks__/codemirror-language.ts",
		"^@lezer/common$": "<rootDir>/__tests__/__mocks__/lezer-common.ts",
		"^obsidian$": "<rootDir>/__tests__/__mocks__/obsidian.ts",
	},
	preset: "ts-jest",
	rootDir: ".",
	roots: ["<rootDir>/__tests__"],
	setupFiles: ["<rootDir>/__tests__/__mocks__/jest-setup.ts"],
	testEnvironment: "jest-environment-node",
	testPathIgnorePatterns: [
		"\\\\node_modules\\\\",
		"/node_modules/",
		"__mocks__",
		"\\.claude[\\\\/]",
		// Heavy / stress tests — not part of the normal dev cycle
		"heavy/",
		"benchmarks/",
		"LexerFuzz\\.spec\\.",
		"LexerVocabularyFuzz\\.spec\\.",
		"LongDocumentRobustness\\.spec\\.",
	],
	transform: {
		"^.+\\.tsx?$": [
			"ts-jest",
			{
				tsconfig: "<rootDir>/__tests__/tsconfig.test.json",
				skipLibCheck: true,
				isolatedModules: true,
			},
		],
	},
};

module.exports = config;
