import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { indeterminateQuotient } from "@solve-js/vm/IndeterminateQuotient";
import { numberValue, percentageValue, stringValue, uomValue, boolValue } from "@solve-js/vm/Value";

/**
 * Found bug: `0/0` answered an unexplained `NaN`. `5/0` is ∞, the limit the
 * quotient grows towards as the divisor shrinks, but `0/0` has no such limit:
 * every number times 0 is 0, so every number is an equally good quotient, and
 * JavaScript's NaN reached the reader with nothing to say why. An infinity over
 * an infinity is the same case from the other end.
 *
 * Both are now refused by name (`QUOTIENT_UNDEFINED`), as `0 mod 0` already
 * is, by `indeterminateQuotient`, which the division opcode asks when a
 * quotient of two numbers comes out NaN and before it divides anything else.
 */

const MESSAGE = "0 divided by 0 has no single answer: every number times 0 is 0, so no one quotient is right.";

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `${v.errorCode}: ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test.each([["0/0"], ["-0/0"], ["0/-0"], ["-0/-0"], ["0 / 0.0"], ["0%/0%"], ["0 kg / 0 kg"], ["0 m / 0 s"], ["£0 / £0"], ["0/0 + 1"], ["check 0/0 == 0"]])("%s is refused by name", (line) => {
		expect(shown(line)).toBe(`QUOTIENT_UNDEFINED: ${MESSAGE}`);
	});

	test("an infinity over an infinity is refused the same way", () => {
		expect(shown("(1/0)/(1/0)")).toBe("QUOTIENT_UNDEFINED: ∞ divided by ∞ has no single answer: two infinities have no size to compare, so no one quotient is right.");
		expect(shown("(-1/0)/(1/0)")).toContain("QUOTIENT_UNDEFINED");
	});

	test("consistent with x/0: a nonzero number over zero is still ∞, with its sign", () => {
		expect(shown("5/0")).toBe("∞");
		expect(shown("-5/0")).toBe("-∞");
		expect(shown("0/5")).toBe("0");
		expect(shown("5 mod 0")).toContain("REMAINDER_UNDEFINED");
	});

	test("the boundary: a NaN that is not a division, and a list's cell, keep their NaN", () => {
		expect(shown("(1/0) - (1/0)")).toBe("NaN");
		expect(shown("[0, 1] / 0")).toBe("[NaN, ∞]");
	});
});

describe("indeterminateQuotient", () => {
	test("zero over zero, of either sign and as a quantity or a percentage", () => {
		for (const [l, r] of [
			[numberValue(0), numberValue(0)],
			[numberValue(-0), numberValue(0)],
			[numberValue(0), numberValue(-0)],
			[uomValue(0, "m"), uomValue(0, "s")],
			[percentageValue(0), numberValue(0)],
		] as const) {
			expect(indeterminateQuotient(l, r)?.errorCode).toBe("QUOTIENT_UNDEFINED");
		}
	});

	test("an infinity over an infinity, of either sign", () => {
		expect(indeterminateQuotient(numberValue(Infinity), numberValue(-Infinity))?.errorMessage).toContain("∞ divided by ∞");
		expect(indeterminateQuotient(numberValue(-Infinity), numberValue(-Infinity))?.errorCode).toBe("QUOTIENT_UNDEFINED");
	});

	test("every other quotient is null: a finite one, x over zero, zero over an infinity, and NaN operands", () => {
		expect(indeterminateQuotient(numberValue(1), numberValue(0))).toBeNull();
		expect(indeterminateQuotient(numberValue(0), numberValue(5))).toBeNull();
		expect(indeterminateQuotient(numberValue(0), numberValue(Infinity))).toBeNull();
		expect(indeterminateQuotient(numberValue(Infinity), numberValue(0))).toBeNull();
		expect(indeterminateQuotient(numberValue(NaN), numberValue(0))).toBeNull();
		expect(indeterminateQuotient(numberValue(Number.MAX_VALUE), numberValue(Number.MIN_VALUE))).toBeNull();
	});

	test("an operand that is not one number is null, including hostile text", () => {
		expect(indeterminateQuotient(stringValue("0"), numberValue(0))).toBeNull();
		expect(indeterminateQuotient(numberValue(0), boolValue(false))).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(indeterminateQuotient(stringValue(word), stringValue(word))).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: prototype words divided by zero, markup around the division, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectHonestLine(`${word} / 0`);
		});
		for (const line of fill("0/0 X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine(Array.from({ length: 1_000 }, () => "0/0").join(" + "), { budgetMs: 5_000 });
	});

	test("realistic: a zero from the line above over itself, a what-if and a total, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("x = 0\nx / x\ntotal above");
		expect(batch[1]).toBe(`ERROR ${MESSAGE}`);
		expect(incremental).toEqual(batch);
		expect(shown("sum(0/0, 1)")).toContain("QUOTIENT_UNDEFINED");
	});

	test("edge: every numeric edge over zero, and zero over every edge", () => {
		for (const line of fill("X / 0", NUMERIC_EDGES)) expectHonestLine(line);
		for (const line of fill("0 / X", NUMERIC_EDGES)) expectHonestLine(line);
		for (const line of fill("X / X", NUMERIC_EDGES)) expectHonestLine(line);
	});
});
