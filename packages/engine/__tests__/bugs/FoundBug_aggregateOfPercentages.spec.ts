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
import { Value, ValueType, boolValue, errorValue, numberValue, percentageValue, stringValue, uomValue } from "@solve-js/vm/Value";
import { isAggregateFigure, percentageAnswer, percentageMixRefused, percentageOperands, unifyQuantities } from "@solve-js/vm/VMConversion";
import { percentText } from "@solve-js/vm/PercentText";
import { percentText as percentTextFromLists } from "@solve-js/vm/MatrixUnits";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: an aggregate of percentages answered their fraction.
 *
 * `sum(10%, 20%)` and `total of 10%, 20%` answered 0.30, `average of 10%, 20%`
 * 0.15 and `max(10%, 20%)` 0.20: a percentage is held as its fraction, and the
 * comma aggregates read every operand as a magnitude (`unifyQuantities` in
 * vm/VMConversion.ts) and wrapped the answer as a plain number. A percentage
 * beside a number was added as its fraction too, so `sum(10%, 100)` was 100.10.
 *
 * Percentages alone now answer a percentage (`percentageOperands` finds the
 * set, `percentageAnswer` writes it), and a percentage beside anything else is
 * refused by name (`AGGREGATE_PERCENTAGE_MIXED`, `percentageMixRefused`). The
 * document aggregates (a line range, `total above` and its siblings, a section,
 * a tag) refused a percentage line outright; they now gather one as the comma
 * forms do (`isAggregateFigure`), so a column of rates totals to a percentage.
 * A table column keeps its own refusal of a percentage cell.
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

/** The refusal for 10% beside a value of `kind`, for an aggregate that does `verb`. */
function mixed(kind: string, verb: string): string {
	const share = verb === "added" ? "; to raise an amount by a percentage, write it as 100 + 10%" : "";
	return `AGGREGATE_PERCENTAGE_MIXED: A percentage (10%) and ${kind} cannot be ${verb} together: a percentage is a share of an amount, not an amount of its own. Write every value as a percentage, or write 10% as the number 0.1${share}.`;
}

describe("an aggregate of percentages answers a percentage", () => {
	test.each([
		["sum(10%, 20%)", "30.00%"],
		["total of 10%, 20%", "30.00%"],
		["sum of 10%, 20%", "30.00%"],
		["total(10%, 20%)", "30.00%"],
		["total of 10%, 20% and 30%", "60.00%"],
		["average of 10%, 20%", "15.00%"],
		["average(10%, 20%)", "15.00%"],
		["mean(10%, 20%)", "15.00%"],
		["mean of 10%, 20%", "15.00%"],
		["avg of 10%, 20%", "15.00%"],
		["max(10%, 20%)", "20.00%"],
		["min(10%, 20%)", "10.00%"],
		["max of 10%, 20%", "20.00%"],
		["larger of 10% and 20%", "20.00%"],
		["smaller of 10% and 20%", "10.00%"],
		["median(10%, 20%)", "15.00%"],
		["median of 10%, 20%, 40%", "20.00%"],
		["stdev(10%, 20%)", "5.00%"],
		["sample stdev of 10%, 20%", "7.07%"],
		["spread of 10%, 20%", "10.00%"],
		["mode of 10%, 10%, 20%", "10.00%"],
		["weighted average of 10% at 1, 20% at 3", "17.50%"],
		["hypot(3%, 4%)", "5.00%"],
		["average of 10%", "10.00%"],
		["sum(0.1%, 0.2%)", "0.30%"],
		["sum(12.5%, 12.5%)", "25.00%"],
	])("%s is %s on both single-line paths", (line, shown) => {
		expect(outcome(line)).toBe(shown);
		expect(single(line)).toBe(shown);
	});

	test("the answer is a percentage, so it goes on to work as one", () => {
		expect(newTrackedEngine().evaluateExpression("sum(10%, 20%)").type).toBe(ValueType.Percentage);
		expect(outcome("200 + sum(10%, 20%)")).toBe("260");
		// The total is formed in base ten, so its share of 200 is the whole number 60.
		expect(outcome("sum(10%, 20%) of 200")).toBe("60");
		expect(outcome("sum(10%, 20%) as number")).toBe("0.30");
		expect(outcome("max(10%, 20%) == 20%")).toBe("true");
	});

	test("what is unchanged: plain numbers, quantities, a count, and a weight written as a percentage", () => {
		expect(outcome("sum(10, 20)")).toBe("30");
		expect(outcome("total of 5 kg, 2 kg")).toBe("7.00 kg");
		expect(outcome("count of 10%, 20%")).toBe("2");
		expect(outcome("weighted average of 72 at 30%, 88 at 70%")).toBe("83.20");
		expect(outcome("10% + 20%")).toBe("30.00%");
	});

	test("a variance of percentages would be in percent squared, and is refused by name", () => {
		expect(outcome("variance of 10%, 20%")).toBe(
			"UNIT_POWER_UNSUPPORTED: A variance of percentages would be in percent squared, which is not a percentage. The standard deviation is the same spread as a percentage.",
		);
	});
});

