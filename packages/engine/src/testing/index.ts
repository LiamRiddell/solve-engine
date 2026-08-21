/**
 * A test kit for package authors, the supported way to test a package by the
 * expressions it enables rather than by the opcodes it emits.
 *
 * Before this entry point a package author had two options, both bad: reach
 * into engine internals, or assert on whatever bytecode a parselet happened to
 * emit. The first is unstable across engine versions, the second pins the
 * implementation instead of the behaviour, so a refactor that keeps every
 * answer correct still breaks the tests. This module is a thin, dependency-free
 * layer over the same public surface a host uses: it constructs an
 * {@link ExpressionEngine} with the given packages and evaluates strings.
 *
 * It speaks in expressions. {@link expectExpression} evaluates a string and
 * asserts on the result or the failure code; {@link expectPackage} asserts on
 * the three mistakes a package actually makes (shadowing prose, colliding with
 * another package's vocabulary, and declaring an `engineVersion` range that the
 * running engine does not satisfy).
 *
 * Framework-agnostic on purpose. Nothing here imports jest, vitest or any
 * runner: an assertion that fails throws an {@link ExpectationError}, and one
 * that passes returns, so the kit drops into whatever runner the author already
 * has (or into a plain script, or `node:assert`). Runtime dependency-free and
 * side-effect free, so `solve-engine/testing` stays honest under the package's
 * `"sideEffects": false` contract.
 *
 * @example
 * ```ts
 * import { createTestEngine, expectExpression } from "solve-engine/testing";
 *
 * const engine = createTestEngine([myPackage]);
 * expectExpression(engine, "2 gp + 3 gp").toEqual(5, "gp");
 * expectExpression(engine, "gp").toFailWith("UNDEFINED_VARIABLE");
 * ```
 */

import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { Value, ValueType } from "@solve-js/vm/Value";
import { EngineError } from "@solve-js/errors/EngineError";
import {
	checkPackageCompatibility,
	type CompatibilityReport,
	type CompatibilityConflict,
	type CompatibilitySeverity,
} from "@solve-js/api/PackageCompatibility";
import { checkEngineVersionCompatibility } from "@solve-js/api/EngineVersionCompatibility";
import { ENGINE_VERSION } from "@solve-js/constants/version";

//#region Errors

/**
 * The failure a matcher throws when an expectation is not met.
 *
 * A dedicated `Error` subclass rather than a bare `throw new Error`, so a
 * caller (or a reporter) can tell a kit assertion failure apart from an
 * unrelated exception with `instanceof`, and so the structured `expected` and
 * `actual` fields survive alongside the human-readable message. This is NOT an
 * {@link EngineError}: that type classifies pipeline-stage failures inside the
 * engine, whereas this classifies a test-assertion mismatch, a different
 * concern that would be miscategorised under any of `EngineError`'s categories.
 */
export class ExpectationError extends Error {
	/** A short, machine-readable label for which expectation failed. */
	readonly code: string;
	/** What the matcher was told to expect, in plain words. */
	readonly expected?: string;
	/** What it found instead. */
	readonly actual?: string;

	constructor(init: { code: string; message: string; expected?: string; actual?: string }) {
		super(init.message);
		this.name = "ExpectationError";
		this.code = init.code;
		this.expected = init.expected;
		this.actual = init.actual;
		// Restore the prototype chain across the ES5 `Error` transpile target,
		// so `instanceof ExpectationError` holds for callers.
		Object.setPrototypeOf(this, ExpectationError.prototype);
	}
}

//#endregion

//#region createTestEngine

/** Options for {@link createTestEngine}. */
export interface TestEngineOptions {
	/** Locale passed to the engine. Defaults to `"en"`. */
	locale?: string;
	/**
	 * Whether to load the engine's built-in packages (arithmetic, units, dates,
	 * and the rest) before the packages under test. Defaults to `true`, because
	 * almost every package builds on arithmetic and most authors want a
	 * realistic engine. Set `false` to test a package in isolation.
	 */
	includeBuiltins?: boolean;
}

