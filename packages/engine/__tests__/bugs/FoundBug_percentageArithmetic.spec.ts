import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, numberValue, numberValueUncertain, percentageValue, uomValue } from "@solve-js/vm/Value";
import { percentPower, percentProduct, percentQuotient, percentSum, percentTotal, percentWeightedMean } from "@solve-js/vm/ExactDecimals";
import { percentageOverNumber, percentageTimesPercentage, percentageToPower } from "@solve-js/vm/PercentArithmetic";
import { sweepPercentageRefused } from "@solve-js/packages/whatif/WhatIfPluginFunctions";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bugs: a percentage multiplied, divided or raised lost its kind; a sum
 * of percentages did not equal the percentage it showed; and a sweep of a line
 * that answers a percentage listed the fractions.
 *
 * `10% * 20%` and `product of 10%, 20%` answered 0.02, `10% / 2` 0.05 and
 * `10% ^ 2` 0.01: `*`, `/` and `^` read a percentage as its fraction and wrote
 * a plain number. A share of a share is now a share (`percentageTimesPercentage`),
 * half a share is a share (`percentageOverNumber`), and so is a power of one
 * (`percentageToPower`), in vm/PercentArithmetic.ts. A percentage times a plain
 * number keeps its documented reading, the share of that number (`50% * 30` is
 * 15), and a percentage of an amount is still the amount.
 *
 * `10% + 20% == 30%` and `sum(10%, 20%) == 30%` were false: the fractions were
 * added as doubles, 0.1 + 0.2, which is not the double 0.3 that 30% holds. Each
 * percentage answer is now formed in base ten from the decimals the
 * percentages were typed as (`percentSum` and its siblings in
 * vm/ExactDecimals.ts), so it is the double the percentage written as that
 * decimal holds, and `==`, `!=` and `check` agree with what is shown.
 *
 * `line 2 for r from 10% to 30% step 10%`, where line 2 answers a percentage,
 * answered `[0.10, 0.20, 0.30]`: a list holds plain numbers. It is refused by
 * name (`SWEEP_ANSWER_PERCENTAGE`), as a list with a percentage cell is, with
 * the form that sweeps: a line giving the answer as a number.
 */

/** A line's answer through evaluateExpression, or `CODE: message` for a refusal. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** A line's answer through the single-line entry point evaluateLine, or `CODE: message`. */
function single(line: string): string {
	try {
		const value = newTrackedEngine().evaluateLine(1, line);
		if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
		return formatValue(value).replace(/^=\s*/, "");
	} catch (error) {
		if (error instanceof EngineError) return `${error.code}: ${error.message}`;
		throw error;
	}
}

/** The kind of value a line answers. */
function kind(line: string): ValueType {
	return newTrackedEngine().evaluateExpression(line).type;
}

/** A document line's answer, or `ERROR <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "ERROR no line";
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	if (line.result.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return formatValue(line.result).replace(/^=\s*/, "");
}

/** Each line of a document through both document passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** The sweep refusal for a line that answers `answer` with r at `input`. */
function sweepRefusal(input: string, answer: string, line = 2, name = "r"): string {
	return `With ${name} at ${input}, line ${line} answers ${answer}, a percentage, and a sweep lists its answers in a list, which holds plain numbers, not percentages. To sweep it, add a line that gives the answer as a number, such as "line ${line} * 100" for its percentage points, and sweep that line.`;
}

