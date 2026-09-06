/**
 * One rule for aggregating quantities, through all four ways of naming a set.
 *
 * `total of $4.99, $12.50, $3.20` used to answer a bare `20.69`, dropping the
 * currency, and `total of 1.2 km, 3 km, 800 m` used to answer `804.20`, adding
 * kilometres to metres as though they were the same number. The document forms
 * did not: they carried the unit, but refused a column that mixed spellings of
 * one measure rather than converting it.
 *
 * The rule now, everywhere: read the whole set in the first unit written, and
 * refuse a set that mixes measures by naming the two dimensions. The four
 * shapes are pinned to the same answers here, because the drift this catches is
 * one of them going its own way again.
 */
import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { newTrackedEngine } from "@tools/trackedEngine";

/** A single line, evaluated on its own. */
const answer = (expression: string): string => {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(expression));
	} finally {
		engine.clear();
	}
};

/** A document, returning the last line's display. */
const lastLine = (lines: string[]): string => {
	const engine = newTrackedEngine();
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	new ThreeTierEvaluator(doc, engine).evaluate({ startLine: 1, endLine: lines.length });
	try {
		return formatValue(doc.getLineAt(lines.length)!.result!);
	} finally {
		engine.clear();
	}
};

describe("a total of money is money, whichever way the set is named", () => {
	test("the inline list", () => {
		expect(answer("total of $4.99, $12.50, $3.20")).toBe("= $20.69");
	});

	test("the column above", () => {
		expect(lastLine(["$4.99", "$12.50", "$3.20", "total above"])).toBe("= $20.69");
	});

	test("a category tag", () => {
		expect(lastLine(["$4.99 #shop", "$12.50 #shop", "$3.20 #shop", "total of #shop"])).toBe("= $20.69");
	});

	test("a line range", () => {
		expect(lastLine(["$4.99", "$12.50", "$3.20", "total(line1 : line3)"])).toBe("= $20.69");
	});
});

describe("a set spelling one measure two ways converts into the first unit written", () => {
	test("the inline list", () => {
		expect(answer("total of 1.2 km, 3 km, 800 m")).toBe("= 5.00 km");
	});

	test("the column above", () => {
		expect(lastLine(["1.2 km", "3 km", "800 m", "total above"])).toBe("= 5.00 km");
	});

	test("a category tag", () => {
		expect(lastLine(["1.2 km #leg", "3 km #leg", "800 m #leg", "total of #leg"])).toBe("= 5.00 km");
	});

	test("a line range", () => {
		expect(lastLine(["1.2 km", "3 km", "800 m", "total(line1 : line3)"])).toBe("= 5.00 km");
	});

	test("and the unit is the first one written, not the smallest", () => {
		// Written the other way round, the same three distances answer in metres.
		expect(answer("total of 800 m, 1.2 km, 3 km")).toBe("= 5,000.00 m");
		expect(lastLine(["800 m", "1.2 km", "3 km", "total above"])).toBe("= 5,000.00 m");
	});
});

describe("a set mixing measures is refused by dimension, not answered", () => {
	test("the inline list", () => {
		expect(answer("average of 5 kg, 3 m")).toBe("mass and length cannot be averaged");
	});

	test("the column above", () => {
		expect(lastLine(["5 kg", "3 m", "total above"])).toBe("mass and length cannot be added");
	});

	test("a category tag", () => {
		expect(lastLine(["5 kg #x", "3 m #x", "total of #x"])).toBe("mass and length cannot be added");
	});

	test("a line range", () => {
		expect(lastLine(["5 kg", "3 m", "total(line1 : line2)"])).toBe("mass and length cannot be added");
	});
});

describe("the rest of the list aggregates carry the unit too", () => {
	test("average", () => {
		expect(answer("average of 1.2 km, 800 m")).toBe("= 1.00 km");
	});

	test("median", () => {
		expect(answer("median of 3 km, 1 km, 2 km")).toBe("= 2.00 km");
	});

	test("spread", () => {
		expect(answer("spread of 1 km, 800 m")).toBe("= 0.20 km");
	});
});

describe("what this deliberately leaves alone", () => {
	test("a list of plain numbers is still a plain number", () => {
		expect(answer("total of 36, 42, 19 and 81")).toBe("= 178");
		expect(answer("average of 36, 42, 19 and 81")).toBe("= 44.50");
	});

	test("a bare number in a list of quantities still contributes its magnitude", () => {
		// Not a refusal: a count sitting in a column of quantities has always
		// been read this way, and claiming it as an error is a separate
		// decision from fixing a unit that was being thrown away.
		expect(answer("total of 1 km, 500")).toBe("= 501.00 km");
	});

	test("counting is counting, and carries no unit", () => {
		expect(answer("count of 1 km, 500 m, 3 km")).toBe("= 3");
	});
});