/**
 * Build an {@link ExpressionEngine} loaded with the packages under test.
 *
 * The built-in packages load first (unless {@link TestEngineOptions.includeBuiltins}
 * is `false`), then each package in `packages` is registered in order, exactly
 * as a host would. Registration is honest: a package whose declared
 * `engineVersion` the running engine does not satisfy, or whose lexer keyword
 * collides with a built-in, throws here rather than being swallowed. That is
 * deliberately different from passing packages straight to the
 * `ExpressionEngine` constructor, which contains a bad package by logging and
 * continuing, useful in production, wrong for a test that needs to know the
 * package it is testing actually loaded.
 *
 * Call {@link ExpressionEngine.clear} when a test is finished with the engine
 * if the test creates many, see the engine's own lifecycle note.
 *
 * @example
 * ```ts
 * const engine = createTestEngine([myPackage]);
 * const engineOnly = createTestEngine([myPackage], { includeBuiltins: false });
 * ```
 */
export function createTestEngine(
	packages: IEnginePackage[] = [],
	options: TestEngineOptions = {},
): ExpressionEngine {
	const { locale = "en", includeBuiltins = true } = options;

	// Built-ins go through the constructor (their own containment applies);
	// the packages under test go through registerPackage() afterwards so their
	// failures surface as thrown errors instead of being logged and skipped.
	const engine = new ExpressionEngine(locale, false, undefined, undefined, includeBuiltins ? BUILTIN_PACKAGES : []);
	for (const pkg of packages) {
		engine.registerPackage(pkg);
	}
	return engine;
}

//#endregion

//#region expectExpression

/**
 * The normalised outcome of evaluating one expression, computed once when
 * {@link expectExpression} runs and read by every matcher on the result.
 *
 * The engine surfaces a failure two different ways, and a package author should
 * not have to know which: a parse/eval error is THROWN as an
 * {@link EngineError} (with a `.code`), while a plugin-raised error is RETURNED
 * as a {@link Value} of {@link ValueType.Error} (its `value` is the code, its
 * `unit` is the message). Both collapse to the `"error"` status here. A value
 * still resolving asynchronously is its own `"pending"` status, since the kit
 * evaluates synchronously and cannot report a final number for it.
 */
type Outcome =
	| { status: "value"; value: Value }
	| { status: "pending"; value: Value }
	| { status: "error"; code: string; message: string; source: EngineError | Value };

/** Evaluate `expression` on `engine` and collapse both failure shapes to one outcome. */
function evaluate(engine: ExpressionEngine, expression: string): Outcome {
	try {
		const [value] = engine.evaluateExpression(expression);
		if (value === undefined) {
			// evaluateExpression() always returns a single-element array; an
			// empty one would be an engine invariant break, reported as such
			// rather than as a silent pass.
			return {
				status: "error",
				code: "NO_RESULT",
				message: "Evaluation returned no value.",
				source: new Value(ValueType.Error, "NO_RESULT", "Evaluation returned no value."),
			};
		}
		if (value.type === ValueType.Error) {
			return {
				status: "error",
				code: String(value.value),
				message: typeof value.unit === "string" ? value.unit : "",
				source: value,
			};
		}
		if (value.type === ValueType.Pending) {
			return { status: "pending", value };
		}
		return { status: "value", value };
	} catch (error) {
		if (error instanceof EngineError) {
			return { status: "error", code: error.code, message: error.message, source: error };
		}
		// Anything else thrown (a bug in a plugin handler, say) is still a
		// failure, wrapped so the matcher has a code and message to report.
		const message = error instanceof Error ? error.message : String(error);
		return {
			status: "error",
			code: "UNKNOWN_ERROR",
			message,
			source: new Value(ValueType.Error, "UNKNOWN_ERROR", message),
		};
	}
}

