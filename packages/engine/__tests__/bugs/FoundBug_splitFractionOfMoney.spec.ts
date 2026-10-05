import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { terminatingDecimal, moneyExactMagnitude } from "@solve-js/vm/MoneyExact";
import { decimalToString } from "@solve-js/decimal";
import { expectsValueAt } from "@solve-js/normalizer/ValuePosition";
import { betweenUnitNormalizerRule } from "@solve-js/packages/datetime/normalizer/BetweenUnitNormalizerRule";
import { numberValue, numberValueRational, uomValue } from "@solve-js/vm/Value";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";

/**
 * Found bug: `split 1/2 KWD between 3` answered "0.17 /KWD each". Three parts
 * of the line went wrong in turn. After the word `split` the fraction was not
 * read as the amount it is, so `1/2 KWD` became one over two dinars, a rate per
 * dinar; the between-unit rule then read `KWD between` as the start of `days
 * between`; and half a dinar, held as the fraction 1/2 rather than a decimal,
 * was split as a double rather than to the fils.
 *
 * The `SPLIT` word is now a place a value starts (`expectsValueAt`), so the
 * fraction is bracketed as the amount, as it is on a line of its own; a unit
 * after a closing bracket is that amount's unit to the between-unit rule; and a
 * fraction that ends in base ten is exact money (`terminatingDecimal`), as the
 * literal `0.5` is.
 */

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test.each([
		["split 1/2 KWD between 3", "0.166 KWD each, with 2 shares paying 0.167 KWD"],
		["split (1/2) KWD between 3", "0.166 KWD each, with 2 shares paying 0.167 KWD"],
		["split 0.5 KWD between 3", "0.166 KWD each, with 2 shares paying 0.167 KWD"],
		["split 3/8 KWD between 2", "0.187 KWD each, with 1 share paying 0.188 KWD"],
		["split 1/2 USD between 3", "$0.16 each, with 2 shares paying $0.17"],
		["split 1/3 KWD between 3", "0.111 KWD each"],
		["split 1/2 between 3", "0.17 each"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("a fraction of money on a line of its own reads the same", () => {
		expect(shown("1/2 KWD")).toBe("0.500 KWD");
		expect(shown("days between 1 March 2026 and 5 March 2026")).toBe("4 days");
	});

	test("a count of zero shares is refused by name", () => {
		expect(shown("split 1/2 KWD between 0")).toBe("ERROR split: the number of shares must be a whole number of at least 1, not 0.");
	});
});

// ── The parts ────────────────────────────────────────────────────────────

describe("terminatingDecimal", () => {
	test("a denominator of twos and fives ends, to as many places as the larger count", () => {
		expect(decimalToString(terminatingDecimal({ n: 1n, d: 2n })!)).toBe("0.5");
		expect(decimalToString(terminatingDecimal({ n: 3n, d: 8n })!)).toBe("0.375");
		expect(decimalToString(terminatingDecimal({ n: -7n, d: 20n })!)).toBe("-0.35");
		expect(decimalToString(terminatingDecimal({ n: 5n, d: 1n })!)).toBe("5");
		expect(decimalToString(terminatingDecimal({ n: 0n, d: 1n })!)).toBe("0");
		expect(decimalToString(terminatingDecimal({ n: 1n, d: 1048576n })!)).toBe("0.00000095367431640625");
	});

	test("a recurring fraction is null, and so is a denominator that is not positive", () => {
		expect(terminatingDecimal({ n: 1n, d: 3n })).toBeNull();
		expect(terminatingDecimal({ n: 1n, d: 14n })).toBeNull();
		expect(terminatingDecimal({ n: 1n, d: 0n })).toBeNull();
		expect(terminatingDecimal({ n: 1n, d: -2n })).toBeNull();
	});

	test("a fraction that ends past the 34 places an exact decimal holds is null, and a huge denominator is answered quickly", () => {
		let twoTo = (n: number): bigint => {
			let out = 1n;
			for (let i = 0; i < n; i++) out *= 2n;
			return out;
		};
		expect(terminatingDecimal({ n: 1n, d: twoTo(34) })).not.toBeNull();
		expect(terminatingDecimal({ n: 1n, d: twoTo(35) })).toBeNull();
		const started = performance.now();
		expect(terminatingDecimal({ n: 1n, d: twoTo(10_000) })).toBeNull();
		expect(terminatingDecimal({ n: 1n, d: twoTo(10_000) * 3n })).toBeNull();
		expect(performance.now() - started).toBeLessThan(1_000);
		twoTo = () => 0n;
	});
});

describe("moneyExactMagnitude", () => {
	test("a fraction that ends is as exact as its decimal, one that recurs falls back to the double", () => {
		expect(decimalToString(moneyExactMagnitude(numberValueRational(0.5, { n: 1n, d: 2n }), "KWD")!)).toBe("0.5");
		// A recurring fraction has no exact decimal; its double is not one either.
		expect(moneyExactMagnitude(numberValueRational(1 / 3, { n: 1n, d: 3n }), "KWD")).toBeNull();
		// A bare double is exact only when it is whole, as before.
		expect(decimalToString(moneyExactMagnitude(numberValue(3), "USD")!)).toBe("3");
		expect(moneyExactMagnitude(numberValue(0.25), "USD")).toBeNull();
	});

	test("not money, and a unit named after an inherited property, is null", () => {
		expect(moneyExactMagnitude(numberValueRational(0.5, { n: 1n, d: 2n }), "m")).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(moneyExactMagnitude(uomValue(1, word), word)).toBeNull();
	});
});

function tokens(...types: string[]): Token[] {
	return types.map((type, i) => ({ type, typeId: tokenTypeId(type), value: type.toLowerCase(), text: type.toLowerCase(), offset: i * 4 }) as Token);
}

describe("expectsValueAt", () => {
	test("after the split word, as after an operator, and at the start", () => {
		expect(expectsValueAt(tokens("SPLIT", "NUMBER"), 1)).toBe(true);
		expect(expectsValueAt(tokens("PLUS", "NUMBER"), 1)).toBe(true);
		expect(expectsValueAt(tokens("NUMBER"), 0)).toBe(true);
	});

	test("not after a value, and past the end reads as after the last token", () => {
		expect(expectsValueAt(tokens("NUMBER", "UNIT"), 1)).toBe(false);
		expect(expectsValueAt(tokens("RPAREN", "UNIT"), 1)).toBe(false);
		expect(expectsValueAt([], 0)).toBe(true);
	});
});

describe("betweenUnitNormalizerRule", () => {
	const rule = betweenUnitNormalizerRule();
	const at = (types: string[], values: string[], pos: number) =>
		rule.match(types.map((type, i) => ({ type, typeId: tokenTypeId(type), value: values[i], text: values[i], offset: i * 4 }) as Token), pos);

	test("a unit after a closing bracket or a number is that amount's, not days between", () => {
		expect(at(["RPAREN", "UNIT", "BETWEEN", "NUMBER"], [")", "KWD", "between", "3"], 1)).toBeNull();
		expect(at(["NUMBER", "UNIT", "BETWEEN", "NUMBER"], ["3", "m", "between", "0"], 1)).toBeNull();
	});

	test("a unit that starts the line still begins days between", () => {
		expect(at(["UNIT", "BETWEEN", "NUMBER"], ["days", "between", "1"], 0)).not.toBeNull();
	});
});

describe("adversarial", () => {
	test("security: prototype words as the currency or the count, markup after the line, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`split 1/2 ${word} between 3`);
				expectHonestLine(`split 1/2 KWD between ${word}`);
			}
		});
		for (const line of fill("split 1/2 KWD between 3 X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("split 1/2 KWD between 1000000", { budgetMs: 2_000 });
	});

	test("realistic: the amount from the line above, a check of a share, both passes", () => {
		const { batch, incremental } = expectHonestDocument(":bill = 1/2 KWD\nsplit bill between 3\nsplit 1/2 KWD between 3");
		expect(batch[2]).toBe("= 0.166 KWD each, with 2 shares paying 0.167 KWD");
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge as the fraction's numerator, and negative and zero amounts", () => {
		for (const line of fill("split X/2 KWD between 3", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expectHonestLine("split -1/2 KWD between 3");
		expectHonestLine("split 0/2 KWD between 3");
	});
});