describe("a percentage beside a value that is not one is refused by name", () => {
	test.each([
		["sum(10%, 100)", mixed("a number", "added")],
		["total of 10%, 0.2", mixed("a number", "added")],
		["sum(10%, 5 m)", mixed("an amount in m", "added")],
		["average of 10%, $5", mixed("an amount in USD", "averaged")],
		["max(10%, 0.5)", mixed("a number", "compared")],
		["min(100, 10%)", mixed("a number", "compared")],
		["sum(10%, true)", mixed("a true or false value", "added")],
		["median of 10%, 2", mixed("a number", "ordered")],
		["stdev of 10%, 2 kg", mixed("an amount in kg", "used in a standard deviation")],
		["mode of 10%, 3", mixed("a number", "counted for a mode")],
		["spread of 10%, 3", mixed("a number", "compared")],
		["weighted average of 10% at 1, 20 at 3", mixed("a number", "averaged")],
	])("%s", (line, refusal) => {
		expect(outcome(line)).toBe(refusal);
		expect(single(line)).toBe(refusal);
	});

	test("a value with no numeric reading keeps its own refusal, which comes first", () => {
		expect(outcome(`sum(10%, "a")`)).toMatch(/^AGGREGATE_NON_NUMERIC: Text cannot be added/);
	});
});

describe("the document aggregates gather percentages as the comma forms do", () => {
	test("total above, average above, the block questions, a line range, a section and a tag", () => {
		expect(both(["10%", "20%", "total above"])[2]).toBe("30.00%");
		expect(both(["10%", "20%", "average above"])[2]).toBe("15.00%");
		expect(both(["10%", "20%", "max above", "min above", "median above", "count above"]).slice(2)).toEqual(["20.00%", "10.00%", "15.00%", "2"]);
		expect(both(["10%", "20%", "sum(line 1 : line 2)", "average(line 1 : line 2)"]).slice(2)).toEqual(["30.00%", "15.00%"]);
		expect(both(["# Rates", "10%", "20%", "# Totals", `total of section "Rates"`, `average of section "Rates"`]).slice(4)).toEqual(["30.00%", "15.00%"]);
		expect(both(["rate = 10% #a", "rate2 = 20% #a", "total of #a", "average of #a"]).slice(2)).toEqual(["30.00%", "15.00%"]);
	});

	test("a lone sum or total under a column of percentages totals it", () => {
		expect(both(["10%", "20%", "sum"])[2]).toBe("30.00%");
		expect(both(["10%", "20%", "total"])[2]).toBe("30.00%");
	});

	test("a column mixing a percentage with a number is refused, never added as 0.1", () => {
		expect(both(["100", "10%", "total above"])[2]).toBe(`ERROR ${mixed("a number", "added").replace(/^AGGREGATE_PERCENTAGE_MIXED: /, "")}`);
		expect(both(["$100", "10%", "sum(line 1 : line 2)"])[2]).toMatch(/^ERROR A percentage \(10%\) and an amount in USD cannot be added together/);
	});

	test("a table column keeps its own refusal of a percentage cell", () => {
		const lines = both(["| item | rate |", "| --- | --- |", "| a | 10% |", "| b | 20% |", `sum of column "rate"`]);
		expect(lines[4]).toMatch(/^ERROR The "rate" cell on line 3 is a percentage, 10%/);
	});

	test("names from the lines above reach the comma form", () => {
		expect(both(["a = 10%", "b = 20%", "total of a, b", "average(a, b)", "max(a, b)"]).slice(2)).toEqual(["30.00%", "15.00%", "20.00%"]);
	});
});