/** Whether two numbers are equal within a small tolerance scaled to their magnitude. */
function numbersEqual(a: number, b: number): boolean {
	if (Object.is(a, b)) return true;
	if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
	const epsilon = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
	return Math.abs(a - b) <= epsilon;
}

/** A short, readable rendering of a value for an assertion message, e.g. `5 gp` or `"abc"`. */
function describeValue(value: Value): string {
	if (value.type === ValueType.String) return JSON.stringify(value.value);
	if (value.type === ValueType.Uom && typeof value.unit === "string") {
		return `${String(value.value)} ${value.unit}`;
	}
	return String(value.value);
}

/** A short, readable rendering of an outcome for an assertion message. */
function describeOutcome(outcome: Outcome): string {
	switch (outcome.status) {
		case "value":
			return describeValue(outcome.value);
		case "pending":
			return "a pending async value";
		case "error":
			return `an error (${outcome.code}: ${outcome.message})`;
	}
}

/**
 * Assertions about the result of one evaluated expression, returned by
 * {@link expectExpression}. Every matcher returns `this`, so assertions chain,
 * and throws an {@link ExpectationError} when it fails.
 */
export class ExpressionAssertion {
	constructor(
		private readonly expression: string,
		private readonly outcome: Outcome,
	) {}

	/** The raw resolved {@link Value}, for an assertion the matchers do not cover. Throws if the expression failed. */
	get value(): Value {
		if (this.outcome.status === "error") {
			throw new ExpectationError({
				code: "EXPECTED_VALUE",
				message: `Expected "${this.expression}" to evaluate, but it failed with ${describeOutcome(this.outcome)}.`,
				expected: "a resolved value",
				actual: describeOutcome(this.outcome),
			});
		}
		return this.outcome.value;
	}

	/**
	 * Assert the expression evaluated to a value (not an error, not a pending
	 * async result). Says nothing about what the value is.
	 */
	toEvaluate(): this {
		if (this.outcome.status !== "value") {
			throw new ExpectationError({
				code: "EXPECTED_EVALUATE",
				message: `Expected "${this.expression}" to evaluate to a value, but got ${describeOutcome(this.outcome)}.`,
				expected: "a resolved value",
				actual: describeOutcome(this.outcome),
			});
		}
		return this;
	}

	/**
	 * Assert the expression evaluated to `expected`, and, when `unit` is given,
	 * that the result carries exactly that unit. A number compares against the
	 * value's numeric magnitude within a small floating-point tolerance; a
	 * string compares against the value's own string; a boolean against its
	 * boolean reading. Omitting `unit` leaves the unit unchecked, so
	 * `toEqual(5)` passes for both `5` and `5 gp`.
	 */
	toEqual(expected: number | string | boolean, unit?: string): this {
		if (this.outcome.status !== "value") {
			throw new ExpectationError({
				code: "EXPECTED_EQUAL",
				message: `Expected "${this.expression}" to equal ${describeExpected(expected, unit)}, but got ${describeOutcome(this.outcome)}.`,
				expected: describeExpected(expected, unit),
				actual: describeOutcome(this.outcome),
			});
		}

		const value = this.outcome.value;
		let matches: boolean;
		if (typeof expected === "number") {
			matches = numbersEqual(value.toNumber(), expected);
		} else if (typeof expected === "boolean") {
			// A Boolean value stores the primitive directly; anything else can
			// never equal a boolean, so a mismatch reports the real value.
			matches = value.type === ValueType.Boolean && value.value === expected;
		} else {
			matches = valueToComparableString(value) === expected;
		}

		if (!matches) {
			throw new ExpectationError({
				code: "EXPECTED_EQUAL",
				message: `Expected "${this.expression}" to equal ${describeExpected(expected, unit)}, but it was ${describeValue(value)}.`,
				expected: describeExpected(expected, unit),
				actual: describeValue(value),
			});
		}

		if (unit !== undefined && value.unit !== unit) {
			throw new ExpectationError({
				code: "EXPECTED_UNIT",
				message: `Expected "${this.expression}" to carry the unit "${unit}", but it was ${value.unit === undefined ? "unitless" : `"${value.unit}"`}.`,
				expected: `unit "${unit}"`,
				actual: value.unit === undefined ? "no unit" : `unit "${value.unit}"`,
			});
		}

		return this;
	}

