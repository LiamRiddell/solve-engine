/**
 * The prefix parselets that exist in two copies, checked against each other.
 *
 * `PrecedenceParser.parsePrefix()` handles NUMBER, BIGINT and LPAREN inline in
 * its Tier-1 switch and returns before the Tier-2 registry is ever consulted.
 * The registry still holds a parselet for each of those token types, and each
 * of those parselets carries a comment saying it must be kept in sync by hand
 * (`packages/arithmetic/parselets/NumberParselet.ts`, `GroupParselet.ts`,
 * `packages/biginteger/parselets/BigIntNumberParselet.ts`). Nothing checked
 * that it was.
 *
 * That matters for two reasons. The registry copy is what the "matched
 * parselets" diagnostic view reports, so a drifted copy makes the playground's
 * explanation of a line disagree with the line's own answer. And it is the
 * copy a third-party package reads to learn how a literal is meant to be
 * compiled. Coverage found the drift risk first: before this file
 * `GroupParselet.parse()` was 0% covered, and `NumberParselet.parse()` was
 * only reached by its three throw paths, so the entire literal-normalisation
 * half of the mirror was untested.
 *
 * Every expected value below is worked out from the literal, then asserted
 * against BOTH tiers, so a failure names which tier moved.
 */

import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { Lexer } from "@solve-js/lexer/Lexer";
import { GroupParselet } from "@solve-js/packages/arithmetic/parselets/GroupParselet";
import { NumberParselet } from "@solve-js/packages/arithmetic/parselets/NumberParselet";
import { BigIntNumberParselet } from "@solve-js/packages/biginteger/parselets/BigIntNumberParselet";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import type { Token } from "@solve-js/lexer/Token";
import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { ValueType, type MatrixData } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Tokens for a source string, with the whitespace the parser never sees. */
function lex(source: string, locale = "en"): Token[] {
	const lexer = new Lexer(locale);
	lexer.reset(source);
	return Array.from(lexer).filter(
		(t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"),
	);
}

/**
 * Run a Tier-2 parselet on its own and evaluate what it emitted.
 *
 * `rest` is the token stream the parselet is allowed to keep reading from,
 * which is how a parselet that consumes more than its own token (GroupParselet)
 * can be driven without going through the Tier-1 switch that would intercept
 * it. Loaded with `hasParens: false` so the balance scan does not invent a
 * matching bracket for the one that was deliberately left out.
 */
function runTierTwo(
	run: (parser: PrecedenceParser, builder: BytecodeBuilder) => void,
	rest: Token[] = [],
	locale = "en",
) {
	const parser = new PrecedenceParser(new ParseletRegistry(), 50, locale);
	parser.load(rest, false);
	const builder = new BytecodeBuilder();
	run(parser, builder);
	builder.emitOpcode(OpCode.HALT);
	return unwrapEvalResult(executeBytecode(builder.build(), createVM(sharedOpRegistry)));
}

/** What the real, Tier-1 evaluation path answers for the same source. */
function tierOne(source: string, locale = "en") {
	const engine = newTrackedEngine({ locale });
	const [value] = engine.evaluateExpression(source);
	return value;
}

describe("NumberParselet mirrors the Tier-1 NUMBER case", () => {
	/**
	 * Assert a hand-derived value against both tiers at once.
	 */
	function bothTiers(source: string, expected: number, locale = "en"): void {
		const token = lex(source, locale)[0];
		const parselet = new NumberParselet();
		const tierTwo = runTierTwo(
			(parser, builder) => parselet.parse(parser, token, builder),
			[],
			locale,
		);
		expect(tierTwo.toNumber()).toBe(expected);
		expect(tierOne(source, locale).toNumber()).toBe(expected);
	}

	test("plain decimals", () => {
		bothTiers("42", 42);
		bothTiers("3.5", 3.5);
		bothTiers("0", 0);
	});

	test("hexadecimal, binary and octal literals", () => {
		// 0xFF is 15*16 + 15 = 255. 0b1011 is 8 + 2 + 1 = 11. 0o17 is 8 + 7 = 15.
		bothTiers("0xFF", 255);
		bothTiers("0b1011", 11);
		bothTiers("0o17", 15);
	});

	test("uppercase base prefixes are the same literals", () => {
		// The lexer preserves case, so both tiers test for "0X" as well as
		// "0x". A mirror that only handled the lowercase spellings would send
		// "0XFF" to parseFloat and produce 0.
		bothTiers("0XFF", 255);
		bothTiers("0B1011", 11);
		bothTiers("0O17", 15);
	});

	test("chained dot-grouped thousands, the case the mirror was added for", () => {
		/*
		 * A literal with two or more dot-separated groups of exactly three
		 * digits cannot be a decimal, since a decimal has at most one point.
		 * "1.234.567" is therefore one million two hundred thirty-four
		 * thousand five hundred sixty-seven, and the failure this guards is
		 * parseFloat stopping at the second dot and silently answering 1.234,
		 * which discards over 99% of the number with no error.
		 */
		bothTiers("1.234.567", 1234567);
		bothTiers("12.345.678", 12345678);
	});

	test("a single dot group is still a decimal, in the en locale", () => {
		// Deliberately NOT treated as grouping: "1.234" is far more often a
		// three-decimal-place fraction, and the parselet's own comment says
		// changing that reading is out of scope.
		bothTiers("1.234", 1.234);
	});

	test("the locale's thousands separator is stripped", () => {
		// en groups with "," and separates decimals with ".", so "1,234.5" is
		// one thousand two hundred thirty-four and a half.
		bothTiers("1,234.5", 1234.5);
	});

	test("a base prefix with no digits after it is an error, not a silent NaN", () => {
		/*
		 * "0x" alone makes parseInt return NaN, which used to push straight
		 * through as a Number value holding NaN. Every expression built on
		 * top of it then read as NaN with nothing pointing at the cause.
		 */
		const parselet = new NumberParselet();
		for (const raw of ["0x", "0b", "0o"]) {
			const token = { ...lex("0")[0], value: raw, text: raw } as Token;
			expect(() =>
				runTierTwo((parser, builder) => parselet.parse(parser, token, builder)),
			).toThrow(/Invalid (hex|binary|octal) literal/);
		}
	});
});

describe("BigIntNumberParselet mirrors the Tier-1 BIGINT case", () => {
	function bothTiers(source: string, expected: bigint, locale = "en"): void {
		const token = lex(source, locale)[0];
		const parselet = new BigIntNumberParselet();
		const tierTwo = runTierTwo(
			(parser, builder) => parselet.parse(parser, token, builder),
			[],
			locale,
		);
		expect(tierTwo.type).toBe(ValueType.BigInt);
		expect(tierTwo.value).toBe(expected);

		const fromEngine = tierOne(source, locale);
		expect(fromEngine.type).toBe(ValueType.BigInt);
		expect(fromEngine.value).toBe(expected);
	}

	test("a plain bigint literal keeps every digit", () => {
		// Past 2^53 a double cannot hold consecutive integers, which is the
		// entire reason this type exists: 9007199254740993 is 2^53 + 1 and
		// rounds to 2^53 as a double.
		bothTiers("9007199254740993n", 9007199254740993n);
		bothTiers("123n", 123n);
	});

	test("thousands grouping the lexer coalesced in is stripped, not fed to BigInt", () => {
		/*
		 * The lexer swallows a group separator into the number token it is
		 * building, so the text reaching either tier still has it. BigInt()
		 * on that text throws a raw SyntaxError, which surfaced to the host
		 * as an INTERNAL error: the engine reporting its own bug for
		 * something a user typed.
		 */
		bothTiers("1,000n", 1000n);
		// Two or more dot groups cannot be a decimal in any locale, so this
		// one is stripped without consulting the locale at all.
		bothTiers("1.234.567n", 1234567n);
	});

	test("a dot group in a dot-decimal locale is refused by both tiers, not guessed at", () => {
		/*
		 * "1.000n" is one thousand to a German writer and a fractional value
		 * to an English one, and a bigint cannot hold the latter. Guessing
		 * wrong moves the value by three orders of magnitude silently, so the
		 * shared helper refuses instead. The two tiers must refuse together:
		 * one of them guessing is the drift this file exists to catch.
		 */
		const token = lex("1.000n")[0];
		const parselet = new BigIntNumberParselet();
		expect(() =>
			runTierTwo((parser, builder) => parselet.parse(parser, token, builder)),
		).toThrow(/not a whole number/);

		// Named EngineError rather than a raw SyntaxError out of BigInt(),
		// which is what this used to be and what reached the host labelled as
		// an engine bug. See `RobustnessMalformedInput.spec.ts` for why
		// EngineError specifically is the bar.
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression("1.000n")).toThrow(EngineError);
		expect(() => engine.evaluateExpression("1.000n")).toThrow(/not a whole number/);
	});

	test("the same literal is one thousand in a locale that groups with dots", () => {
		// German writes 1.000 for a thousand, so the identical text is a
		// legal bigint there. Both tiers read the engine's locale rather than
		// hardcoding one.
		bothTiers("1.000n", 1000n, "de");
	});
});

