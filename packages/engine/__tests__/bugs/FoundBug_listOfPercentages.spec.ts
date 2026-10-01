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
import { boolValue, errorValue, numberValue, percentageValue, uomValue, type MatrixData } from "@solve-js/vm/Value";
import { listFromCells, percentageCellRefused, percentText } from "@solve-js/vm/MatrixUnits";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a list of percentages kept them as fractions.
 *
 * `[100, 200] + [10%, 20%]` answered `[100.10, 200.20]`, where `100 + 10%` is
 * 110. A list cell holds a plain number, and the literal stored each
 * percentage as its fraction (`Value.toNumber`), so `[10%, 20%]` showed as
 * `[0.10, 0.20]` and every list form that met it read 0.1 and 0.2. A list that
 * knew its cells were percentages would have to carry that through every list
 * form (a sum, a product, an average, a conversion), and the engine already
 * refuses to write a list as a percentage, so a percentage as a cell of a plain
 * list is refused by name (`percentageCellRefused` in vm/MatrixUnits.ts,
 * reached from `listFromCells` for a literal, `map` and `vec2` alike), with the
 * forms that say what was meant. A percentage beside a list with a unit keeps
 * its own refusal (`MATRIX_CELL_NO_UNIT`).
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

/** The refusal for a cell of `pct`, written `fraction` as a number. */
function refusal(pct: string, fraction: string): string {
	return `LIST_PERCENTAGE_UNSUPPORTED: A list holds plain numbers, so it cannot hold ${pct} as a percentage. To take a share of each number, put the percentage outside the list, as in [100, 200] + 10%; to keep the fraction, write it as a number (${fraction} for ${pct}).`;
}

const TEN = refusal("10%", "0.1");

describe("the lines that exposed it", () => {
	test.each([
		["[100, 200] + [10%, 20%]", TEN],
		["[10%, 20%] + [100, 200]", TEN],
		["[10%, 20%]", TEN],
		["[10%]", TEN],
		["sum([10%, 20%])", TEN],
		["mean([10%, 20%])", TEN],
		["max([10%, 20%])", TEN],
		["[10%, 20%] * 2", TEN],
		["[10%, 20%][0]", TEN],
		["reduce(acc + x, [10%, 20%])", TEN],
		["[1, 7%]", refusal("7%", "0.07")],
		["[100, 12.5%]", refusal("12.5%", "0.125")],
		["[1, 2; 3, 50%]", refusal("50%", "0.5")],
		["[10 percent, 20 percent]", TEN],
		["[50%] in m", refusal("50%", "0.5")],
		["map(x%, [10, 20])", TEN],
		["vec2(10%, 20%)", TEN],
	])("%s is refused by name through evaluateExpression and evaluateLine", (line, answer) => {
		expect(outcome(line)).toBe(answer);
		expect(single(line)).toBe(answer);
	});

	test("a percentage in a list with a unit keeps its own refusal", () => {
		expect(outcome("[1 km, 5%]")).toBe("MATRIX_CELL_NO_UNIT: A list in km cannot hold a percentage: every cell of a list with a unit is an amount in it.");
		expect(outcome("[5%, 1 km]")).toBe("MATRIX_CELL_NO_UNIT: A list in km cannot hold a percentage: every cell of a list with a unit is an amount in it.");
	});

	test("the forms the refusal points at give the answers that were meant", () => {
		expect(outcome("[100, 200] + 10%")).toBe("[110, 220]");
		expect(outcome("[100, 200] + [10, 40]")).toBe("[110, 240]");
		expect(outcome("[0.1, 0.2]")).toBe("[0.10, 0.20]");
		expect(outcome("10% of [100, 200]")).toBe("[10, 20]");
		expect(outcome("map(x * 1%, [10, 20])")).toBe("[0.10, 0.20]");
		expect(outcome("100 + 10%")).toBe("110");
		expect(outcome("10% + 20%")).toBe("30.00%");
	});

	test("through both document passes, which agree", () => {
		expect(both(["rates = [10%, 20%]", "prices = [100, 200]", "prices + rates", "rate = 10%", "[rate, 20%]", "prices + rate"])).toEqual([
			`ERROR ${TEN.replace(/^[A-Z_]+: /, "")}`,
			"[100, 200]",
			// The first line failed, and its refusal reaches the line that reads rates.
			`ERROR ${TEN.replace(/^[A-Z_]+: /, "")}`,
			"10.00%",
			`ERROR ${TEN.replace(/^[A-Z_]+: /, "")}`,
			"[110, 220]",
		]);
	});
});