	/** Assert the expression failed (a thrown engine error or a plugin-raised error value). Says nothing about the code. */
	toBeError(): this {
		if (this.outcome.status !== "error") {
			throw new ExpectationError({
				code: "EXPECTED_ERROR",
				message: `Expected "${this.expression}" to fail, but it produced ${describeOutcome(this.outcome)}.`,
				expected: "an error",
				actual: describeOutcome(this.outcome),
			});
		}
		return this;
	}

	/**
	 * Assert the expression failed with exactly `code`, the error catalog code
	 * (e.g. `"UNDEFINED_VARIABLE"`, or a package's own code). Reports the code
	 * it actually got when they differ, so a near-miss is obvious.
	 */
	toFailWith(code: string): this {
		if (this.outcome.status !== "error") {
			throw new ExpectationError({
				code: "EXPECTED_FAIL_WITH",
				message: `Expected "${this.expression}" to fail with "${code}", but it produced ${describeOutcome(this.outcome)}.`,
				expected: `error code "${code}"`,
				actual: describeOutcome(this.outcome),
			});
		}
		if (this.outcome.code !== code) {
			throw new ExpectationError({
				code: "EXPECTED_FAIL_WITH",
				message: `Expected "${this.expression}" to fail with "${code}", but it failed with "${this.outcome.code}" (${this.outcome.message}).`,
				expected: `error code "${code}"`,
				actual: `error code "${this.outcome.code}"`,
			});
		}
		return this;
	}

	/**
	 * Assert the expression returned a value still resolving asynchronously.
	 * The kit evaluates synchronously, so a package whose result comes from an
	 * async resolver reports pending on first evaluation, this is how a test
	 * confirms the async path was taken without resolving it.
	 */
	toBePending(): this {
		if (this.outcome.status !== "pending") {
			throw new ExpectationError({
				code: "EXPECTED_PENDING",
				message: `Expected "${this.expression}" to be pending, but got ${describeOutcome(this.outcome)}.`,
				expected: "a pending async value",
				actual: describeOutcome(this.outcome),
			});
		}
		return this;
	}
}

/** Render an expected value (with optional unit) for an assertion message. */
function describeExpected(expected: number | string | boolean, unit?: string): string {
	const base = typeof expected === "string" ? JSON.stringify(expected) : String(expected);
	return unit === undefined ? base : `${base} ${unit}`;
}

/** The string a non-numeric value compares against in {@link ExpressionAssertion.toEqual}. */
function valueToComparableString(value: Value): string {
	// The stored primitive stringified. For a String value this is the string
	// itself; for a Hex value, its `0x...` text, which is what an author writes
	// in a `toEqual("0xff")` assertion.
	return String(value.value);
}

/**
 * Evaluate `expression` on `engine` and return an assertion object.
 *
 * The expression is evaluated once, immediately, and every matcher reads that
 * one outcome, so calling several matchers on the same result does not
 * re-evaluate.
 *
 * @example
 * ```ts
 * expectExpression(engine, "2 gp + 3 gp").toEqual(5, "gp");
 * expectExpression(engine, "gp").toFailWith("UNDEFINED_VARIABLE");
 * ```
 */
export function expectExpression(engine: ExpressionEngine, expression: string): ExpressionAssertion {
	return new ExpressionAssertion(expression, evaluate(engine, expression));
}

//#endregion

//#region expectPackage

