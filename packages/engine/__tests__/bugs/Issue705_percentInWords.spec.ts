import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #705: `percent` worked only as a converter's name, so `15 percent of 60`
 * was a parse error, and the sentences people use for a change by a percentage
 * (`50 increased by 20%`, `reduce 50 by 20%`, `percent change from 50 to 75`,
 * `75 is what % more than 50`) were missing. Each now answers as the symbol
 * form it mirrors.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

describe("each form answers as the symbol form it mirrors", () => {
	test.each([
		["15 percent of 60", "15% of 60", "9"],
		["15 percentage of 60", "15% of 60", "9"],
		["5 percent", "5%", "5.00%"],
		["20 is what percent of 80", "20 is what % of 80", "25.00%"],
		["50 increased by 20%", "50 + 20%", "60"],
		["50 decreased by 20%", "50 - 20%", "40"],
		["50 reduced by 20%", "50 - 20%", "40"],
		["reduce 50 by 20%", "decrease 50 by 20%", "40"],
		["reduce 50 by 20 percent", "decrease 50 by 20%", "40"],
		["percent change from 50 to 75", "50 to 75 as %", "50.00%"],
		["percentage change from 50 to 75", "50 to 75 as %", "50.00%"],
		["percent change from 75 to 50", "75 to 50 as %", "-33.33%"],
		["75 is what % more than 50", "50 to 75 as %", "50.00%"],
		["75 is what percent more than 50", "50 to 75 as %", "50.00%"],
	])("%s is %s", (words, symbols, answer) => {
		expect(show(words)).toBe(show(symbols));
		expect(show(words)).toBe(answer);
	});

	test("less than is the fall from the second value, as a percentage of it", () => {
		expect(show("20 is what % less than 50")).toBe("60.00%");
		// A value above the other is a negative fall, and below it a negative rise.
		expect(show("40 is what % more than 50")).toBe("-20.00%");
	});
});

describe("with money, a unit and a negative change", () => {
	test.each([
		["$50 increased by 20%", "$60.00"],
		["10 km increased by 10%", "11.00 km"],
		["50 increased by -20%", "40"],
		["reduce $80 by 25%", "$60.00"],
		["percent change from $50 to $75", "50.00%"],
		["15 percent of $60", "$9.00"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});
});

describe("a zero base is refused as the symbol form refuses it", () => {
	test.each([
		["percent change from 0 to 5", "0 to 5 as %"],
		["5 is what % more than 0", "0 to 5 as %"],
	])("%s", (words, symbols) => {
		expect(show(words)).toBe(show(symbols));
		expect(show(words)).toMatch(/^A change from zero has no percentage/);
	});
});

describe("what it must not break", () => {
	test("percent and percentage stay the converter after as and in", () => {
		expect(show("0.25 as percent")).toBe("25.00%");
		expect(show("0.25 as percentage")).toBe("25.00%");
		expect(show("0.25 in percent")).toBe("25.00%");
	});

	test("the increase and decrease forms, and the other by phrases", () => {
		expect(show("increase 50 by 20%")).toBe("60");
		expect(show("decrease 50 by 20%")).toBe("40");
		expect(show("100 increase by 10%")).toBe("110");
		expect(show("3 multiplied by 4")).toBe("12");
		expect(show("12 divided by 4")).toBe("3");
	});

	test("reduce claims the word only before an amount changed by a percentage", () => {
		expect(show("reduce 50 by 20")).toBe('THROWS Unexpected token after expression: "50"');
		expect(doc("reduce = 5\nreduce * 2")).toEqual(["5", "10"]);
	});

	test("percent inside prose is not read as a number", () => {
		expect(show("100 percent sure")).toMatch(/^THROWS/);
		expect(show("percent change from 50")).toBe('THROWS Expected "to" and the new value, as in "percent change from 50 to 75"');
	});

	test("a name before percent is the rate", () => {
		expect(doc("rate = 15\nrate percent of 60")).toEqual(["15", "9"]);
	});
});

describe("adversarial", () => {
	test("prototype words before percent are names like any other", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(show(`${word} percent of 60`)).not.toMatch(/Cannot read|is not a function|of undefined/);
		}
	});

	test("prototype words after is what % are neither more nor less", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(show(`75 is what % ${word} than 50`)).toMatch(/^THROWS/);
		}
	});

	test("more or less without than is not the comparison", () => {
		expect(show("75 is what % more 50")).toMatch(/^THROWS/);
	});
});
