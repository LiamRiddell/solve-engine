/**
 * Checks that the engine's standalone Jest config still agrees with the root
 * one on everything that decides whether a test can run.
 *
 * `packages/engine/jest.config.cjs` is deliberately independent: it is what an
 * eventual standalone repository would use, so it cannot import the root
 * config. Independence is the point, and hand-syncing is the cost, and
 * hand-syncing has now failed twice. Once on the three editor-library mocks
 * the language tests need. Once on the `temporal-polyfill` transform, without
 * which three Temporal suites cannot load at all.
 *
 * Both times CI stayed green, because CI runs the root config through
 * `test:full`. Both times the failure looked like fewer tests rather than a
 * failing test, which is the hardest shape to notice: a suite that fails to
 * **load** contributes zero failed tests.
 *
 * So the two stay separate files, and this proves they say the same thing.
 * The comparison allows for the one difference that is real: the root config
 * addresses files as `<rootDir>/packages/engine/...` and the engine config as
 * `<rootDir>/...`, because their roots differ. Anything the root config aims
 * outside `packages/engine` (the playground bridge) is not the engine's
 * business and is skipped.
 *
 * Usage:
 *   node scripts/check-jest-configs.mjs
 *
 * @module check-jest-configs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const rootConfig = require(path.join(ROOT, "jest.config.js"));
const engineConfig = require(path.join(ROOT, "packages/engine/jest.config.cjs"));

/** The prefix the root config carries and the engine config does not. */
const PREFIX = "<rootDir>/packages/engine/";

/** A root-config path rewritten as the engine config would address it. */
function asEngineWouldWrite(value) {
	return typeof value === "string" ? value.split(PREFIX).join("<rootDir>/") : value;
}

/** Whether a root-config mapping addresses something inside the engine package. */
function insideEngine(value) {
	return typeof value === "string" && (value.includes(PREFIX) || !value.includes("<rootDir>/packages/"));
}

const problems = [];

/** Record a difference, named the way the reader will grep for it. */
function differs(key, expected, actual) {
	problems.push(
		`${key}\n    root config:   ${JSON.stringify(expected)}\n    engine config: ${JSON.stringify(actual)}`,
	);
}

// ── Settings that must be identical ──────────────────────────────────────
// Not every key: `roots`, `rootDir` and `setupFiles` differ by construction,
// and are checked in their own shape below.
for (const key of ["preset", "testEnvironment", "coverageProvider"]) {
	if (JSON.stringify(rootConfig[key]) !== JSON.stringify(engineConfig[key])) {
		differs(key, rootConfig[key], engineConfig[key]);
	}
}

// ── The lists that decide what runs, and how it is transformed ───────────
for (const key of ["testPathIgnorePatterns", "transformIgnorePatterns", "moduleDirectories"]) {
	const expected = JSON.stringify(rootConfig[key] ?? null);
	const actual = JSON.stringify(engineConfig[key] ?? null);
	if (expected !== actual) differs(key, rootConfig[key], engineConfig[key]);
}

// ── Module mappings, minus the ones aimed at another package ─────────────
for (const [pattern, target] of Object.entries(rootConfig.moduleNameMapper ?? {})) {
	if (!insideEngine(target)) continue;
	const expected = asEngineWouldWrite(target);
	const actual = engineConfig.moduleNameMapper?.[pattern];
	if (actual === undefined) {
		problems.push(`moduleNameMapper["${pattern}"] is missing from the engine config (root maps it to ${expected})`);
	} else if (actual !== expected) {
		differs(`moduleNameMapper["${pattern}"]`, expected, actual);
	}
}

// ── Transforms, whose tsconfig paths differ the same way ─────────────────
for (const [pattern, transform] of Object.entries(rootConfig.transform ?? {})) {
	const actual = engineConfig.transform?.[pattern];
	if (actual === undefined) {
		problems.push(`transform["${pattern}"] is missing from the engine config, so those files run untransformed`);
		continue;
	}
	const normalise = (entry) =>
		JSON.stringify(entry, (_key, value) =>
			typeof value === "string" ? asEngineWouldWrite(value).replace("./packages/engine/", "<rootDir>/") : value,
		);
	if (normalise(transform) !== normalise(actual)) {
		differs(`transform["${pattern}"]`, transform, actual);
	}
}

if (problems.length > 0) {
	console.error(
		"The engine's standalone Jest config has drifted from the root config:\n\n  " +
			problems.join("\n\n  ") +
			"\n\nBoth files are hand-maintained on purpose (the engine one is what a standalone\n" +
			"repository would use). Make them agree, or teach this script why the difference\n" +
			"is deliberate.",
	);
	process.exit(1);
}

console.log("The engine's standalone Jest config agrees with the root config.");
