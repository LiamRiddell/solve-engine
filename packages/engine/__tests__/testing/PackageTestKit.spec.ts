/**
 * The test kit for package authors, testing itself.
 *
 * The kit is the supported way to test a package by the expressions it enables
 * (`solve-engine/testing`), so its own suite has to prove two things the way a
 * package author will lean on them: that a matcher passes when it should, and
 * that it FAILS, with a useful error, when it should. A matcher that never
 * fails is worse than none, it hands out confidence instead of information, so
 * most cases here assert the failing path as carefully as the passing one.
 *
 * The subjects are a tiny fake package built inline (a unit vocabulary, the
 * smallest thing that makes `2 gp + 3 gp` mean something) and the OSRS example
 * package, which is the closest thing the repo has to a real third-party
 * package and the one the issue wants to become a template.
 */

import { describe, expect, test } from "@jest/globals";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { pendingValue, type Value } from "@solve-js/vm/Value";
import {
	createTestEngine,
	expectExpression,
	expectPackage,
	ExpectationError,
	COMMON_PROSE_WORDS,
} from "@solve-js/testing";
import { OSRS_PACKAGE } from "@solve-js-examples/osrs/index";

/** The smallest useful subject: a package that teaches the lexer one unit word. */
const gpPackage: IEnginePackage = {
	name: "gp-currency",
	engineVersion: "^2.0.0",
	lexerVocabulary: { units: ["gp"] },
};

/** The pending demo's plugin-function name; the engine assigns its index when the package registers. */
const PEND_FN = "pend";

/** A parselet whose only job is to call a plugin function that returns a pending value. */
class PendParselet implements PrefixParselet {
	readonly category = "Pending Demo";
	parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		builder.emitPluginCall(PEND_FN, 0);
	}
}

/**
 * A package whose `pend` keyword resolves to a pending value synchronously,
 * with no resolver and so no background fetch: the smallest thing that lets a
 * test exercise {@link expectExpression}'s pending path without a real async
 * source leaking a timer past the test.
 */
const pendingPackage: IEnginePackage = {
	name: "pending-demo",
	lexerVocabulary: { keywords: { pend: "PEND_KEYWORD" } },
	prefixParselets: { PEND_KEYWORD: new PendParselet() },
	pluginFunctions: { [PEND_FN]: (): Value => pendingValue("test:pending") },
};

/** Run a kit assertion and return the ExpectationError it throws, failing the test if it does not throw. */
function captureFailure(fn: () => void): ExpectationError {
	try {
		fn();
	} catch (error) {
		if (error instanceof ExpectationError) return error;
		throw error;
	}
	throw new Error("Expected the assertion to throw an ExpectationError, but it passed.");
}

describe("createTestEngine", () => {
	test("loads the built-ins so arithmetic works out of the box", () => {
		const engine = createTestEngine();
		expectExpression(engine, "2 + 2 * 10").toEqual(22);
		engine.clear();
	});

	test("registers the package under test alongside the built-ins", () => {
		const engine = createTestEngine([gpPackage]);
		expectExpression(engine, "2 gp + 3 gp").toEqual(5, "gp");
		engine.clear();
	});

	test("can omit the built-ins to test a package in isolation", () => {
		const engine = createTestEngine([gpPackage], { includeBuiltins: false });
		// With no arithmetic package, addition has no parselet, so this fails
		// rather than quietly returning a number.
		expectExpression(engine, "2 gp + 3 gp").toBeError();
		engine.clear();
	});

	test("surfaces a version-incompatible package instead of swallowing it", () => {
		const badVersion: IEnginePackage = { name: "from-the-future", engineVersion: ">=99.0.0" };
		// The ExpressionEngine constructor would log and continue, leaving the
		// package silently unregistered; createTestEngine registers it honestly
		// so the test sees the failure.
		expect(() => createTestEngine([badVersion])).toThrow(/from-the-future/);
	});
});

