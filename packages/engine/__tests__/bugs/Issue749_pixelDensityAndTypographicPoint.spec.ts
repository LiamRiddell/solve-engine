import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Token } from "@solve-js/lexer/Token";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { excludedUnitSpellings, isKnownUnit } from "@solve-js/lexer/units";
import { EXTENDED_UNITS } from "@solve-js/uom/ExtendedUnits";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { atPixelDensity, isUsableDensity } from "@solve-js/packages/web/PixelDensity";
import { densityPhraseAt, isDensityWord, pixelDensityNormalizerRule } from "@solve-js/packages/web/normalizer/PixelDensityNormalizerRule";
import { inchAbbreviationNormalizerRule } from "@solve-js/packages/uom/normalizer/InchAbbreviationNormalizerRule";

/**
 * Issue #749: two print questions had no direct form. How large a 4000-pixel
 * image prints at 300 dots per inch was a parse error, because pixels are kept
 * apart from physical length and nothing stated a density; and the typographic
 * point, the unit type is sized in, had no spelling after a number (`pt` is the
 * pint, and `point` is ordinary English). `<size> at <n> dpi` (or `ppi`) now
 * crosses the density both ways, and `typographic point` is the point.
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

function tokens(text: string): Token[] {
	const lexer = new ExpressionLexer();
	lexer.reset(text);
	return lexer.tokenizeAll().filter((t) => t.type !== "EOF");
}

describe("pixels at a stated density", () => {
	test.each([
		["4000px at 300 dpi", "13.33 in"],
		["4000px at 300 dpi in inches", "13.33 inches"],
		["4000px at 300 dpi in mm", "338.67 mm"],
		["4000 px at 300 ppi in cm", "33.87 cm"],
		["4000px at 300 DPI", "13.33 in"],
		["2rem at 96 dpi", "0.33 in"],
		["(4000px + 200px) at 300 dpi", "14.00 in"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test.each([
		["8 in at 300 dpi", "2,400.00 px"],
		["8 in at 300 dpi in px", "2,400.00 px"],
		["8 inches at 300 dpi", "2,400.00 px"],
		["210 mm at 300 dpi", "2,480.31 px"],
		["12 typographic points at 300 dpi", "50.00 px"],
	])("and back: %s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("the round trip returns the pixels it started from", () => {
		expect(show("(4000px at 300 dpi) at 300 dpi")).toBe("4,000.00 px");
	});
});

describe("the density is refused by name when it is not one", () => {
	test.each([
		["4000px at 0 dpi", "a density is a finite number of dots per inch above zero, and 0 is not"],
		["4000px at -300 dpi", "a density is a finite number of dots per inch above zero, and -300 is not"],
		["4000px at 1e400 dpi", "a density is a finite number of dots per inch above zero, and Infinity is not"],
		["4000px at 1e-320 dpi", "at 1e-320 dpi the size is too large to be a number"],
		["4000 at 300 dpi", 'a density relates pixels and a printed length, as in "4000px at 300 dpi" or "8 inches at 300 dpi"'],
		["4 kg at 300 dpi", 'a density relates pixels and a printed length, and "kg" is neither'],
		["4000px at d dpi", 'THROWS a density is written as a number of dots per inch, as in "4000px at 300 dpi"'],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("the density binds to the size beside it, so a mixed sum is refused", () => {
		expect(show("4000px + 200px at 300 dpi")).toBe("CSS length and length cannot be added");
	});
});

describe("at keeps its other meanings", () => {
	test.each([
		["30 hours at $30/hour", "$900.00"],
		["01:02:03:04 at 30 fps", "01:02:03:04 at 30 fps"],
		["1.5rem at 20px base", "30.00 px"],
		["250 miles at 60 mph", "4.17 h"],
		["$1,000 after 3 years at 7%", "$1,225.04"],
		["16px in rem", "1.00 rem"],
		["12 in in cm", "30.48 cm"],
		["2 in + 3 in", "5.00 in"],
	])("%s is still %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("dpi stays an ordinary name", () => {
		expect(doc("dpi = 300\n4000 / dpi")).toEqual(["300", "13.33"]);
		expect(show("4000 px / 300 dpi")).toBe("THROWS Undefined variable: dpi");
	});

	test("a pixel still does not convert to a length without a density", () => {
		expect(show("96 px in inches")).toBe("a CSS length cannot be converted to a length");
	});
});

describe("the typographic point", () => {
	test.each([
		["12 typographic points in mm", "4.23 mm"],
		["72 typographic points in inches", "1.00 inches"],
		["1 inch in typographic points", "72.00 typographic points"],
		["1 pica in typographic points", "12.00 typographic points"],
		["1 typographic point in mm", "0.35 mm"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("pt stays the pint, and point is still only a conversion target", () => {
		expect(show("12 pt in ml")).toBe("5,678.12 ml");
		expect(show("12 pt in mm")).toBe("a volume cannot be converted to a length");
		expect(show("1 pica in points")).toBe("12.00 points");
		expect(show("1 point in mm")).toMatch(/^THROWS Undefined variable: point/);
	});

	test("points in prose stay prose", () => {
		expect(doc("We scored 12 points today.\nHe scored 12 typographic points.")).toEqual(
			doc("We scored 12 goals today.\nHe scored 12 typographic goals.").map((line) => line),
		);
	});
});

describe("the parts", () => {
	describe("isUsableDensity", () => {
		test.each([[300, true], [1, true], [0.5, true], [Number.MAX_VALUE, true], [0, false], [-0, false], [-300, false], [Infinity, false], [-Infinity, false], [NaN, false]])(
			"%p is %p",
			(density, usable) => {
				expect(isUsableDensity(density)).toBe(usable);
			},
		);
	});

	describe("atPixelDensity", () => {
		test("pixels become inches, and any CSS length through its pixels", () => {
			expect(atPixelDensity(4000, "px", 300)).toEqual({ amount: 4000 / 300, unit: "in" });
			expect(atPixelDensity(2, "rem", 96)).toEqual({ amount: 32 / 96, unit: "in" });
		});

		test("a length becomes pixels, through its inches", () => {
			expect(atPixelDensity(8, "in", 300)).toEqual({ amount: 2400, unit: "px" });
			expect(atPixelDensity(25.4, "mm", 100)?.amount).toBeCloseTo(100, 9);
			expect(atPixelDensity(1, "typographic point", 72)?.amount).toBeCloseTo(1, 12);
		});

		test("boundary: zero and negative sizes pass through; the density must be usable", () => {
			expect(atPixelDensity(0, "px", 300)).toEqual({ amount: 0, unit: "in" });
			expect(atPixelDensity(-300, "px", 300)).toEqual({ amount: -1, unit: "in" });
			for (const density of [0, -1, Infinity, NaN]) expect(atPixelDensity(4000, "px", density)).toBeNull();
		});

		test("hostile: a unit of no kind, or an inherited property name, is refused", () => {
			for (const unit of ["kg", "s", "mph", "", "not a unit", ...PROTOTYPE_WORDS]) {
				expect(atPixelDensity(1, unit, 300)).toBeNull();
			}
		});
	});

	describe("isDensityWord", () => {
		test("dpi and ppi in either case, as a word only", () => {
			for (const word of ["dpi", "ppi", "DPI", "PPI", "Dpi"]) expect(isDensityWord(tokens(word)[0])).toBe(true);
			for (const word of ["dp", "dpis", "px", "constructor", "__proto__"]) expect(isDensityWord(tokens(word)[0])).toBe(false);
			expect(isDensityWord(undefined)).toBe(false);
		});
	});

	describe("densityPhraseAt", () => {
		test("reads the number, a signed number, or a name in its place", () => {
			const plain = tokens("4000px at 300 dpi");
			const at = plain.findIndex((t) => (t.text ?? "") === "at");
			expect(densityPhraseAt(plain, at)).toEqual({ length: 3, density: "300" });
			const signed = tokens("4000px at -300 dpi");
			expect(densityPhraseAt(signed, at)).toEqual({ length: 4, density: "-300" });
			const named = tokens("4000px at d dpi");
			expect(densityPhraseAt(named, at)).toEqual({ length: 3, density: "" });
		});

		test("needs at, then the density, then the word", () => {
			for (const text of ["4000px at 300", "4000px at 300 px", "4000px by 300 dpi", "4000px at dpi", "4000px at - dpi"]) {
				const list = tokens(text);
				for (let i = 0; i < list.length; i++) expect(densityPhraseAt(list, i)).toBeNull();
			}
			expect(densityPhraseAt([], 0)).toBeNull();
			expect(densityPhraseAt(tokens("at"), 0)).toBeNull();
		});
	});

	describe("the normaliser rules", () => {
		test("the density rule folds the phrase into one token", () => {
			const list = tokens("4000px at 300 dpi");
			const match = pixelDensityNormalizerRule().match(list, list.findIndex((t) => (t.text ?? "") === "at"));
			expect(match?.consumed).toBe(3);
			expect(match?.replacement.map((t) => [t.type, t.value])).toEqual([["PIXEL_DENSITY", "300"]]);
			expect(pixelDensityNormalizerRule().match(tokens("30 hours at $30/hour"), 2)).toBeNull();
		});

		test("the inch rule reads in before a density as the inch, and nowhere new", () => {
			const rule = inchAbbreviationNormalizerRule();
			expect(rule.match(tokens("8 in at 300 dpi"), 0)?.replacement.map((t) => [t.type, t.value])).toEqual([["NUMBER", "8"], ["UNIT", "in"]]);
			expect(rule.match(tokens("8 in at 300 fps"), 0)).toBeNull();
			expect(rule.match(tokens("8 in mm"), 0)).toBeNull();
		});
	});

	describe("the point's spelling", () => {
		test("is an exact 72nd of an inch, as a length", () => {
			for (const spelling of ["typographic point", "typographic points"]) {
				expect(EXTENDED_UNITS[spelling]).toEqual({ measure: "length", toBase: 0.0254 / 72 });
				expect(getMeasure(spelling)).toBe("length");
			}
			expect(convertUnit(72, "typographic points", "in")).toBeCloseTo(1, 12);
		});

		test("point and points are still excluded, with a reason that names the spelling", () => {
			expect(isKnownUnit("point")).toBe(false);
			expect(isKnownUnit("points")).toBe(false);
			expect(excludedUnitSpellings.get("point")).toMatch(/typographic point/);
			expect(excludedUnitSpellings.get("point")).not.toMatch(/reachable as/);
		});
	});
});

describe("adversarial", () => {
	test("security: prototype words in the density's place and after at", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`4000px at ${word} dpi`);
				expectHonestLine(`${word} at 300 dpi`);
				expectHonestLine(`4000px at 300 ${word}`);
				expectHonestLine(`12 typographic ${word} in mm`);
			}
		});
	});

	test("security: text edges, look-alike digits and markup", () => {
		for (const edge of TEXT_EDGES) {
			expectHonestLine(`${edge} at 300 dpi`);
			expectHonestLine(`4000px at ${edge} dpi`);
		}
		expectHonestLine("4000px at ３００ dpi");
		expectHonestLine("<img width=4000px> at 300 dpi");
	});

	test("security: a long run of densities is answered in time", () => {
		expectHonestLine(Array.from({ length: 1_000 }, () => "(4000px at 300 dpi)").join(" + "), { budgetMs: 5_000 });
	});

	test("realistic: a size from the line above, a check and a what-if", () => {
		expect(doc(":image = 4000px\nimage at 300 dpi in mm")).toEqual(["4,000.00 px", "338.67 mm"]);
		expectHonestDocument(":image = 4000px\nimage at 300 dpi\ncheck image at 300 dpi > 13 in\nline 2 with image = 3000px");
		expectHonestDocument(":d = 300\n4000px at d dpi");
	});

	test("edge: the numeric edges as the size and as the density", () => {
		for (const line of fill("X px at 300 dpi", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		for (const line of fill("4000px at X dpi", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		for (const line of fill("X typographic points in mm", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("edge: CRLF and a trailing newline", () => {
		expect(doc("4000px at 300 dpi\r\n8 in at 300 dpi\n")).toEqual(["13.33 in", "2,400.00 px", ""]);
	});
});