describe("GroupParselet mirrors the Tier-1 LPAREN case", () => {
	/**
	 * Drive the parselet with the tokens that FOLLOW the opening bracket,
	 * which is the state Tier 1 hands to a prefix parselet.
	 */
	function tierTwoGroup(inner: string) {
		const tokens = lex(`${inner})`);
		const lparen = lex("(")[0];
		const parselet = new GroupParselet();
		return runTierTwo(
			(parser, builder) => parselet.parse(parser, lparen, builder),
			tokens,
		);
	}

	test("one expression in brackets is plain grouping, not a one-element vector", () => {
		/*
		 * The count check is what separates the two meanings of the same
		 * token. `(2 + 3) * 4` is 20 because the bracket groups; if a single
		 * expression also emitted MAT_NEW, every parenthesised subexpression
		 * in the language would silently become a matrix.
		 */
		const grouped = tierTwoGroup("2 + 3");
		expect(grouped.type).toBe(ValueType.Number);
		expect(grouped.toNumber()).toBe(5);

		expect(tierOne("(2 + 3) * 4").toNumber()).toBe(20);
	});

	test("a comma-separated tuple is the bare-tuple vector literal", () => {
		/*
		 * `(x, y, z)` is documented as an alternative spelling of
		 * `vec3(x, y, z)`, and it produces a 1xN row vector. Both tiers must
		 * agree on the SHAPE as well as the contents: a column vector holding
		 * the same three numbers would transpose every subsequent operation.
		 */
		const tuple = tierTwoGroup("1, 2, 3");
		expect(tuple.type).toBe(ValueType.Matrix);
		const asMatrix = tuple.value as MatrixData;
		expect(asMatrix.rows).toBe(1);
		expect(asMatrix.cols).toBe(3);
		expect(Array.from(asMatrix.data)).toEqual([1, 2, 3]);

		const fromEngine = tierOne("(1, 2, 3)");
		expect(fromEngine.type).toBe(ValueType.Matrix);
		const engineMatrix = fromEngine.value as MatrixData;
		expect(engineMatrix.rows).toBe(1);
		expect(engineMatrix.cols).toBe(3);
		expect(Array.from(engineMatrix.data)).toEqual([1, 2, 3]);
	});

	test("a two-element and a four-element tuple work the same way", () => {
		// vec2 and vec4 are the other documented spellings, so the mirror has
		// to handle any arity rather than the three-element case alone.
		const pair = tierTwoGroup("7, 8");
		expect((pair.value as MatrixData).cols).toBe(2);
		expect(Array.from((pair.value as MatrixData).data)).toEqual([7, 8]);

		const quad = tierTwoGroup("1, 2, 3, 4");
		expect((quad.value as MatrixData).cols).toBe(4);
		expect(Array.from((quad.value as MatrixData).data)).toEqual([1, 2, 3, 4]);
	});

	test("the elements are full expressions, not just literals", () => {
		// Each slot goes through parseExpression(0), so arithmetic inside a
		// tuple has to bind before the comma splits it: 1+1 is one element
		// worth 2, not two elements.
		const computed = tierTwoGroup("1 + 1, 2 * 3");
		expect((computed.value as MatrixData).cols).toBe(2);
		expect(Array.from((computed.value as MatrixData).data)).toEqual([2, 6]);

		const fromEngine = tierOne("(1 + 1, 2 * 3)");
		expect(Array.from((fromEngine.value as MatrixData).data)).toEqual([2, 6]);
	});
});