/**
 * A modest set of everyday English words a package's keywords should not claim.
 *
 * A starting point for {@link PackageAssertion.notToShadow}, not an exhaustive
 * dictionary: it leans on the function words and common nouns/verbs a package
 * is most tempted to grab as a trigger (`price`, `of`, `per`, `sum`, `total`).
 * Pass your own list to check against the specific prose your package sits in.
 */
export const COMMON_PROSE_WORDS: readonly string[] = [
	"a", "an", "and", "or", "but", "if", "then", "the", "this", "that", "these", "those",
	"in", "on", "at", "to", "of", "for", "from", "with", "by", "as", "per", "into", "over",
	"is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
	"will", "would", "can", "could", "should", "may", "might", "must",
	"price", "cost", "value", "total", "sum", "count", "rate", "amount", "number",
	"time", "date", "day", "week", "month", "year", "hour", "minute", "second",
	"add", "buy", "sell", "hold", "make", "take", "give", "get", "set", "run",
	"up", "down", "out", "off", "all", "some", "any", "no", "not", "more", "less",
	"one", "two", "three", "first", "last", "next", "each", "every", "here", "there",
];

/** How strict {@link PackageAssertion.notToCollideWith} is about the conflicts it will accept. */
export type CollisionStrictness = "error" | "warning" | "info";

/** One shadowed word found by {@link PackageAssertion.notToShadow}: the prose word and how the package claims it. */
export interface ShadowedWord {
	/** The prose word the package claims. */
	word: string;
	/** Which descriptor field claims it. */
	via: "keyword" | "unit" | "operator" | "phrase";
	/** The token type the word becomes, when the field maps to one. */
	tokenType?: string;
}

/** Severities at or above the strictness threshold, ordered most to least severe. */
const SEVERITY_ORDER: CompatibilitySeverity[] = ["error", "warning", "info"];

/** Gather the single words a package claims through its declared vocabulary, which is where prose shadowing comes from. */
function claimedWords(pkg: IEnginePackage): ShadowedWord[] {
	const claimed: ShadowedWord[] = [];
	const vocab = pkg.lexerVocabulary;
	if (vocab?.keywords) {
		for (const [word, tokenType] of Object.entries(vocab.keywords)) {
			claimed.push({ word, via: "keyword", tokenType });
		}
	}
	if (vocab?.units) {
		for (const word of vocab.units) {
			claimed.push({ word, via: "unit" });
		}
	}
	if (vocab?.operators) {
		for (const [word, tokenType] of Object.entries(vocab.operators)) {
			claimed.push({ word, via: "operator", tokenType });
		}
	}
	if (pkg.phrases) {
		for (const [phrase, tokenType] of Object.entries(pkg.phrases)) {
			// A multi-word phrase is the SAFE pattern the trigger-words guide
			// recommends (`next friday` reserves neither word), so only a
			// single-word phrase can shadow a prose word.
			if (!phrase.includes(" ")) {
				claimed.push({ word: phrase, via: "phrase", tokenType });
			}
		}
	}
	return claimed;
}

/**
 * Assertions about a package's declared descriptor, returned by
 * {@link expectPackage}. These catch the three mistakes the issue calls out,
 * before the package is ever registered. Every matcher returns `this` and
 * throws an {@link ExpectationError} when it fails.
 */
export class PackageAssertion {
	constructor(private readonly pkg: IEnginePackage) {}