describe("percentageOperands", () => {
	test("ordinary: every operand a percentage, or none", () => {
		expect(percentageOperands([percentageValue(0.1), percentageValue(0.2)], "added")).toBe(true);
		expect(percentageOperands([numberValue(1), uomValue(2, "m")], "added")).toBe(false);
	});

	test("boundary: no operands, one percentage, the mix found wherever it sits", () => {
		expect(percentageOperands([], "added")).toBe(false);
		expect(percentageOperands([percentageValue(0)], "added")).toBe(true);
		const late = percentageOperands([numberValue(1), numberValue(2), percentageValue(0.1)], "added");
		expect(late).toBeInstanceOf(Value);
		expect((late as Value).errorCode).toBe("AGGREGATE_PERCENTAGE_MIXED");
		const early = percentageOperands([percentageValue(0.1), numberValue(1)], "compared");
		expect((early as Value).errorMessage).toContain("cannot be compared together");
	});

	test("hostile: a boolean, a text and an error beside a percentage are a mix, not a percentage", () => {
		for (const other of [boolValue(true), stringValue("constructor"), errorValue("X", "y")]) {
			const result = percentageOperands([percentageValue(0.1), other], "added");
			expect((result as Value).errorCode).toBe("AGGREGATE_PERCENTAGE_MIXED");
		}
	});
});

describe("percentageMixRefused", () => {
	test("ordinary: names the percentage, the other kind and the fraction", () => {
		expect(percentageMixRefused(percentageValue(0.1), numberValue(100), "averaged").errorMessage).toBe(mixed("a number", "averaged").replace(/^AGGREGATE_PERCENTAGE_MIXED: /, ""));
	});

	test("boundary: a verb that already says together, zero and a negative, a share of 7%", () => {
		expect(percentageMixRefused(percentageValue(0.1), numberValue(1), "stepped through together").errorMessage).toContain("cannot be stepped through together:");
		expect(percentageMixRefused(percentageValue(0), numberValue(1), "added").errorMessage).toContain("A percentage (0%)");
		expect(percentageMixRefused(percentageValue(-0), numberValue(1), "added").errorMessage).toContain("write 0% as the number 0");
		expect(percentageMixRefused(percentageValue(-0.5), numberValue(1), "added").errorMessage).toContain("write -50% as the number -0.5");
		expect(percentageMixRefused(percentageValue(0.07), numberValue(1), "added").errorMessage).toContain("write 7% as the number 0.07");
	});

	test("hostile: a percentage with no finite hundredfold is named without a figure", () => {
		const message = String(percentageMixRefused(percentageValue(1e307), numberValue(1), "added").errorMessage);
		expect(message.startsWith("A percentage and a number cannot be added together")).toBe(true);
		expect(message).not.toContain("Infinity");
		expect(percentageMixRefused(percentageValue(NaN), numberValue(1), "added").errorMessage).not.toContain("NaN");
	});
});

describe("percentageAnswer", () => {
	test("ordinary: a fraction is written as a percentage, with the sources it was given", () => {
		const answer = percentageAnswer(0.3);
		expect(answer.type).toBe(ValueType.Percentage);
		expect(formatValue(answer)).toBe("= 30.00%");
		const sources = [{ kind: "rate", label: "x" }] as unknown as Parameters<typeof percentageAnswer>[1];
		expect(percentageAnswer(0.3, sources).sources).toBe(sources);
	});

	test("boundary: zero, negative zero and a negative", () => {
		expect(formatValue(percentageAnswer(0))).toBe("= 0.00%");
		expect(formatValue(percentageAnswer(-0))).toBe("= 0.00%");
		expect(formatValue(percentageAnswer(-0.3))).toBe("= -30.00%");
	});

	test("hostile: a fraction too large to write a hundred times over, an infinity and NaN are refused", () => {
		expect(percentageAnswer(1e307).errorCode).toBe("PERCENTAGE_OVERFLOW");
		expect(percentageAnswer(Infinity).isError()).toBe(true);
		expect(percentageAnswer(NaN).isError()).toBe(true);
	});
});