describe("a share of a share, half a share and a power of one are percentages", () => {
	test.each([
		["10% * 20%", "2.00%"],
		["20% * 10%", "2.00%"],
		["10% of 20%", "2.00%"],
		["20% of 10%", "2.00%"],
		["product of 10%, 20%", "2.00%"],
		["product of 10%, 20% and 50%", "1.00%"],
		["50% * 50% * 50%", "12.50%"],
		["10% / 2", "5.00%"],
		["10% / 3", "3.33%"],
		["6% / 12", "0.50%"],
		["10% / 0.5", "20.00%"],
		["10% / -2", "-5.00%"],
		["10% ^ 2", "1.00%"],
		["50% ^ 3", "12.50%"],
		["50% ^ 0.5", "70.71%"],
		["10% ^ 0", "100.00%"],
		["-10% * 20%", "-2.00%"],
	])("%s is %s on both single-line paths", (line, shown) => {
		expect(outcome(line)).toBe(shown);
		expect(single(line)).toBe(shown);
		expect(kind(line)).toBe(ValueType.Percentage);
	});

	test("the answer goes on to work as a percentage", () => {
		expect(outcome("100 + 6% / 12")).toBe("100.50");
		expect(outcome("$1000 * (6% / 12)")).toBe("$5.00");
		expect(outcome("200 + 10% * 20%")).toBe("204");
		expect(outcome("(10% * 20%) as number")).toBe("0.02");
		expect(outcome("(6% / 12) of 1200")).toBe("6");
	});

	test("what is unchanged: a share of a number or an amount, and a ratio of shares", () => {
		for (const [line, shown, type] of [
			["10% * 2", "0.20", ValueType.Number],
			["2 * 10%", "0.20", ValueType.Number],
			["50% * 30", "15", ValueType.Number],
			["100 * 40%", "40", ValueType.Number],
			["product of 10%, 2", "0.20", ValueType.Number],
			["10% * $5", "$0.50", ValueType.Uom],
			["$5 * 10%", "$0.50", ValueType.Uom],
			["10% * 5 m", "0.50 m", ValueType.Uom],
			["10% / 20%", "0.50", ValueType.Number],
			["200 / 10%", "2,000", ValueType.Number],
			["10% ^ -1", "10", ValueType.Number],
			["2 ^ 10%", "1.07", ValueType.Number],
		] as const) {
			expect(outcome(line)).toBe(shown);
			expect(kind(line)).toBe(type);
		}
	});

	test("a measurement keeps its own path: a percentage holds no uncertainty", () => {
		expect(outcome("10% / (2 +/- 0.1)")).toBe("0.05 ± 0.0025");
		expect(outcome("10% * (2 +/- 0.1)")).toBe("0.2 ± 0.01");
	});

	test("a percentage over zero has no percentage, and is refused as one", () => {
		const notFinite = "PERCENTAGE_NOT_FINITE: This has no percentage: its value is not a finite number, which is what dividing by zero gives.";
		expect(outcome("10% / 0")).toBe(notFinite);
		expect(outcome("10% / -0")).toBe(notFinite);
		expect(outcome("0% / 0")).toMatch(/^QUOTIENT_UNDEFINED: /);
	});

	test("a negative percentage to a fractional power is a real root or a refusal, never NaN", () => {
		expect(outcome("(-10%) ^ 0.5")).toBe(
			"POWER_NO_REAL_VALUE: (-10%)^0.5 has no real value: a negative percentage to a fractional power has one only when the fraction's denominator is odd, as in (-8%)^(1/3).",
		);
		expect(outcome("(-8%) ^ (1/3)")).toBe("-43.09%");
	});
});

describe("a percentage answer equals the percentage it shows", () => {
	test.each([
		["10% + 20% == 30%", "true"],
		["sum(10%, 20%) == 30%", "true"],
		["(total of 10%, 20%) == 30%", "true"],
		["30% - 10% == 20%", "true"],
		["10% + 20% != 30%", "false"],
		["10% + 20% > 30%", "false"],
		["10% + 20% >= 30%", "true"],
		["0.1% + 0.2% == 0.3%", "true"],
		["30% + 0.4 == 70%", "true"],
		["(average of 10%, 20%, 30%) == 20%", "true"],
		["(median of 10%, 20%) == 15%", "true"],
		["(spread of 10%, 30%) == 20%", "true"],
		["(weighted average of 10% at 1, 20% at 3) == 17.5%", "true"],
		["10% * 20% == 2%", "true"],
		["(product of 10%, 20%) == 2%", "true"],
		["10% / 2 == 5%", "true"],
		["10% ^ 2 == 1%", "true"],
		["0.1 + 0.2 == 0.3", "true"],
	])("%s is %s on both single-line paths", (line, shown) => {
		expect(outcome(line)).toBe(shown);
		expect(single(line)).toBe(shown);
	});

	test("a check agrees with ==, whichever comparison it makes", () => {
		expect(both(["10% + 20% == 30%", "check 10% + 20% == 30%", "check sum(10%, 20%) == 30%", "check 10% + 20% ≈ 30%", "check 10% * 20% == 2%"])).toEqual([
			"true",
			"✓",
			"✓",
			"✓",
			"✓",
		]);
	});

	test("the document totals equal what they show, through both passes", () => {
		expect(both(["10%", "20%", "total above", "prev == 30%"]).slice(2)).toEqual(["30.00%", "true"]);
		expect(both(["10%", "20%", "30%", "average above", "prev == 20%"]).slice(3)).toEqual(["20.00%", "true"]);
		expect(both(["10%", "20%", "median above", "prev == 15%"]).slice(2)).toEqual(["15.00%", "true"]);
		expect(both(["10%", "20%", "sum(line 1 : line 2) == 30%"])[2]).toBe("true");
		expect(both(["a = 10% #r", "b = 20% #r", "total of #r", "prev == 30%"]).slice(2)).toEqual(["30.00%", "true"]);
		expect(both(["# Rates", "10%", "20%", "# Total", `total of section "Rates"`, "prev == 30%"]).slice(4)).toEqual(["30.00%", "true"]);
	});
});

