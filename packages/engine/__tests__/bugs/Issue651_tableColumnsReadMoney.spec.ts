import { describe, expect, test } from "@jest/globals";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #651: the column summaries read plain numbers only, so a money cell was
 * dropped without a word (`500`, `$200`, `1,200` totalled 1,700), a column of
 * money was refused, grouping in the wrong place was read as grouping (`12,57`
 * as 1,257) and a percentage was dropped. They now read cells through the
 * lookup's reader and combine them as `total above` combines the same figures
 * on lines.
 */

function read(result: ParsingResult): string[] {
	return result.lines.map((line) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : ""));
}

/** The answer to `form` over a one-column table of `cells`, checked to agree on both passes. */
function over(cells: string[], form: string): string {
	const text = ["| item | cost |", "|---|---|", ...cells.map((cell, i) => `| r${i} | ${cell} |`), "", `${form} of column "cost" above`].join("\n");
	const batch = read(newTrackedEngine().parseDocument(text, { inputType: "markdown" }));
	expect(read(evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }))).toEqual(batch);
	return batch[batch.length - 1];
}

describe("money in a column", () => {
	test.each([
		["total", "= $700.00"],
		["average", "= $350.00"],
		["min", "= $200.00"],
		["max", "= $500.00"],
		["median", "= $350.00"],
		["spread", "= $300.00"],
		["count", "= 2"],
	])("%s over $500 and $200", (form, expected) => {
		expect(over(["$500", "$200"], form)).toBe(expected);
	});

	test("an ISO code after the amount reads as money", () => {
		expect(over(["1,200 GBP", "£300"], "total")).toBe("= £1,500.00");
	});

	test("a negative amount of money is read", () => {
		expect(over(["$500", "-$50"], "total")).toBe("= $450.00");
	});

	test("the standard deviation is in the currency, and the variance is refused by name", () => {
		expect(over(["$500", "$300"], "stdev")).toBe("= $100.00");
		expect(over(["$500", "$300"], "variance")).toBe("The variance of column \"cost\" would be in USD squared, which is not an amount of money; its standard deviation is in USD");
	});
});

describe("adversarial", () => {
	test("a symbol with no amount, and misgrouped money, are text and skipped", () => {
		expect(over(["$", "$1,2", "$10"], "total")).toBe("= $10.00");
	});

	test("a column of only text still says it has nothing to add", () => {
		expect(over(["n/a", "tbc"], "total")).toBe("Column \"cost\" has no number or money cells to aggregate (a cell with a unit is not read yet)");
	});

	test("a unit cell is still not read, and says so", () => {
		expect(over(["5 km", "3 km"], "total")).toMatch(/a cell with a unit is not read yet/);
	});

	test("a percentage is counted but not added, and the refusal names its line", () => {
		expect(over(["$10", "15%"], "count")).toBe("= 2");
		expect(over(["$10", "15%"], "max")).toBe("The \"cost\" cell on line 4 is a percentage, 15%: a column summary adds and compares figures, and a percentage is a proportion, not one of them");
	});

	test("a long money column totals without overflowing", () => {
		const cells = Array.from({ length: 20_000 }, () => "$1.25");
		expect(over(cells, "total")).toBe("= $25,000.00");
		expect(over(cells, "max")).toBe("= $1.25");
	});

	test("a plain decimal column is still exact", () => {
		expect(over(["0.1", "0.2"], "total")).toBe("= 0.30");
	});
});
