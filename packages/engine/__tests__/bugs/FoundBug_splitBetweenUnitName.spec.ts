import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { betweenUnitNormalizerRule } from "@solve-js/packages/datetime/normalizer/BetweenUnitNormalizerRule";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";

/**
 * Found bug: `split 10 KWD between 3` put the internal token name BETWEEN_UNIT
 * in front of the reader. The currency code `KWD` is a unit, and a unit
 * followed by `between` is the head of `days between <a> and <b>`, which the
 * datetime rule fuses into one BETWEEN_UNIT token; the split then stopped at a
 * token it had no words for.
 *
 * Already fixed on the current engine, by two earlier changes: the rule no
 * longer fuses a unit that directly follows a number (#739), which is the
 * amount's own unit, and a parse message names a token by what the reader
 * typed rather than by its type. This spec pins both, so the name cannot come
 * back through either route.
 */

function shown(line: string, engine = newTrackedEngine()): string {
	try {
		return formatValue(engine.evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function token(type: string, value: string, offset: number): Token {
	return new LexerToken(type, tokenTypeId(type), value, value, offset, 0, 1, offset + 1);
}

describe("the line that exposed it", () => {
	test.each([
		["split 10 KWD between 3", "3.333 KWD each, with 1 share paying 3.334 KWD"],
		["split 10 KWD between 3 people", "3.333 KWD each, with 1 share paying 3.334 KWD"],
		["split 10.5 KWD between 3", "3.500 KWD each"],
		["split 1,000 KWD between 3", "333.333 KWD each, with 1 share paying 333.334 KWD"],
		["split $10 between 3", "$3.33 each, with 1 share paying $3.34"],
		["split 10 m between 3", "3.33 m each"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("no split, answered or refused, names the internal token", () => {
		const lines = [
			"split 10 KWD between 3", "split KWD between 3", "split 10 KWD between", "split KWD 10 between 3",
			"split 10k KWD between 3", "split 10 KWD between x", "KWD between 3", "days between 3 and",
			"split 10 KWD evenly between 3", "split 10 KWD three ways",
		];
		for (const line of lines) {
			const text = shown(line);
			expect({ line, leaks: /BETWEEN_UNIT|[A-Z]{3,}_[A-Z]{3,}/.test(text) }).toEqual({ line, leaks: false });
		}
	});

	test("the duration form the rule exists for still reads", () => {
		expect(shown("days between 1 March 2026 and 11 March 2026")).toBe("10 days");
		expect(shown("how many days between 1 March 2026 and 11 March 2026")).toBe("10 days");
	});
});

describe("betweenUnitNormalizerRule, the part that fused the amount's unit", () => {
	const rule = betweenUnitNormalizerRule();

	test("a unit straight after a number is that amount's, and is not fused", () => {
		const tokens = [token("NUMBER", "10", 6), token("UNIT", "KWD", 9), token("BETWEEN", "between", 13), token("NUMBER", "3", 21)];
		expect(rule.match(tokens, 1)).toBeNull();
	});

	test("a unit opening the phrase is fused, and the fused value is the unit", () => {
		const tokens = [token("UNIT", "days", 0), token("BETWEEN", "between", 5), token("NUMBER", "3", 13)];
		const match = rule.match(tokens, 0);
		expect(match?.consumed).toBe(2);
		expect(match?.replacement[0].type).toBe("BETWEEN_UNIT");
		expect(match?.replacement[0].value).toBe("days");
	});

	test("hostile and boundary arguments decline rather than throw", () => {
		expect(rule.match([], 0)).toBeNull();
		expect(rule.match([token("UNIT", "days", 0)], 0)).toBeNull();
		expect(rule.match([token("IDENT", "how", 0), token("IDENT", "many", 4)], 0)).toBeNull();
		for (const word of PROTOTYPE_WORDS) {
			expect(rule.match([token("UNIT", word, 0), token("BETWEEN", "between", 1)], 0)?.replacement[0].value ?? word).toBe(word);
		}
	});
});

describe("adversarial", () => {
	test("security: prototype words as the currency or the count", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`split 10 ${word} between 3`);
				expectHonestLine(`split 10 KWD between ${word}`);
				expectHonestLine(`${word} between 3 and 4`);
			}
		});
	});

	test("security: look-alike and markup-shaped text around the split", () => {
		for (const line of fill("split 10 KWD between X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("split 10 KWD between 3".repeat(50));
	});

	test("realistic: the amount from the line above, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("bill = 10 KWD\nsplit bill between 3");
		expect(batch[1]).toBe("= 3.333 KWD each, with 1 share paying 3.334 KWD");
		expect(incremental[1]).toBe(batch[1]);
		expectHonestDocument("bill = 10\nsplit bill KWD between 3");
	});

	test("edge: numeric edges as the count", () => {
		for (const line of fill("split 10 KWD between X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("an EngineError from a malformed split names no token type", () => {
		try {
			newTrackedEngine().evaluateExpression("split KWD between 3");
		} catch (e) {
			expect(e).toBeInstanceOf(EngineError);
			expect((e as EngineError).message).not.toMatch(/BETWEEN_UNIT/);
		}
	});
});