describe("the parts: percentageCellRefused and listFromCells", () => {
	test("ordinary: the message names the percentage and its fraction", () => {
		const refused = percentageCellRefused(percentageValue(0.1));
		expect(`${String(refused.errorCode)}: ${String(refused.errorMessage)}`).toBe(TEN);
		expect(String(percentageCellRefused(percentageValue(0.07)).errorMessage)).toContain("(0.07 for 7%)");
		expect(String(percentageCellRefused(percentageValue(1 / 3)).errorMessage)).toContain("33.33333333333333%");
	});

	test("boundary: zero, negative zero, a negative and a huge percentage", () => {
		expect(String(percentageCellRefused(percentageValue(0)).errorMessage)).toContain("(0 for 0%)");
		expect(String(percentageCellRefused(percentageValue(-0)).errorMessage)).toContain("(0 for 0%)");
		expect(String(percentageCellRefused(percentageValue(-0.5)).errorMessage)).toContain("(-0.5 for -50%)");
		expect(String(percentageCellRefused(percentageValue(1e300)).errorMessage)).toContain("1e+302%");
	});

	test("hostile: a percentage with no finite number is still named without a NaN or an infinity", () => {
		for (const fraction of [Infinity, -Infinity, NaN]) {
			const message = String(percentageCellRefused(percentageValue(fraction)).errorMessage);
			expect(message).toContain("cannot hold a percentage as a percentage");
			expect(message).not.toMatch(/NaN|Infinity|∞/);
		}
	});

	test("percentText moves the fraction's point exactly, and gives the extremes in exponent form", () => {
		expect(percentText(0.07)).toBe("7");
		expect(percentText(0.1)).toBe("10");
		expect(percentText(0.125)).toBe("12.5");
		expect(percentText(1.005)).toBe("100.5");
		expect(percentText(-0.5)).toBe("-50");
		expect(percentText(0)).toBe("0");
		expect(percentText(-0)).toBe("0");
		expect(percentText(1)).toBe("100");
		expect(percentText(2 ** 53 / 100)).toBe("9007199254740992");
		expect(percentText(1e300)).toBe("1e+302");
		expect(percentText(5e-324)).toBe("4.94e-322");
		expect(percentText(Number.MAX_VALUE)).toBe("∞");
	});

	test("listFromCells refuses a percentage cell of a plain list, and keeps the unit refusal for a list with a unit", () => {
		expect(listFromCells(1, 2, [numberValue(1), percentageValue(0.1)]).errorCode).toBe("LIST_PERCENTAGE_UNSUPPORTED");
		expect(listFromCells(1, 1, [percentageValue(0.1)]).errorCode).toBe("LIST_PERCENTAGE_UNSUPPORTED");
		expect(listFromCells(1, 2, [uomValue(1, "km"), percentageValue(0.1)]).errorCode).toBe("MATRIX_CELL_NO_UNIT");
		expect(listFromCells(1, 2, [percentageValue(0.1), uomValue(1, "km")]).errorCode).toBe("MATRIX_CELL_NO_UNIT");
	});

	test("listFromCells is unchanged for the cells it held before", () => {
		const plain = listFromCells(1, 3, [numberValue(1), boolValue(true), numberValue(3)]);
		expect((plain.value as MatrixData).data).toEqual([1, true, 3]);
		expect((listFromCells(1, 2, [uomValue(1, "km"), uomValue(500, "m")]).value as MatrixData).data).toEqual([1, 0.5]);
		expect(listFromCells(1, 2, [numberValue(1), errorValue("OWN", "own")]).errorCode).toBe("OWN");
		expect(listFromCells(1, 2, [errorValue("FIRST", "first"), percentageValue(0.1)]).errorCode).toBe("FIRST");
		expect((listFromCells(0, 0, []).value as MatrixData).data).toEqual([]);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as a cell or as the percentage is honest and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("[X%, 20%]", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
			for (const line of fill("[100, 200] + [X, 20%]", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
			for (const word of PROTOTYPE_WORDS) expectHonestDocument(`${word} = 10%\n[${word}, 20%]\n[100, 200] + ${word}`);
		});
	});

	test("a huge list with one percentage at the end, a long sum and deep brackets are refused within the budget", () => {
		expectHonestLine(`[${Array.from({ length: 300 }, (_, i) => String(i)).join(", ")}, 10%]`, { budgetMs: 5_000 });
		expectHonestLine(`[${RESOURCE_PROBES.longSum(2_000)}, 10%]`, { budgetMs: 5_000 });
		expectHonestLine(`[${RESOURCE_PROBES.deepParens(200)}%, 3]`, { budgetMs: 5_000 });
		expectHonestLine(`map(x%, ${RESOURCE_PROBES.hugeRange()})`, { budgetMs: 5_000 });
		expectHonestLine(`[${RESOURCE_PROBES.hugePower()}%]`, { budgetMs: 5_000 });
		expect(outcome(`[${Array.from({ length: 150 }, (_, i) => String(i)).join(", ")}, 10%]`)).toBe(TEN);
	});

	test("look-alike, invisible and markup-shaped text beside a percentage is read as text", () => {
		for (const edge of TEXT_EDGES) {
			expectHonestLine(`[${edge}%, 20%]`);
			expectHonestLine(`[${edge}, 20%]`);
		}
		expect(outcome("[10​%, 20%]")).toBe(TEN);
		expect(outcome("[١٠%, 20%]")).not.toMatch(/^\[/);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo, a unit that does not fit and a value from the line above", () => {
		expect(outcome("[10 percnt, 20%]")).not.toMatch(/^\[/);
		expect(outcome("[10%, 1 kg]")).toMatch(/^MATRIX_CELL_NO_UNIT: /);
		expect(both(["r = 10%", "[r, r]"])).toEqual(["10.00%", `ERROR ${TEN.replace(/^[A-Z_]+: /, "")}`]);
		expect(both(["r = 10%", "[r, r] < 1"])[1]).toBe(`ERROR ${TEN.replace(/^[A-Z_]+: /, "")}`);
	});

	test("the feature meeting the others: a comparison, a check, a conversion and a section", () => {
		expect(outcome("[10%, 20%] > 15%")).toBe(TEN);
		expect(outcome("check [10%, 20%] > 0")).toBe(TEN);
		expect(outcome("[10%, 20%] as sparkline")).toBe(TEN);
		expect(outcome("[1, 2] > 10%")).toBe("[true, true]");
		const doc = both(["# Rates", "[0.1, 0.2] * [100; 200]", "[10%, 20%]"]);
		expect(doc[1]).toBe("[50]");
		expect(doc[2]).toBe(`ERROR ${TEN.replace(/^[A-Z_]+: /, "")}`);
	});

	test("an edit from a number to a percentage in the list follows through both passes", () => {
		expect(both(["[100, 0.1]"])).toEqual(["[100, 0.10]"]);
		expect(both(["[100, 10%]"])).toEqual([`ERROR ${TEN.replace(/^[A-Z_]+: /, "")}`]);
	});
});

describe("adversarial: edge cases", () => {
	test("zero, negatives, the percentage edges and a quotient with no finite answer", () => {
		expect(outcome("[0%]")).toBe(refusal("0%", "0"));
		expect(outcome("[-0%]")).toBe(refusal("0%", "0"));
		expect(outcome("[-50%, 1]")).toBe(refusal("-50%", "-0.5"));
		expect(outcome("[1e400%]")).toMatch(/^PERCENTAGE_OVERFLOW: /);
		expect(outcome("[(1/0)%]")).toMatch(/^PERCENTAGE_OVERFLOW: /);
		expect(outcome("[(2^53)%]")).toBe(refusal("9007199254740992%", "90071992547409.92"));
	});

	test("every numeric edge as a percentage cell is honest, and the two document passes agree", () => {
		for (const line of fill("[(X)%, 1]", NUMERIC_EDGES)) expect(expectHonestLine(line, { allowNaN: true }).kind).not.toBe("value");
		for (const edge of NUMERIC_EDGES) expectHonestDocument(`p = (${edge})%\n[p, 1]`, { allowNaN: true });
	});

	test("CRLF, a trailing newline and padding", () => {
		expect(both(["[10%, 20%]\r", ""])).toEqual([`ERROR ${TEN.replace(/^[A-Z_]+: /, "")}`, ""]);
		expect(outcome("   [ 10% ,  20% ]   ")).toBe(TEN);
	});
});
