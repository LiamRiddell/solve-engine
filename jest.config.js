/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 *
 * Repo-wide config: runs packages/engine's and packages/playground-bridge's
 * test suites together. packages/engine also has its own self-contained
 * jest.config.cjs (usable standalone via `npm test` from inside that
 * package); this root config is for running everything at once.
 *
 * This is the FAST configuration, the one `npm test`, `npm run test:ci` and
 * therefore `npm run verify` use. It leaves out four spec files that CI runs
 * through `jest.full.config.cjs`: `heavy/MemoryLeak`, `LexerFuzz`,
 * `LexerVocabularyFuzz` and `LongDocumentRobustness`. A change that can
 * touch what those cover (the lexer vocabulary, a new unit, document-scale
 * behaviour) should be checked with `npm run test:full` before it is pushed,
 * or with `npm run verify:ci`, which runs every gate CI applies.
 */

/** @type {import('jest').Config} */
const config = {
	coverageProvider: "v8",

	maxWorkers: 2,
	workerIdleMemoryLimit: '512MB',

	moduleDirectories: ["node_modules"],

	moduleNameMapper: {
		// packages/playground-bridge (and playground) source uses ESM-style
		// ".js"-suffixed relative imports (e.g. `from "./engineShared.js"`,
		// resolved by Vite's bundler moduleResolution) — ts-jest's
		// CommonJS resolution doesn't strip that suffix on its own, so a
		// plain relative import to a same-named ".ts" file 404s under
		// jest. Strip it generically so any such file can be imported by a
		// test without needing its own per-file mapping entry.
		"^(\\.{1,2}/.*)\\.js$": "$1",
		"@solve-js/workers/(.*)\\.worker$": "<rootDir>/packages/engine/__tests__/__mocks__/worker-mock.ts",
		"@solve-js-examples/(.*)": "<rootDir>/packages/engine/examples/$1",
		"@solve-js/(.*)": "<rootDir>/packages/engine/src/$1",
		"@bridge/(.*)": "<rootDir>/packages/playground-bridge/src/$1",
		"@tools/(.*)": "<rootDir>/packages/engine/tools/$1",
		"test/(.*)": "<rootDir>/packages/engine/__tests__/$1",
		"^@codemirror/language$": "<rootDir>/packages/engine/__tests__/__mocks__/codemirror-language.ts",
		"^@lezer/common$": "<rootDir>/packages/engine/__tests__/__mocks__/lezer-common.ts",
		"^obsidian$": "<rootDir>/packages/engine/__tests__/__mocks__/obsidian.ts",
	},

	preset: "ts-jest",

	rootDir: ".",

	roots: ["packages/engine/__tests__", "packages/playground-bridge/__tests__"],

	setupFiles: ["<rootDir>/packages/engine/__tests__/__mocks__/jest-setup.ts"],

	testEnvironment: "jest-environment-node",

	testPathIgnorePatterns: [
		"\\\\node_modules\\\\",
		"/node_modules/",
		"__mocks__",
		// The four slow suites, named in the header above. Not part of the
		// normal dev cycle; `jest.full.config.cjs` puts them back.
		"heavy/",
		"benchmarks/",
		"LexerFuzz\\.spec\\.",
		"LexerVocabularyFuzz\\.spec\\.",
		"LongDocumentRobustness\\.spec\\."
	],

	transform: {
		"^.+\\.tsx?$": [
			"ts-jest",
			{
				tsconfig: "./packages/engine/__tests__/tsconfig.test.json",
				skipLibCheck: true,
				isolatedModules: true
			},
		],
	},
};

module.exports = config;