describe("a sweep of a line that answers a percentage is refused by name", () => {
	test("the refusal, through both passes, naming the first step", () => {
		expect(both(["r = 10%", "z = r", "line 2 for r from 10% to 30% step 10%"])[2]).toBe(`ERROR ${sweepRefusal("10%", "10%")}`);
		expect(both(["x = 1", "z = x * 10%", "y = z / 2", "line 3 for x from 1 to 3 step 1"])[3]).toBe("[0.05, 0.10, 0.15]");
		expect(both(["r = 10%", "z = r * 20%", "line 2 for r from 10% to 30% step 10%"])[2]).toBe(`ERROR ${sweepRefusal("10%", "2%")}`);
	});

	test("the form the refusal gives sweeps, listing percentage points", () => {
		expect(both(["r = 10%", "z = r", "line 2 * 100", "line 3 for r from 10% to 30% step 10%"])[3]).toBe("[10, 20, 30]");
		expect(both(["r = 10%", "z = r", "z as number", "line 3 for r from 10% to 30% step 10%"])[3]).toBe("[0.10, 0.20, 0.30]");
	});

	test("what is unchanged: a sweep through a percentage input that answers a number or money", () => {
		expect(both(["rate = 4%", "price = $100", "price * (1 + rate)", "line 3 for rate from 3% to 5% step 1%"])[3]).toBe("[$103.00, $104.00, $105.00]");
		expect(both(["rate = 4%", "100 + rate", "line 2 for rate from 10% to 30% step 10%"])[2]).toBe("[110, 120, 130]");
	});

	test("the single-line path has no document to sweep, and says so", () => {
		expect(single("line 1 for r from 10% to 30% step 10%")).toMatch(/^WHAT_IF_NO_DOCUMENT: A sweep only works inside a document/);
	});
});

describe("percentSum", () => {
	test("ordinary: the nearest double to the decimal sum or difference", () => {
		expect(percentSum(0.1, 0.2, 1)).toBe(0.3);
		expect(percentSum(0.3, 0.1, -1)).toBe(0.2);
		expect(percentSum(0.3, 0.4, 1)).toBe(0.7);
	});

	test("boundary: zero keeps the double's sign, a cancelling pair is zero, places differ", () => {
		expect(Object.is(percentSum(-0, -0, 1), -0)).toBe(true);
		expect(Object.is(percentSum(0.1, 0.1, -1), 0)).toBe(true);
		expect(percentSum(0.001, 0.2, 1)).toBe(0.201);
		expect(percentSum(1e-22, 0, 1)).toBe(1e-22);
	});

	test("hostile: a value with no short decimal, an infinity and NaN keep the double", () => {
		expect(percentSum(1 / 3, 0.1, 1)).toBe(1 / 3 + 0.1);
		expect(percentSum(Infinity, 0.1, 1)).toBe(Infinity);
		expect(percentSum(NaN, 0.1, 1)).toBeNaN();
		expect(percentSum(1e300, 1e300, 1)).toBe(2e300);
		expect(percentSum(1e-320, 0.1, 1)).toBe(1e-320 + 0.1);
	});
});