describe("expectExpression.toEqual", () => {
	test("matches a plain number", () => {
		const engine = createTestEngine();
		expectExpression(engine, "50% of 200").toEqual(100);
		engine.clear();
	});

	test("matches a number and a unit", () => {
		const engine = createTestEngine([gpPackage]);
		expectExpression(engine, "2 gp + 3 gp").toEqual(5, "gp");
		engine.clear();
	});

	test("leaving the unit off does not check the unit", () => {
		const engine = createTestEngine([gpPackage]);
		expectExpression(engine, "2 gp + 3 gp").toEqual(5);
		engine.clear();
	});

	test("fails on the wrong number, and says what it found", () => {
		const engine = createTestEngine();
		const error = captureFailure(() => expectExpression(engine, "2 + 2").toEqual(5));
		expect(error).toBeInstanceOf(ExpectationError);
		expect(error.code).toBe("EXPECTED_EQUAL");
		expect(error.message).toContain("4");
		engine.clear();
	});

	test("fails on the wrong unit", () => {
		const engine = createTestEngine([gpPackage]);
		const error = captureFailure(() => expectExpression(engine, "2 gp + 3 gp").toEqual(5, "coins"));
		expect(error.code).toBe("EXPECTED_UNIT");
		expect(error.message).toContain("gp");
		engine.clear();
	});

	test("fails when the expression errored rather than evaluated", () => {
		const engine = createTestEngine();
		const error = captureFailure(() => expectExpression(engine, "gp").toEqual(5));
		expect(error.code).toBe("EXPECTED_EQUAL");
		expect(error.message).toContain("UNDEFINED_VARIABLE");
		engine.clear();
	});
});

describe("expectExpression.toFailWith and toBeError", () => {
	test("matches the exact error code", () => {
		const engine = createTestEngine();
		expectExpression(engine, "gp").toFailWith("UNDEFINED_VARIABLE");
		engine.clear();
	});

	test("toBeError matches any failure", () => {
		const engine = createTestEngine();
		expectExpression(engine, "gp").toBeError();
		engine.clear();
	});

	test("toFailWith fails, and reports the actual code, on a code mismatch", () => {
		const engine = createTestEngine();
		const error = captureFailure(() => expectExpression(engine, "gp").toFailWith("DIVISION_BY_ZERO"));
		expect(error.code).toBe("EXPECTED_FAIL_WITH");
		expect(error.message).toContain("UNDEFINED_VARIABLE");
		engine.clear();
	});

	test("toFailWith fails when the expression actually evaluated", () => {
		const engine = createTestEngine();
		const error = captureFailure(() => expectExpression(engine, "2 + 2").toFailWith("UNDEFINED_VARIABLE"));
		expect(error.code).toBe("EXPECTED_FAIL_WITH");
		engine.clear();
	});

	test("a package's own error code is matched the same way", () => {
		const engine = createTestEngine([OSRS_PACKAGE]);
		// `osrs` with no item name is the package's own parselet error.
		expectExpression(engine, "osrs").toFailWith("OSRS_MISSING_ITEM_NAME");
		engine.clear();
	});
});

describe("expectExpression.toEvaluate and toBePending", () => {
	test("toEvaluate passes for a value and fails for an error", () => {
		const engine = createTestEngine();
		expectExpression(engine, "1 + 1").toEvaluate();
		const error = captureFailure(() => expectExpression(engine, "gp").toEvaluate());
		expect(error.code).toBe("EXPECTED_EVALUATE");
		engine.clear();
	});

	test("an async package result is reported as pending, not as a value", () => {
		const engine = createTestEngine([pendingPackage]);
		// A value still resolving asynchronously is pending, not a final number.
		expectExpression(engine, "pend").toBePending();
		// toEvaluate treats pending as not-yet-a-value, so it fails.
		const error = captureFailure(() => expectExpression(engine, "pend").toEvaluate());
		expect(error.code).toBe("EXPECTED_EVALUATE");
		engine.clear();
	});
});

