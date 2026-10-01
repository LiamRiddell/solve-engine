import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { Value, bigIntValue, numberValue, stringValue } from "@solve-js/vm/Value";
import { infiniteResult, zeroDivisorQuotient } from "@solve-js/vm/IndeterminateQuotient";
import { percentageInfinite, percentageNotFinite, percentageOfNoNumber, percentageRefusal, toPercentage } from "@solve-js/vm/VMConversion";
import { exactIntegerArithmetic } from "@solve-js/vm/ExactIntegers";

/**
 * Found bug: `2^2000 as %` was refused with PERCENTAGE_NOT_FINITE, "its value
 * is not a finite number, which is what dividing by zero gives". 2^2000 was
 * not divided by anything: it is past about 1.8e308, the largest double, so it
 * is held as an infinity, and so is a typed `1e309`. The double cannot tell
 * that infinity from the one `1/0` gives, so the VM's `/` now marks an
 * infinity a zero divisor gave (`Value.divisionByZero`), `+`, `-`, `*`, `^`
 * and a minus sign carry the mark, and `percentageRefusal` reads it: a
 * division by zero keeps its message, a value that is no number at all (NaN)
 * says that, and any other infinity is too large, under PERCENTAGE_OVERFLOW,
 * the code a finite number too large for its percentage already takes.
 */

const TOO_LARGE = "This is too large to write as a percentage: the number is past about 1.8e308, the largest number that can be held.";
const DIVIDED = "This has no percentage: its value is not a finite number, which is what dividing by zero gives.";
const NO_NUMBER = "This has no percentage: its value is not a number at all, as an infinity less an infinity is not.";

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

describe("the lines that exposed it", () => {
	test.each(["2^2000 as %", "1e309 as %", "-(2^2000) in %", "1e308 * 10 as %", "2^1024 to %", "50% + 2^2000", "(2^2000) as percent"])("%s is too large", (line) => {
		expect(outcome(line)).toBe(`PERCENTAGE_OVERFLOW: ${TOO_LARGE}`);
	});

	test.each(["1/0 as %", "-1/0 as %", "1.5/0 as %", "40 is what % of 0", "40 is what % off 0", "40 is what % on 0", "40 as % of 0", "-(1/0) as %", "(1 - 40/0) as %", "(1/0) * 2 as %", "(1/0)^2 as %", "50% + 1/0"])("%s names the division by zero", (line) => {
		expect(outcome(line)).toBe(`PERCENTAGE_NOT_FINITE: ${DIVIDED}`);
	});

	test("0/0 is refused before it is a percentage, and an infinity less an infinity is no number", () => {
		expect(outcome("0/0 as %")).toMatch(/^QUOTIENT_UNDEFINED: /);
		expect(outcome("(1/0 - 1/0) as %")).toBe(`PERCENTAGE_NOT_FINITE: ${NO_NUMBER}`);
		expect(outcome("(1e309 - 1e309) as %")).toBe(`PERCENTAGE_NOT_FINITE: ${NO_NUMBER}`);
	});

	test("what was right stays right", () => {
		expect(outcome("1e308 as %")).toMatch(/^PERCENTAGE_OVERFLOW: This is too large to write as a percentage: a percentage is a hundred times/);
		expect(outcome("0.5 as %")).toBe("50.00%");
		expect(outcome("1/0")).toBe("∞");
		expect(outcome("2^2000")).toBe("∞");
		expect(outcome("1/0 + 1")).toBe("∞");
	});

	test("the boundary: a function does not carry the mark, so its infinity reads as too large", () => {
		expect(outcome("abs(1/0) as %")).toBe(`PERCENTAGE_OVERFLOW: ${TOO_LARGE}`);
	});
});