describe("percentProduct", () => {
	test("ordinary: a share of a share", () => {
		expect(percentProduct(0.1, 0.2)).toBe(0.02);
		expect(percentProduct(0.5, 0.25)).toBe(0.125);
	});

	test("boundary: zero, a negative, and places past what a double power of ten holds", () => {
		expect(percentProduct(0, 0.2)).toBe(0);
		expect(percentProduct(-0.1, 0.2)).toBe(-0.02);
		expect(percentProduct(1e-12, 1e-12)).toBe(1e-12 * 1e-12);
	});

	test("hostile: no short decimal, an infinity, NaN", () => {
		expect(percentProduct(1 / 3, 0.2)).toBe((1 / 3) * 0.2);
		expect(percentProduct(Infinity, 0.2)).toBe(Infinity);
		expect(percentProduct(NaN, 0.2)).toBeNaN();
	});
});

describe("percentQuotient", () => {
	test("ordinary: half a share, and a share over a third", () => {
		expect(percentQuotient(0.1, 2)).toBe(0.05);
		expect(percentQuotient(0.1, 3)).toBe(1 / 30);
		expect(percentQuotient(0.06, 12)).toBe(0.005);
	});

	test("boundary: a decimal divisor, a negative divisor, a zero dividend", () => {
		expect(percentQuotient(0.1, 0.5)).toBe(0.2);
		expect(percentQuotient(0.1, -2)).toBe(-0.05);
		expect(percentQuotient(0, 7)).toBe(0);
	});

	test("hostile: a divisor with no short decimal, an infinite divisor, NaN", () => {
		expect(percentQuotient(0.1, Math.PI)).toBe(0.1 / Math.PI);
		expect(percentQuotient(0.1, Infinity)).toBe(0);
		expect(percentQuotient(NaN, 2)).toBeNaN();
	});
});

describe("percentPower", () => {
	test("ordinary: a whole power", () => {
		expect(percentPower(0.1, 2, 0.1 ** 2)).toBe(0.01);
		expect(percentPower(0.5, 3, 0.5 ** 3)).toBe(0.125);
	});

	test("boundary: zero power, a negative power, a power that outgrows the places", () => {
		expect(percentPower(0.1, 0, 1)).toBe(1);
		expect(percentPower(0.1, -2, 0.1 ** -2)).toBe(100);
		expect(percentPower(0.1, 30, 0.1 ** 30)).toBe(0.1 ** 30);
	});

	test("hostile: a fractional, huge or non-finite power keeps the double", () => {
		expect(percentPower(0.5, 0.5, Math.sqrt(0.5))).toBe(Math.sqrt(0.5));
		expect(percentPower(0.5, 1e9, 0)).toBe(0);
		expect(percentPower(0.5, Infinity, 0)).toBe(0);
		expect(percentPower(NaN, 2, NaN)).toBeNaN();
	});
});

describe("percentTotal", () => {
	test("ordinary: a total and a mean", () => {
		expect(percentTotal([0.1, 0.2], false)).toBe(0.3);
		expect(percentTotal([0.1, 0.2, 0.3], true)).toBe(0.2);
		expect(percentTotal([0.1, 0.2], true)).toBe(0.15);
	});

	test("boundary: one value, a mean that does not terminate, mixed places", () => {
		expect(percentTotal([0.07], false)).toBe(0.07);
		expect(percentTotal([0.1, 0.1, 0.2], true)).toBe(0.4 / 3);
		expect(percentTotal([0.001, 0.2, 3], false)).toBe(3.201);
	});

	test("hostile: a value with no short decimal, NaN, a huge column", () => {
		expect(percentTotal([1 / 3, 0.1], false)).toBe(1 / 3 + 0.1);
		expect(percentTotal([NaN, 0.1], false)).toBeNaN();
		expect(percentTotal(Array.from({ length: 10_000 }, () => 0.01), false)).toBe(100);
	});
});

describe("percentWeightedMean", () => {
	test("ordinary: weights as numbers and as percentages", () => {
		expect(percentWeightedMean([0.1, 1, 0.2, 3], 0)).toBe(0.175);
		expect(percentWeightedMean([0.1, 0.3, 0.2, 0.7], 0)).toBe(0.17);
	});

	test("boundary: one pair, a mean that does not terminate, a negative weight", () => {
		expect(percentWeightedMean([0.07, 2], 0)).toBe(0.07);
		expect(percentWeightedMean([0.1, 1, 0.2, 2], 0)).toBe(0.5 / 3);
		expect(percentWeightedMean([0.1, -1, 0.2, 2], 0)).toBe(0.3);
	});

	test("hostile: a value or weight with no short decimal, NaN, zero weights keep the double given", () => {
		expect(percentWeightedMean([1 / 3, 1, 0.2, 1], 42)).toBe(42);
		expect(percentWeightedMean([0.1, Math.PI, 0.2, 1], 42)).toBe(42);
		expect(percentWeightedMean([NaN, 1], 42)).toBe(42);
		expect(percentWeightedMean([0.1, 0, 0.2, 0], 42)).toBe(42);
	});
});