describe("expectExpression assertions chain and expose the value", () => {
	test("matchers return the assertion for chaining", () => {
		const engine = createTestEngine([gpPackage]);
		expectExpression(engine, "2 gp + 3 gp").toEvaluate().toEqual(5, "gp");
		engine.clear();
	});

	test(".value exposes the raw Value for an uncovered assertion", () => {
		const engine = createTestEngine();
		const value = expectExpression(engine, "2 + 2").value;
		expect(value.toNumber()).toBe(4);
		engine.clear();
	});

	test(".value throws when the expression failed", () => {
		const engine = createTestEngine();
		expect(() => expectExpression(engine, "gp").value).toThrow(ExpectationError);
		engine.clear();
	});
});

describe("expectPackage.notToShadow", () => {
	test("passes for a package that claims no prose words", () => {
		// gp is not an everyday English word, so it shadows nothing.
		expect(expectPackage(gpPackage).notToShadow()).toEqual([]);
	});

	test("catches a keyword that shadows a prose word", () => {
		const shadowing: IEnginePackage = {
			name: "shadower",
			lexerVocabulary: { keywords: { price: "PRICE_KEYWORD" } },
		};
		const error = captureFailure(() => expectPackage(shadowing).notToShadow(["price", "of", "in"]));
		expect(error.code).toBe("PACKAGE_SHADOWS_PROSE");
		expect(error.message).toContain('"price"');
	});

	test("uses COMMON_PROSE_WORDS by default", () => {
		const shadowing: IEnginePackage = {
			name: "in-claimer",
			lexerVocabulary: { keywords: { in: "IN_KEYWORD" } },
		};
		expect(COMMON_PROSE_WORDS).toContain("in");
		const error = captureFailure(() => expectPackage(shadowing).notToShadow());
		expect(error.code).toBe("PACKAGE_SHADOWS_PROSE");
	});

	test("a multi-word phrase is the safe pattern and is not flagged", () => {
		const phraser: IEnginePackage = {
			name: "phraser",
			phrases: { "next friday": "NEXT_FRIDAY" },
		};
		// Neither `next` nor `friday` is reserved, so passing both as prose
		// words still finds nothing shadowed.
		expect(expectPackage(phraser).notToShadow(["next", "friday"])).toEqual([]);
	});

	test("a single-word phrase can still shadow", () => {
		const phraser: IEnginePackage = {
			name: "single-phraser",
			phrases: { discount: "DISCOUNT" },
		};
		const error = captureFailure(() => expectPackage(phraser).notToShadow(["discount"]));
		expect(error.code).toBe("PACKAGE_SHADOWS_PROSE");
	});

	test("a unit spelling that is also a word is flagged", () => {
		const unitPkg: IEnginePackage = {
			name: "day-unit",
			lexerVocabulary: { units: ["day"] },
		};
		const shadowed = captureFailure(() => expectPackage(unitPkg).notToShadow(["day"]));
		expect(shadowed.code).toBe("PACKAGE_SHADOWS_PROSE");
		expect(shadowed.message).toContain("unit");
	});
});