describe("isAggregateFigure", () => {
	test("a number, a quantity and a percentage are figures; text, true or false and an error are not", () => {
		expect(isAggregateFigure(numberValue(1))).toBe(true);
		expect(isAggregateFigure(uomValue(1, "m"))).toBe(true);
		expect(isAggregateFigure(percentageValue(0.1))).toBe(true);
		expect(isAggregateFigure(stringValue("10%"))).toBe(false);
		expect(isAggregateFigure(boolValue(true))).toBe(false);
		expect(isAggregateFigure(errorValue("X", "y"))).toBe(false);
	});
});

describe("unifyQuantities carries the percentage", () => {
	test("percent is true for a set of percentages and false otherwise, and a mix is refused", () => {
		const pct = unifyQuantities([percentageValue(0.1), percentageValue(0.2)], "added");
		expect(pct instanceof Value ? null : pct.percent).toBe(true);
		const plain = unifyQuantities([numberValue(1), numberValue(2)], "added");
		expect(plain instanceof Value ? null : plain.percent).toBe(false);
		const mix = unifyQuantities([percentageValue(0.1), uomValue(1, "km")], "added");
		expect(mix instanceof Value ? mix.errorCode : null).toBe("AGGREGATE_PERCENTAGE_MIXED");
	});

	test("a text beside a percentage keeps the text refusal", () => {
		const text = unifyQuantities([percentageValue(0.1), stringValue("a")], "added");
		expect(text instanceof Value ? text.errorCode : null).toBe("AGGREGATE_NON_NUMERIC");
	});
});

describe("percentText, moved to its own leaf", () => {
	test("the list cells and the aggregates quote through the same function", () => {
		expect(percentTextFromLists).toBe(percentText);
		expect(percentText(0.1)).toBe("10");
		expect(percentText(-0)).toBe("0");
		expect(percentText(0.07)).toBe("7");
	});
});