	/**
	 * Assert none of the package's claimed words shadow a prose word.
	 *
	 * A trigger word that is also an ordinary word turns a line of prose into
	 * arithmetic, the single most common package mistake and the subject of the
	 * trigger-words guide. This checks the words the package declares
	 * (lexer keywords, units, operators, and single-word phrases) against
	 * `words` (defaulting to {@link COMMON_PROSE_WORDS}), case-insensitively.
	 *
	 * @returns the shadowed words, empty when the package is clean, for a test
	 * that wants to inspect rather than assert.
	 */
	notToShadow(words: readonly string[] = COMMON_PROSE_WORDS): ShadowedWord[] {
		const prose = new Set(words.map((w) => w.toLowerCase()));
		const shadowed = claimedWords(this.pkg).filter((c) => prose.has(c.word.toLowerCase()));
		if (shadowed.length > 0) {
			const list = shadowed.map((s) => `"${s.word}" (${s.via})`).join(", ");
			throw new ExpectationError({
				code: "PACKAGE_SHADOWS_PROSE",
				message: `Package "${this.pkg.name}" claims prose word(s) as syntax: ${list}. A word that is also ordinary English turns prose into arithmetic; prefer a multi-word phrase or a form that requires a parenthesis.`,
				expected: "no prose words claimed as syntax",
				actual: list,
			});
		}
		return shadowed;
	}

	/**
	 * Assert the package does not collide with any of `others` in a way that
	 * would silently break one of them (two packages claiming the same lexer
	 * keyword, plugin-function index, async-resolver namespace, and so on).
	 *
	 * `strictness` sets which severities fail the assertion: `"error"` (the
	 * default) fails only on the collisions that always break something,
	 * `"warning"` also fails on the ones that silently pick a winner, `"info"`
	 * fails on cosmetic overlaps too.
	 *
	 * @returns the full compatibility report, so a test can inspect every
	 * conflict, including ones below the strictness threshold.
	 */
	notToCollideWith(
		others: IEnginePackage[],
		strictness: CollisionStrictness = "error",
	): CompatibilityReport {
		const report = checkPackageCompatibility(this.pkg, others);
		const threshold = SEVERITY_ORDER.indexOf(strictness);
		const failing = report.conflicts.filter(
			(c: CompatibilityConflict) => SEVERITY_ORDER.indexOf(c.severity) <= threshold,
		);
		if (failing.length > 0) {
			const list = failing.map((c) => `[${c.severity}] ${c.detail}`).join("\n");
			throw new ExpectationError({
				code: "PACKAGE_VOCABULARY_COLLISION",
				message: `Package "${this.pkg.name}" collides with another package:\n${list}`,
				expected: `no conflicts at or above "${strictness}" severity`,
				actual: `${failing.length} conflict(s)`,
			});
		}
		return report;
	}

	/**
	 * Assert the package's declared `engineVersion` range is satisfied by the
	 * running engine (or by `engineVersion` when given).
	 *
	 * A package that declares a range and never checks it resolves is the third
	 * mistake the issue names: it looks fine until the one engine version it
	 * cannot run against, where the range either fails to match or turns out to
	 * be a malformed string. A package with no declared range passes (no
	 * constraint is always compatible).
	 */
	toDeclareCompatibleEngineVersion(engineVersion: string = ENGINE_VERSION): this {
		const result = checkEngineVersionCompatibility(this.pkg, engineVersion);
		if (!result.compatible) {
			const detail =
				result.reason === "invalid-range"
					? `its range "${result.declaredRange}" is not valid semver`
					: `its range "${result.declaredRange}" is not satisfied by engine version "${result.engineVersion}"`;
			throw new ExpectationError({
				code: "PACKAGE_ENGINE_VERSION_INCOMPATIBLE",
				message: `Package "${this.pkg.name}" declares an engineVersion that will be rejected at registration: ${detail}.`,
				expected: `an engineVersion satisfied by "${engineVersion}"`,
				actual: `"${result.declaredRange}"`,
			});
		}
		return this;
	}
}

/**
 * Begin an assertion about a package's declared descriptor.
 *
 * @example
 * ```ts
 * expectPackage(myPackage).notToShadow(["price", "in", "of"]);
 * expectPackage(myPackage).notToCollideWith(BUILTIN_PACKAGES);
 * expectPackage(myPackage).toDeclareCompatibleEngineVersion();
 * ```
 */
export function expectPackage(pkg: IEnginePackage): PackageAssertion {
	return new PackageAssertion(pkg);
}

//#endregion
