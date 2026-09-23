/**
 * The `GEO_ANGLE` literal: an angle written as a map writes it, `51°30'27"` or
 * `51.5074°N`, lexed as one token.
 *
 * Before it, `51°30'27"` failed as an unterminated string (the `"` opened one)
 * and `51.5074°N` was an undefined variable named `°N`. The risk in fixing that
 * is the `"`: it opens every string literal in the language, so most of what is
 * pinned here is what the literal must NOT claim.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { readGeoAngle, scanGeoAngle } from "@solve-js/lexer/GeoAngleLiteral";
import { getTokenCategory } from "@solve-js/language/TokenCategoryMap";

/** The token types a line lexes to. */
const types = (text: string): string[] => {
	const lexer = new ExpressionLexer();
	lexer.reset(text);
	return lexer.tokenizeAll().map((t) => t.type);
};

/** The text of every `GEO_ANGLE` token in a line. */
const angles = (text: string): string[] => {
	const lexer = new ExpressionLexer();
	lexer.reset(text);
	return lexer.tokenizeAll().filter((t) => t.type === "GEO_ANGLE").map((t) => t.text);
};

describe("what is one literal", () => {
	test("degrees, minutes and seconds, with and without a compass letter", () => {
		expect(types(`51°30'27"`)).toEqual(["GEO_ANGLE"]);
		expect(types(`51°30'27"N`)).toEqual(["GEO_ANGLE"]);
		expect(angles(`51°30'27"N 0°07'40"W`)).toEqual([`51°30'27"N`, `0°07'40"W`]);
	});

	test("spaced as people type it", () => {
		expect(angles(`51° 30' 27" N`)).toEqual([`51° 30' 27" N`]);
	});

	test("degrees and decimal minutes, the usual GPS display", () => {
		expect(angles(`51°30.45'N`)).toEqual([`51°30.45'N`]);
	});

	test("decimal degrees with a compass letter, touching or spaced", () => {
		expect(angles("51.5074°N")).toEqual(["51.5074°N"]);
		expect(angles("51.5074° N, 0.1278° W")).toEqual(["51.5074° N", "0.1278° W"]);
	});

	test("the typographic marks a word processor substitutes", () => {
		expect(angles("51°30′27″")).toEqual(["51°30′27″"]);
		expect(angles("51°30’27”")).toEqual(["51°30’27”"]);
		expect(angles("51°30'27''")).toEqual(["51°30'27''"]);
	});

	test("the literal ends where it ends, so a trailing comment or conversion survives", () => {
		expect(types(`51°30'27" // note`)).toEqual(["GEO_ANGLE", "COMMENT"]);
		expect(types(`51°30'27" as dms`)).toEqual(["GEO_ANGLE", "AS", "IDENT"]);
	});
});

describe("what is left alone", () => {
	test("a bare degree sign is still the unit path, a number and the symbol", () => {
		expect(types("90°")).toEqual(["NUMBER", "IDENT"]);
		expect(types("sin(30°)")).not.toContain("GEO_ANGLE");
	});

	test("a temperature is not a compass letter", () => {
		expect(types("20°C")).not.toContain("GEO_ANGLE");
		expect(types("68°F")).not.toContain("GEO_ANGLE");
	});

	test("a letter only counts when nothing word-like follows it", () => {
		expect(types("5°Nm")).not.toContain("GEO_ANGLE");
		expect(types("5°N2")).not.toContain("GEO_ANGLE");
		expect(types("5°W/m")).not.toContain("GEO_ANGLE");
		expect(types("5°W//note")).toEqual(["GEO_ANGLE", "COMMENT"]);
	});

	test("a string literal is untouched, before or after an angle", () => {
		expect(types(`"hello"`)).toEqual(["STRING"]);
		expect(types(`51°30' "x"`)).toEqual(["GEO_ANGLE", "STRING"]);
	});

	test("a lone inch mark is still a string opener, as it was", () => {
		expect(() => types(`12"`)).toThrow(/Unterminated string literal/);
	});

	test("a number the literal cannot own falls through: an exponent, a thousands separator", () => {
		expect(types("1e2°30'")).not.toContain("GEO_ANGLE");
		expect(types("1,000°30'")).not.toContain("GEO_ANGLE");
	});
});

describe("reading the parts back", () => {
	test("the parts are the text as written, the letter upper-cased", () => {
		expect(readGeoAngle(`51°30'27.5"s`)).toEqual({
			end: 12,
			degrees: "51",
			minutes: "30",
			seconds: "27.5",
			hemisphere: "S",
		});
	});

	test("text that is not a whole literal reads as null", () => {
		expect(readGeoAngle("51°")).toBeNull();
		expect(readGeoAngle(`51°30' extra`)).toBeNull();
		expect(readGeoAngle("°30'")).toBeNull();
	});

	test("the scanner is anchored where it is told the degrees start", () => {
		expect(scanGeoAngle("x 12°34'", 2, 4, 8)?.minutes).toBe("34");
		expect(scanGeoAngle("x 12°34'", 2, 3, 8)).toBeNull();
	});

	test("an editor highlights the literal as a number", () => {
		expect(getTokenCategory("GEO_ANGLE")).toBe("number");
	});
});
