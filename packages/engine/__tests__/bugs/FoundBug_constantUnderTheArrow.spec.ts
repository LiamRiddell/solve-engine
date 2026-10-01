import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, NUMERIC_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { readsWithoutValue, ANSWER_NAME, PI_NAME } from "@solve-js/vm/LineReads";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: under the arrow, `π` and `ans` were unknowns. The arrow keeps a
 * name that has no value as a formula, and it asked that question before the
 * two readings a name with no value has anyway: `π` as the constant and `ans`
 * as the line above. So `π km =>` was refused as `Undefined variable: π` (and
 * before the previous fix answered `0.00 km`), `π + 1 =>` stayed `π+1`, and
 * an equation over π (`2x = π`) counted it as a second unknown. `pi`, `e`,
 * `tau` and `phi` are constants the lexer reads, so they were never affected.
 *
 * The VM now reads `π` and `ans` before the arrow's unknown, and the equation
 * detector leaves them out of an equation's unknowns (`readsWithoutValue`), so
 * each line under the arrow answers what it answers without the arrow.
 */

/** A line's answer, or `THROWS <message>`. */
function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A document line's answer, or `THREW: <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** Each line of a document, through both passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

describe("the lines that exposed it", () => {
	test("π under the arrow is the constant", () => {
		expect(shown("π km =>")).toBe("3.14 km");
		expect(shown("π =>")).toBe("3.14");
		expect(shown("π + 1 =>")).toBe("4.14");
		expect(shown("2π km =>")).toBe("6.28 km");
	});

	test.each(["π km", "π * 2", "π + 1", "π / 2", "π as hex", "π%", "π percent", "π +/- 0.1", "sqrt(π)", "π^2", "π km in m", "-π", "+π", "pi km", "e km", "tau km", "phi km", "e * 2", "tau + 1", "phi as hex"])(
		"%s answers the same with the arrow and without",
		(line) => {
			expect(shown(`${line} =>`)).toBe(shown(line));
			expect(shown(line)).not.toMatch(/^THROWS/);
		},
	);

	test("π in a formula is its value, as pi is", () => {
		expect(shown("π + x =>")).toBe("x+3.1415926536");
		expect(shown("π + x =>")).toBe(shown("pi + x =>"));
		expect(shown("x*π =>")).toBe("3.1415926536x");
		expect(shown("der(π*x^2, x)")).toBe("6.2831853072x");
		expect(shown("solve(x = π, x)")).toBe("3.1415926536");
	});

	test("ans under the arrow is the line above, as it is without the arrow", () => {
		expect(both(["2 + 3", "ans km =>", "3", "ans * x =>", "ans km"])).toEqual(["5", "5.00 km", "3", "3x", "THREW: Undefined variable: x"]);
		expect(shown("ans km =>")).toBe(shown("ans km"));
	});

	test("an equation over π or ans has one unknown, and the arrow solves it", () => {
		expect(both(["2x = π", "x =>"])).toEqual(['x stored as an equation: solve with "x =>"', "1.5707963268"]);
		expect(both(["π*x + 1 = 2", "x =>"])).toEqual(['x stored as an equation: solve with "x =>"', "0.3183098862"]);
		// A product of names with π in it is the scalar equation it reads as, keyed by x, not by π.
		expect(both(["x*π = 2", "x =>"])).toEqual(['x stored as an equation: solve with "x =>"', "0.6366197724"]);
		expect(both(["π*x = 2", "x =>"])).toEqual(['x stored as an equation: solve with "x =>"', "0.6366197724"]);
	});

	test("a note that names π or ans keeps its own value, under the arrow too", () => {
		expect(both(["π = 3", "π km =>", "π + x =>"])).toEqual(["3", "3.00 km", "x+3"]);
		expect(both(["ans = 4", "ans km =>", "ans * x = 8", "x =>"])).toEqual(["4", "4.00 km", 'x stored as an equation: solve with "x =>"', "2"]);
		expect(both(["π = 3", "π*x = 6", "x =>"])).toEqual(["3", 'x stored as an equation: solve with "x =>"', "2"]);
	});
});