describe("percentageRefusal", () => {
	test("ordinary: each reason with its code", () => {
		expect(percentageRefusal(zeroDivisorQuotient(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY).errorMessage).toBe(DIVIDED);
		expect(percentageRefusal(numberValue(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY).errorMessage).toBe(TOO_LARGE);
		expect(percentageRefusal(numberValue(Number.NaN), Number.NaN).errorMessage).toBe(NO_NUMBER);
		expect(percentageRefusal(numberValue(1e308), 1e308).errorCode).toBe("PERCENTAGE_OVERFLOW");
	});

	test("boundary: either infinity, a marked NaN, and a whole number written with n", () => {
		expect(percentageRefusal(numberValue(Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY).errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(percentageRefusal(zeroDivisorQuotient(Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY).errorCode).toBe("PERCENTAGE_NOT_FINITE");
		const markedNaN = numberValue(Number.NaN);
		markedNaN.divisionByZero = true;
		expect(percentageRefusal(markedNaN, Number.NaN).errorMessage).toBe(NO_NUMBER);
		expect(percentageRefusal(bigIntValue(1n << 2000n), Number.POSITIVE_INFINITY).errorMessage).toMatch(/a percentage is a hundred times/);
	});

	test("hostile: text is answered, never thrown on", () => {
		expect(() => percentageRefusal(stringValue("constructor"), Number.POSITIVE_INFINITY)).not.toThrow();
	});

	test("the messages name no internal word", () => {
		for (const v of [percentageInfinite(), percentageNotFinite(), percentageOfNoNumber()]) {
			expect(v.errorMessage).not.toMatch(/Infinity|NaN|double|divisionByZero/);
		}
	});
});

describe("zeroDivisorQuotient and infiniteResult", () => {
	test("an infinity from a zero divisor is marked; a finite or NaN quotient is not", () => {
		expect(zeroDivisorQuotient(Number.POSITIVE_INFINITY).divisionByZero).toBe(true);
		expect(zeroDivisorQuotient(Number.NEGATIVE_INFINITY).divisionByZero).toBe(true);
		expect(zeroDivisorQuotient(Number.NaN).divisionByZero).toBeUndefined();
		expect(zeroDivisorQuotient(0).divisionByZero).toBeUndefined();
		expect(zeroDivisorQuotient(Number.POSITIVE_INFINITY).value).toBe(Number.POSITIVE_INFINITY);
	});

	test("an infinite result carries the mark of a marked operand only", () => {
		const marked = zeroDivisorQuotient(Number.POSITIVE_INFINITY);
		const plain = numberValue(1);
		expect(infiniteResult(plain, marked, Number.NEGATIVE_INFINITY).divisionByZero).toBe(true);
		expect(infiniteResult(marked, plain, Number.POSITIVE_INFINITY).divisionByZero).toBe(true);
		expect(infiniteResult(plain, numberValue(1e308), Number.POSITIVE_INFINITY).divisionByZero).toBeUndefined();
		expect(infiniteResult(marked, plain, Number.NaN).divisionByZero).toBeUndefined();
	});

	test("exactIntegerArithmetic, the slow path the VM's + - * ^ take, carries it", () => {
		const marked = zeroDivisorQuotient(Number.POSITIVE_INFINITY);
		expect(exactIntegerArithmetic(numberValue(1), marked, Number.NEGATIVE_INFINITY, "sub").divisionByZero).toBe(true);
		expect(exactIntegerArithmetic(numberValue(2), numberValue(2000), Number.POSITIVE_INFINITY, "pow").divisionByZero).toBeUndefined();
	});

	test("an arena recycle clears the mark", () => {
		const v = zeroDivisorQuotient(Number.POSITIVE_INFINITY);
		v.recycle(v.type, Number.POSITIVE_INFINITY);
		expect(v.divisionByZero).toBeUndefined();
		expect(toPercentage(v).errorCode).toBe("PERCENTAGE_OVERFLOW");
	});

	test("a clone keeps it, so a variable holding 1/0 still names the division", () => {
		const v: Value = zeroDivisorQuotient(Number.POSITIVE_INFINITY).clone();
		expect(toPercentage(v).errorCode).toBe("PERCENTAGE_NOT_FINITE");
	});
});

describe("adversarial", () => {
	test("security: prototype words, a long sum, deep brackets, a huge power and look-alike text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word} / 0 as %`);
				expectHonestDocument(`${word} = 2^2000\n${word} as %\n${word} = 1/0\n${word} as %`);
			}
		});
		expectHonestLine(`(${RESOURCE_PROBES.longSum(300)}) / 0 as %`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200)} / 0 as %`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.hugePower()} as %`, { budgetMs: 5_000 });
		for (const line of fill("X / 0 as %", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("１/０ as %");
	});

	test("realistic: a variable holding each infinity, a what-if, a check, and both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("big = 2^2000\nzero = 0\nbig as %\n40 is what % of zero\nline 3 with big = 0.5\ncheck 40 is what % of zero == 5%");
		expect(batch[2]).toBe(`ERROR ${TOO_LARGE}`);
		expect(batch[3]).toBe(`ERROR ${DIVIDED}`);
		expect(batch[4]).toBe("= 50.00%");
		expect(incremental).toEqual(batch);
		expect(expectHonestDocument("x = 1/0\nx as %").batch[1]).toBe(`ERROR ${DIVIDED}`);
	});

	test("edge: every numeric edge over zero and to a huge power, as a percentage, is a refusal with a reason, never Infinity%", () => {
		for (const line of [...fill("(X) / 0 as %", NUMERIC_EDGES), ...fill("(X) * 2^2000 as %", NUMERIC_EDGES), ...fill("50% + (X) / 0", NUMERIC_EDGES)]) {
			const result = expectHonestLine(line);
			if (result.kind === "value") expect({ line, text: result.text }).not.toEqual({ line, text: expect.stringMatching(/Infinity|NaN|∞%/) });
		}
	});
});
