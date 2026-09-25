import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Issue #703: the engine had `total of`, `average of`, `median of`, `total
 * above`, `sum above` and `average above`, but not their neighbouring
 * spellings (`sum of`, `mean of`, `avg of`, `min of`, `max of`, `product of`),
 * the spreadsheet calls over plain values (`sum(1, 2, 3)`, `mean(...)`,
 * `median(...)`, `stdev(...)`), or the other questions of the block above
 * (`count above`, `min above`, `max above`, `median above`).
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const shown = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${shown}` : shown;
	});
}

const batch = (text: string) => read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
const incremental = (text: string) => read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }));

describe("the list spellings", () => {
	test.each([
		["sum of 1, 2, 3", "total of 1, 2, 3", "6"],
		["sum of 1, 2 and 3", "total of 1, 2 and 3", "6"],
		["mean of 1, 2, 3", "average of 1, 2, 3", "2"],
		["avg of 1, 2, 3", "average of 1, 2, 3", "2"],
		["min of 4, 2, 9", "smaller of 2 and 4", "2"],
		["max of 4, 2, 9", "max(4, 2, 9)", "9"],
		["product of 2, 3 and 4", "2 * 3 * 4", "24"],
	])("%s is %s", (spelling, same, answer) => {
		expect(show(spelling)).toBe(show(same));
		expect(show(spelling)).toBe(answer);
	});

	test("money and units, in the unit written first", () => {
		expect(show("max of $5, $7 and $3")).toBe("$7.00");
		expect(show("min of 5 kg, 300 g")).toBe("300.00 g");
		expect(show("product of 2 m, 3 m")).toBe("6.00 m²");
		expect(show("sum of 1.2 km, 800 m")).toBe(show("total of 1.2 km, 800 m"));
	});

	test("mixed measures are refused, as average of already refuses them", () => {
		expect(show("mean of 5 kg, 3 m")).toBe("mass and length cannot be averaged");
		expect(show("max of 5 kg, 3 m")).toMatch(/cannot be/);
	});

	test("min and max keep their other meanings where no of follows", () => {
		expect(show("30 min")).toBe("30.00 min");
		expect(show("max(1, 2)")).toBe("2");
		expect(show("min(4, 2, 9)")).toBe("2");
	});
});

describe("the calls over plain values", () => {
	test.each([
		["sum(1, 2, 3)", "6"],
		["sum(1, 2)", "3"],
		["sum($5, $10)", "$15.00"],
		["total(1, 2, 3)", "6"],
		["average(1, 2, 3)", "2"],
		["average(4, 8)", "6"],
		["mean(1, 2, 3)", "2"],
		["mean(5)", "5"],
		["median(1, 5, 3)", "3"],
		["stdev(1, 2, 3)", "0.82"],
		["mean(1, 2, 3) * 2", "4"],
		["sum(1, sum(2, 3, 4), 5)", "15"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("stdev(...) is the population form, as stdev of is", () => {
		expect(show("stdev(1, 2, 3)")).toBe(show("stdev of 1, 2, 3"));
		expect(show("stdev(1, 2, 3)")).not.toBe(show("sample stdev of 1, 2, 3"));
	});

	test("map-reduce keeps its calls", () => {
		expect(show("sum(x, [10, 20, 30])")).toBe("60");
		expect(show("sum(10*x, 0:9)")).toBe("450");
		expect(show("sum(x, 0:3)")).toBe("6");
		expect(show("prod(x, [1, 2, 3])")).toBe("6");
	});

	test("a line range keeps its call", () => {
		expect(batch("10\n20\n30\naverage(line 1 : line 3)\nsum(line 1 : line 2)")).toEqual(["10", "20", "30", "20", "30"]);
	});

	test("mean, median and stdev stay names where no bracket follows", () => {
		expect(batch("mean = 4\nmean * 2\nmedian = 3\nmedian + 1")).toEqual(["4", "8", "3", "4"]);
	});

	test("an empty call and a function of one's own under these names are refused by name", () => {
		expect(show("mean()")).toBe('THROWS "mean()" has no values to work on: list them inside the brackets, as in mean(1, 2, 3).');
		expect(show("mean(a, b) = (a + b) / 2")).toBe('THROWS "mean(...)" is the built-in average, so a function of your own needs another name.');
		expect(show("stdev(a) = a")).toBe('THROWS "stdev(...)" is the built-in standard deviation, so a function of your own needs another name.');
	});

	test("a bracketed list is one value, refused as the list forms refuse it", () => {
		expect(show("mean([1, 2, 3])")).toMatch(/^A bracketed list cannot be averaged/);
	});
});

describe("the other questions of the block above", () => {
	const column = "10\n20\n30\n";
	test.each([
		["avg above", "20"],
		["mean above", "20"],
		["count above", "3"],
		["min above", "10"],
		["max above", "30"],
		["median above", "20"],
	])("%s", (form, answer) => {
		const answers = batch(column + form);
		expect(answers[3]).toBe(answer);
		expect(incremental(column + form)).toEqual(answers);
	});

	test("each is a summary line, so the next one reads past it", () => {
		expect(batch("10\n20\n30\ncount above\nmax above\nmedian above\ntotal above")).toEqual(["10", "20", "30", "3", "30", "20", "60"]);
	});

	test("a subtotal inside the block is not one of its figures", () => {
		expect(batch("10\n20\ntotal above\n5\nmax above\ncount above")).toEqual(["10", "20", "30", "5", "20", "3"]);
	});

	test("units read in the unit at the top of the column, and mixed measures are refused", () => {
		expect(batch("5 kg\n300 g\n2 kg\nmax above\nmin above")).toEqual(["5.00 kg", "300.00 g", "2.00 kg", "5.00 kg", "0.30 kg"]);
		expect(batch("5 kg\n3 m\nmax above")[2]).toBe("ERROR mass and length cannot be compared");
	});

	test("a blank line, a heading and a comment behave as they do for total above", () => {
		expect(batch("10\n20\n\n5\n7\nmax above")[5]).toBe("7");
		expect(batch("10\n# Costs\n5\n7\ncount above")[4]).toBe("2");
		expect(batch("10\n// note\n30\nmin above")[3]).toBe("10");
	});

	test("with nothing above, they say so", () => {
		expect(batch("max above")[0]).toMatch(/^ERROR No lines above to aggregate/);
	});
});

describe("adversarial", () => {
	test("prototype words are not aggregate calls", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(show(`${word}(1, 2, 3)`)).not.toMatch(/^\d/);
			expect(show(`${word} of 1, 2, 3`)).not.toMatch(/Cannot read|is not a function|of undefined/);
		}
	});

	test("an unclosed call is left as it was written", () => {
		expect(show("mean(1, 2, 3")).toMatch(/^THROWS/);
		expect(show("sum(1, 2, 3")).toMatch(/^THROWS/);
	});

	test("a long list adds up", () => {
		const values = Array.from({ length: 60 }, (_, i) => String(i + 1));
		expect(show(`sum(${values.join(", ")})`)).toBe("1,830");
		expect(show(`sum of ${values.join(", ")}`)).toBe("1,830");
	});
});