describe("adversarial: security", () => {
	test("a prototype word beside a percentage is an unknown name, and Object.prototype is unchanged", () => {
		expectPrototypeUntouched(() => {
			for (const line of [...fill("sum(10%, X)", PROTOTYPE_WORDS), ...fill("average of X, 20%", PROTOTYPE_WORDS), ...fill("max(X%, 20%)", PROTOTYPE_WORDS)]) {
				const o = expectHonestLine(line);
				expect(o.kind).not.toBe("value");
			}
			for (const word of PROTOTYPE_WORDS) {
				expectHonestDocument(`${word} = 10%\n20%\ntotal above\nsum(${word}, 20%)`);
			}
		});
	});

	test("a long sum of percentages and a long column of them answer within budget", () => {
		// A line is held to a complexity score, so a hundred percentages is near the most one holds.
		const many = Array.from({ length: 100 }, () => "1%").join(", ");
		expect(outcome(`sum(${many})`)).toBe("100.00%");
		expect(outcome(`sum(${Array.from({ length: 600 }, () => "1%").join(", ")})`)).toMatch(/^EXPRESSION_TOO_(LONG|COMPLEX): /);
		expectHonestLine(`average of ${many}`);
		const column = [...Array.from({ length: 2_000 }, () => "1%"), "total above"].join("\n");
		const { batch } = expectHonestDocument(column);
		expect(batch[batch.length - 1]).toBe("= 2,000.00%");
		expectHonestLine(`sum(${RESOURCE_PROBES.longSum(2_000)}, 10%)`);
		expectHonestLine(`sum(${RESOURCE_PROBES.deepParens(500)}%, 10%)`);
		expectHonestLine(`sum(${RESOURCE_PROBES.hugePower()}%, 10%)`);
	});

	test("look-alike characters and markup-shaped text are read as what they are", () => {
		for (const line of fill("sum(X%, 20%)", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		expect(outcome("sum(١٠%, 20%)")).not.toBe("0.30");
		expect(outcome(`sum(10%, "<script>alert(1)</script>")`)).toMatch(/^AGGREGATE_NON_NUMERIC: Text cannot be added/);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo that drops a percent sign is refused, not added as a fraction", () => {
		expect(outcome("sum(10%, 20)")).toBe(mixed("a number", "added"));
		expect(outcome("average of 10%, 20")).toBe(mixed("a number", "averaged"));
	});

	test("a value from the line above, a check over it, and a what-if through it", () => {
		expect(both(["r = 10%", "sum(r, 20%)"])[1]).toBe("30.00%");
		expect(both(["r = 10%", "total of r, 20%"])[1]).toBe("30.00%");
		expect(both(["r = 10%", "t = total of r, 20%", "check t > 25%"])[2]).toBe("✓");
		expect(both(["r = 10%", "t = total of r, 20%", "line 2 with r = 15%"])[2]).toBe("35.00%");
	});

	test("an edit that turns a percentage into a number, through both passes", () => {
		expect(both(["10%", "20%", "total above"])[2]).toBe("30.00%");
		expect(both(["10%", "20", "total above"])[2]).toMatch(/^ERROR A percentage \(10%\) and a number cannot be added together/);
	});

	test("a total of percentages is a percentage of an amount below it", () => {
		expect(both(["tax = total of 15%, 5%", "$200 + tax"])[1]).toBe("$240.00");
	});
});

describe("adversarial: edge cases", () => {
	test("every numeric edge as a percentage in an aggregate is answered honestly", () => {
		for (const line of [...fill("sum(X%, 10%)", NUMERIC_EDGES), ...fill("max(X%, 10%)", NUMERIC_EDGES), ...fill("average of X%, 10%", NUMERIC_EDGES)]) {
			expectHonestLine(line, { allowNaN: true });
		}
	});

	test("zero, negative zero, negatives, cancelling and the largest doubles", () => {
		expect(outcome("sum(0%, -0%)")).toBe("0.00%");
		expect(outcome("sum(10%, -10%)")).toBe("0.00%");
		expect(outcome("sum(-10%, -20%)")).toBe("-30.00%");
		expect(outcome("min(-10%, -20%)")).toBe("-20.00%");
		expect(outcome("sum(1e308%, 1e308%)")).toBe(
			"PERCENTAGE_OVERFLOW: This is too large to write as a percentage: a percentage is a hundred times the number, and that is past about 1.8e308, the largest number that can be held.",
		);
		expectHonestLine("sum((2^53)%, 1%)");
	});

	test("CRLF and a trailing newline in a column of percentages", () => {
		const { batch } = expectHonestDocument("10%\r\n20%\r\ntotal above\n");
		expect(batch[2]).toBe("= 30.00%");
	});
});

describe("found while fixing, now fixed (FoundBug_percentageArithmetic)", () => {
	// A share of a share is a share, so `product of`, which multiplies with
	// `*`, answers a percentage (see vm/PercentArithmetic.ts).
	test("product of 10%, 20% is a percentage", () => {
		expect(outcome("product of 10%, 20%")).toBe("2.00%");
	});

	// A total of percentages is formed in base ten, so it is the double the
	// 30% it shows holds (see percentSum and percentTotal in vm/ExactDecimals.ts).
	test("10% + 20% == 30% is true", () => {
		expect(outcome("10% + 20% == 30%")).toBe("true");
	});

	test("sum(10%, 20%) == 30% is true", () => {
		expect(outcome("sum(10%, 20%) == 30%")).toBe("true");
	});

	// A list holds plain numbers, so a sweep of a line that answers a
	// percentage is refused by name rather than listed as fractions.
	test("a sweep of a line that answers a percentage does not list the fractions", () => {
		expect(both(["r = 10%", "z = r", "line 2 for r from 10% to 30% step 10%"])[2]).toMatch(/^ERROR With r at 10%, line 2 answers 10%, a percentage/);
	});
});