describe("expectPackage.notToCollideWith", () => {
	const first: IEnginePackage = {
		name: "first",
		lexerVocabulary: { keywords: { foo: "FIRST_FOO" } },
	};

	test("passes when vocabularies are distinct", () => {
		const distinct: IEnginePackage = {
			name: "distinct",
			lexerVocabulary: { keywords: { bar: "BAR" } },
		};
		const report = expectPackage(distinct).notToCollideWith([first]);
		expect(report.compatible).toBe(true);
		expect(report.conflicts).toEqual([]);
	});

	test("catches two packages claiming the same keyword for different tokens", () => {
		const collider: IEnginePackage = {
			name: "collider",
			lexerVocabulary: { keywords: { foo: "COLLIDER_FOO" } },
		};
		const error = captureFailure(() => expectPackage(collider).notToCollideWith([first]));
		expect(error.code).toBe("PACKAGE_VOCABULARY_COLLISION");
		expect(error.message).toContain("foo");
	});

	test("strictness controls which severities fail the assertion", () => {
		// A parselet token-type overlap is a warning, not an error: two
		// packages registering a prefix parselet for the same token type.
		const parseletA: IEnginePackage = {
			name: "parselet-a",
			prefixParselets: { SHARED: {} as never },
		};
		const parseletB: IEnginePackage = {
			name: "parselet-b",
			prefixParselets: { SHARED: {} as never },
		};
		// Default strictness "error" lets the warning through.
		const report = expectPackage(parseletB).notToCollideWith([parseletA]);
		expect(report.compatible).toBe(true);
		expect(report.conflicts.length).toBeGreaterThan(0);
		// Raising strictness to "warning" makes the same overlap fail.
		const error = captureFailure(() => expectPackage(parseletB).notToCollideWith([parseletA], "warning"));
		expect(error.code).toBe("PACKAGE_VOCABULARY_COLLISION");
	});
});

describe("expectPackage.toDeclareCompatibleEngineVersion", () => {
	test("passes for a range the running engine satisfies", () => {
		expectPackage(gpPackage).toDeclareCompatibleEngineVersion();
	});

	test("passes for a package that declares no range", () => {
		const noRange: IEnginePackage = { name: "no-range" };
		expectPackage(noRange).toDeclareCompatibleEngineVersion();
	});

	test("fails for a range the running engine cannot satisfy", () => {
		const future: IEnginePackage = { name: "future", engineVersion: ">=99.0.0" };
		const error = captureFailure(() => expectPackage(future).toDeclareCompatibleEngineVersion());
		expect(error.code).toBe("PACKAGE_ENGINE_VERSION_INCOMPATIBLE");
		expect(error.message).toContain("99.0.0");
	});

	test("fails for a malformed range, distinctly from a mismatch", () => {
		const typo: IEnginePackage = { name: "typo", engineVersion: "not-a-range" };
		const error = captureFailure(() => expectPackage(typo).toDeclareCompatibleEngineVersion());
		expect(error.code).toBe("PACKAGE_ENGINE_VERSION_INCOMPATIBLE");
		expect(error.message).toContain("not valid semver");
	});

	test("checks against a caller-supplied engine version", () => {
		const forOldEngine: IEnginePackage = { name: "old-only", engineVersion: "^0.1.0" };
		// Compatible with a 0.1.x engine, but not with the running one.
		expectPackage(forOldEngine).toDeclareCompatibleEngineVersion("0.1.5");
		const error = captureFailure(() => expectPackage(forOldEngine).toDeclareCompatibleEngineVersion("1.0.0"));
		expect(error.code).toBe("PACKAGE_ENGINE_VERSION_INCOMPATIBLE");
	});
});

describe("the OSRS example as a realistic subject", () => {
	test("declares an engine version that resolves", () => {
		expectPackage(OSRS_PACKAGE).toDeclareCompatibleEngineVersion();
	});

	test("does not collide with the built-in packages", () => {
		// BUILTIN_PACKAGES is what createTestEngine loads it alongside.
		const report = expectPackage(OSRS_PACKAGE).notToCollideWith(BUILTIN_PACKAGES);
		expect(report.compatible).toBe(true);
	});

	test("its keywords shadow the prose word 'price', which the kit catches", () => {
		// A real finding: the OSRS example claims `price` as a keyword, and
		// `price` is an everyday word, so the default prose check flags it. This
		// is exactly the trigger-word mistake the kit exists to surface.
		const error = captureFailure(() => expectPackage(OSRS_PACKAGE).notToShadow());
		expect(error.code).toBe("PACKAGE_SHADOWS_PROSE");
		expect(error.message).toContain('"price"');
		// Against a list of words the package does not claim, it is clean.
		expect(() => expectPackage(OSRS_PACKAGE).notToShadow(["the", "of", "and", "in"])).not.toThrow();
	});
});