describe("the parts: readsWithoutValue", () => {
	test("ordinary: π and ans read as values", () => {
		expect(readsWithoutValue(PI_NAME)).toBe(true);
		expect(readsWithoutValue("π")).toBe(true);
		expect(readsWithoutValue(ANSWER_NAME)).toBe(true);
	});

	test("boundary: other spellings and near names are ordinary names", () => {
		for (const name of ["", " ", "pi", "Pi", "PI", "ANS", "Ans", "ans ", " π", "ππ", "answer", "prev", "x"]) {
			expect({ name, reads: readsWithoutValue(name) }).toEqual({ name, reads: false });
		}
	});

	test("hostile: a prototype word and a look-alike are not constants", () => {
		for (const word of PROTOTYPE_WORDS) expect(readsWithoutValue(word)).toBe(false);
		// Greek capital pi, the pi symbol variant, and a Cyrillic а in ans.
		for (const name of ["Π", "ϖ", "аns", "π​"]) expect(readsWithoutValue(name)).toBe(false);
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`${word} km =>`, `π * ${word} =>`, `2x = π + ${word}`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a look-alike of π is its own unknown, refused under its own spelling", () => {
		expect(shown("ϖ km =>")).toBe("THROWS Undefined variable: ϖ");
		expect(shown("Π km =>")).toBe("THROWS Undefined variable: Π");
		expect(shown("аns km =>")).toBe("THROWS Undefined variable: аns");
	});

	test("a long sum of π under the arrow is answered in time, and past the length limit refused by name", () => {
		const line = `${Array(200).fill("π").join(" + ")} =>`;
		expectHonestLine(line, { budgetMs: 5_000 });
		expect(shown(line)).toBe("628.32");
		const tooLong = `${RESOURCE_PROBES.longSum(2_000).replace(/\d+/g, "π")} =>`;
		expect(shown(tooLong)).toMatch(/^THROWS Expression exceeds max length/);
	});

	test("π deep inside brackets under the arrow is answered or refused in time", () => {
		const line = `${"(".repeat(200)}π${")".repeat(200)} km =>`;
		expectHonestLine(line, { budgetMs: 5_000 });
	});

	test.each(fill("π X =>", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after π: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text around π is read as text", () => {
		expectHonestLine("<b>π</b> km =>");
		expectHonestLine("π km => <script>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a value from the line above, a check and a what-if over π", () => {
		expectHonestDocument("r = 2\nπ * r^2 =>\ncheck line 2 > 12");
		expect(both(["r = 2", "π * r^2 =>"])).toEqual(["2", "12.57"]);
		expectHonestDocument("r = 2\nπ * r^2 =>\nline 2 with r = 3");
	});

	test("an edit that gives π a value of its own changes the line below", () => {
		expect(both(["π km =>"])).toEqual(["3.14 km"]);
		expect(both(["π = 4", "π km =>"])).toEqual(["4", "4.00 km"]);
	});

	test("ans at the top of a document has no line to read, on both passes", () => {
		const [first] = both(["ans km =>"]);
		expect(first).toMatch(/has not been evaluated yet|needs a document/);
	});

	test("a typo of ans is an unknown with a suggestion, never a reading of the line above", () => {
		const [, answer] = both(["5", "anss km =>"]);
		expect(answer).toMatch(/^THREW: Undefined variable: anss/);
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("π * X km =>", NUMERIC_EDGES))("π times a numeric edge: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test.each(fill("X\nans km =>\nans * x =>", NUMERIC_EDGES))("ans after a numeric edge: %j", (text) => {
		expectHonestDocument(text, { allowNaN: text.includes("0/0") });
	});

	test("ans after an empty line, a whitespace line and a CRLF line", () => {
		expectHonestDocument("5\n\nans km =>");
		expectHonestDocument("5\n   \nans km =>");
		expect(both(["5\r", "ans km =>\r", ""])[1]).toBe("5.00 km");
	});

	test("π at zero and negative zero scale", () => {
		expect(shown("0 * π km =>")).toBe("0.00 km");
		expect(shown("-0 * π =>")).toBe(shown("-0 * π"));
	});
});