describe("percentageTimesPercentage, percentageOverNumber and percentageToPower", () => {
	test("ordinary: each answers a percentage", () => {
		expect(formatValue(percentageTimesPercentage(percentageValue(0.1), percentageValue(0.2))!)).toBe("= 2.00%");
		expect(formatValue(percentageOverNumber(percentageValue(0.1), numberValue(2))!)).toBe("= 5.00%");
		expect(formatValue(percentageToPower(percentageValue(0.1), numberValue(2))!)).toBe("= 1.00%");
	});

	test("boundary: every other pair is left to its own path", () => {
		expect(percentageTimesPercentage(percentageValue(0.1), numberValue(2))).toBeNull();
		expect(percentageTimesPercentage(numberValue(2), percentageValue(0.1))).toBeNull();
		expect(percentageOverNumber(percentageValue(0.1), percentageValue(0.2))).toBeNull();
		expect(percentageOverNumber(numberValue(2), percentageValue(0.1))).toBeNull();
		expect(percentageOverNumber(percentageValue(0.1), uomValue(2, "m"))).toBeNull();
		expect(percentageOverNumber(percentageValue(0.1), numberValueUncertain(2, 0.1))).toBeNull();
		expect(percentageToPower(numberValue(2), percentageValue(0.1))).toBeNull();
		expect(percentageToPower(percentageValue(0.1), percentageValue(0.5))).toBeNull();
	});

	test("hostile: a zero divisor, a zero to a negative power, an overflow, a negative root", () => {
		expect(percentageOverNumber(percentageValue(0.1), numberValue(0))!.errorCode).toBe("PERCENTAGE_NOT_FINITE");
		expect(percentageToPower(percentageValue(0), numberValue(-2))!.errorCode).toBe("PERCENTAGE_NOT_FINITE");
		expect(percentageTimesPercentage(percentageValue(1e200), percentageValue(1e200))!.errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(percentageToPower(percentageValue(-0.1), numberValue(0.5))!.errorCode).toBe("POWER_NO_REAL_VALUE");
		expect(percentageToPower(percentageValue(NaN), numberValue(2))).toBeNull();
	});
});

describe("sweepPercentageRefused", () => {
	test("ordinary: names the step, the answer and the line to sweep instead", () => {
		expect(sweepPercentageRefused("r", percentageValue(0.1), 2, percentageValue(0.1)).errorMessage).toBe(sweepRefusal("10%", "10%"));
	});

	test("boundary: a number input, a zero answer, a negative answer", () => {
		expect(sweepPercentageRefused("x", numberValue(3), 4, percentageValue(0)).errorMessage).toBe(sweepRefusal("3", "0%", 4, "x"));
		expect(sweepPercentageRefused("x", numberValue(3), 4, percentageValue(-0.25)).errorMessage).toContain("answers -25%, a percentage");
	});

	test("hostile: a prototype word as the name, an answer too large to write", () => {
		const refusal = sweepPercentageRefused("constructor", numberValue(1), 2, percentageValue(1e307));
		expect(refusal.errorCode).toBe("SWEEP_ANSWER_PERCENTAGE");
		expect(refusal.errorMessage).toContain("With constructor at 1, line 2 answers a percentage, and");
		expect(refusal.errorMessage).not.toContain("Infinity");
	});
});

describe("adversarial: security", () => {
	test("a prototype word in a product or quotient of percentages, and Object.prototype is unchanged", () => {
		expectPrototypeUntouched(() => {
			for (const line of [...fill("X% * 20%", PROTOTYPE_WORDS), ...fill("10% / X", PROTOTYPE_WORDS), ...fill("product of X%, 20%", PROTOTYPE_WORDS)]) {
				expect(expectHonestLine(line).kind).not.toBe("value");
			}
			for (const word of PROTOTYPE_WORDS) {
				expectHonestDocument(`${word} = 10%\nz = ${word} * 20%\nline 2 for ${word} from 10% to 30% step 10%`);
			}
		});
	});

	test("a long product, a long chain of sums, deep brackets and a huge power answer within budget", () => {
		expect(outcome(`product of ${Array.from({ length: 50 }, () => "99%").join(", ")}`)).toBe("60.50%");
		expect(outcome(`${Array.from({ length: 100 }, () => "1%").join(" + ")} == 100%`)).toBe("true");
		expectHonestLine(`${RESOURCE_PROBES.deepParens(500)}% * 20%`);
		expectHonestLine(`10% ^ ${RESOURCE_PROBES.hugePower()}`);
		expect(outcome("50% ^ 1e9")).toBe("0.00%");
		expectHonestLine(`${RESOURCE_PROBES.longSum(2_000)}% / 3`);
		const sweep = ["r = 10%", "z = r", `line 2 for r from 1% to ${RESOURCE_PROBES.longSum(10)}% step 1%`].join("\n");
		expectHonestDocument(sweep);
	});

	test("look-alike characters and markup-shaped text are read as what they are", () => {
		for (const line of fill("X% * 20%", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		expect(outcome("١٠% * 20%")).not.toBe("0.02");
		expect(outcome(`10% * "<script>alert(1)</script>"`)).not.toMatch(/^[0-9]/);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a monthly rate from an annual one, from the line above", () => {
		expect(both(["rate = 6%", "monthly = rate / 12", "$1000 + monthly", "monthly * $1000"]).slice(1)).toEqual(["0.50%", "$1,005.00", "$5.00"]);
	});

	test("a typo that drops a percent sign is a share of that number, as it always was", () => {
		expect(outcome("10% * 20")).toBe("2");
		expect(outcome("10% / 20")).toBe("0.50%");
	});

	test("a check over a product, and a what-if through it", () => {
		expect(both(["a = 10%", "b = a * 20%", "check b == 2%", "line 2 with a = 50%"]).slice(1)).toEqual(["2.00%", "✓", "10.00%"]);
	});

	test("an edit that turns a percentage into a number changes the kind, through both passes", () => {
		expect(both(["a = 10%", "a * 20%"])[1]).toBe("2.00%");
		expect(both(["a = 10", "a * 20%"])[1]).toBe("2");
	});

	test("a sweep whose answers turn from a number to a percentage is refused at that step", () => {
		const lines = both(["x = 1", "z = if x > 1 then 10% else 5", "line 2 for x from 1 to 3 step 1"]);
		expect(lines[2]).toBe(`ERROR ${sweepRefusal("2", "10%", 2, "x")}`);
	});
});

describe("adversarial: edge cases", () => {
	test("every numeric edge as a percentage in a product, a quotient and a power is answered honestly", () => {
		for (const line of [...fill("(X)% * 20%", NUMERIC_EDGES), ...fill("(X)% / 3", NUMERIC_EDGES), ...fill("(X)% ^ 2", NUMERIC_EDGES), ...fill("10% / (X)", NUMERIC_EDGES)]) {
			expectHonestLine(line, { allowNaN: true });
		}
	});

	test("zero, negative zero, negatives and the largest doubles", () => {
		expect(outcome("0% * 20%")).toBe("0.00%");
		expect(outcome("-0% * 20%")).toBe("0.00%");
		expect(outcome("-10% / -2")).toBe("5.00%");
		expect(outcome("-10% + -20% == -30%")).toBe("true");
		expect(outcome("1e200% * 1e200%")).toMatch(/^PERCENTAGE_OVERFLOW: /);
		expect(outcome("1e300% / 1e-10")).toMatch(/^PERCENTAGE_OVERFLOW: /);
		expect(outcome("1e-200% * 1e-200%")).toBe("0.00%");
	});

	test("2^53 and the 34-digit limit as a percentage", () => {
		expectHonestLine("(2^53)% * 1%");
		expectHonestLine("(2^53)% / 3");
		expectHonestLine("12345678901234567890123456789012345% * 1%");
		expect(outcome("(2^53)% + 1% > (2^53)%")).toBe("true");
	});

	test("CRLF and a trailing newline around a sweep and a total", () => {
		const { batch } = expectHonestDocument("r = 10%\r\nz = r * 2\r\nline 2 for r from 1% to 3% step 1%\r\n10% + 20% == 30%\n");
		expect(batch[2]).toBe("= [0.02, 0.04, 0.06]");
		expect(batch[3]).toBe("= true");
	});
});
