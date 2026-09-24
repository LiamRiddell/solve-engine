/**
 * The colours a line's words take (#576).
 *
 * A conversion word was a unit on one line (`12 kg to lb`) and a comparison on
 * the next (`5 km in miles`), a line's label was painted as a variable it
 * reads, and the colon of a clock time was painted as a variable's sigil.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { LanguageService } from "@solve-js/language/LanguageService";

/** Each coloured span of a line, as `[text, category]`. */
function colours(line: string): Array<[string, string]> {
	const service = new LanguageService(newTrackedEngine());
	return service.getSemanticTokens(line, 1).map((t) => [line.slice(t.from, t.to), t.category]);
}

describe("the conversion words are keywords alike", () => {
	test("to, in, into and convert", () => {
		expect(colours("12 kg to lb")).toContainEqual(["to", "keyword"]);
		expect(colours("5 km in miles")).toContainEqual(["in", "keyword"]);
		expect(colours("5 km into miles")).toContainEqual(["into", "keyword"]);
	});
});

describe("a label is prose, not code", () => {
	test("its words and colon are left uncoloured", () => {
		expect(colours("Total: 1 + 2")).toEqual([["1", "number"], ["+", "operator"], ["2", "number"]]);
		expect(colours("- Total: 3 + 4")).toEqual([["3", "number"], ["+", "operator"], ["4", "number"]]);
	});

	test("a definition's own colon after a label is still the sigil", () => {
		expect(colours("rent: :rent = 1200")).toEqual([
			[":", "variable"],
			["rent", "variable"],
			["=", "operator"],
			["1200", "number"],
		]);
		expect(colours(":x = 5")[0]).toEqual([":", "variable"]);
	});
});

describe("a clock time's colon is part of the number", () => {
	test("12:30", () => {
		expect(colours("12:30 + 1").slice(0, 3)).toEqual([["12", "number"], [":", "number"], ["30", "number"]]);
	});
});
