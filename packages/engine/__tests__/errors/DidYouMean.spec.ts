/**
 * "Did you mean": near-miss names for an unknown word (#509).
 *
 * An undefined variable, an undefined function and a conversion target that is
 * not a unit each name the closest real names. Nothing is ever corrected: the
 * line is still an error. See errors/DidYouMean.ts.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { nearestNames, didYouMeanSentence } from "@solve-js/errors/DidYouMean";

function thrown(source: string): EngineError {
	try {
		newTrackedEngine().evaluateExpression(source);
	} catch (error) {
		if (error instanceof EngineError) return error;
		throw error;
	}
	throw new Error(`"${source}" did not throw`);
}

describe("nearestNames", () => {
	test("finds a one-letter slip, a transposition and a case difference", () => {
		expect(nearestNames("sqr", ["sqrt", "sin", "log"])).toEqual(["sqrt"]);
		expect(nearestNames("teh", ["the", "tea"])).toEqual(["tea", "the"]);
		expect(nearestNames("Budget", ["budget"])).toEqual(["budget"]);
	});

	test("lists every name equally close, up to three", () => {
		expect(nearestNames("sine", ["sin", "sind", "sinh", "cos"])).toEqual(["sin", "sind", "sinh"]);
		expect(nearestNames("abcd", ["abc", "abce", "abcf", "abcg"])).toEqual([]);
	});

	test("offers nothing for a word of one or two letters, or one too far from anything", () => {
		expect(nearestNames("x", ["m", "s"])).toEqual([]);
		expect(nearestNames("zzzz", ["sqrt", "sin"])).toEqual([]);
	});

	test("allows more edits the longer the word", () => {
		expect(nearestNames("kilomtrs", ["kilometers"])).toEqual(["kilometers"]);
		expect(nearestNames("sqrrt", ["sqrt"])).toEqual(["sqrt"]);
	});

	test("the sentence reads naturally for one, two and three names", () => {
		expect(didYouMeanSentence([])).toBe("");
		expect(didYouMeanSentence(["sqrt"])).toBe(" Did you mean sqrt?");
		expect(didYouMeanSentence(["a", "b"])).toBe(" Did you mean a or b?");
		expect(didYouMeanSentence(["a", "b", "c"])).toBe(" Did you mean a, b or c?");
	});
});

describe("an undefined function names the nearest functions", () => {
	test("sqr is one letter from sqrt", () => {
		const error = thrown("sqr(16)");
		expect(error.code).toBe("UNDEFINED_FUNCTION");
		expect(error.message).toBe("Undefined function: sqr. Did you mean sqrt?");
		expect(error.suggestion).toBe("sqrt");
		expect(error.context?.didYouMean).toEqual(["sqrt"]);
	});

	test("a function the user defined is a candidate too", () => {
		const doc = newTrackedEngine().parseDocument("double(x) = 2 * x\ndoubel(4)");
		expect(doc.lines[1].error).toBe("Undefined function: doubel. Did you mean double?");
	});
});

describe("an undefined variable names the nearest variables and units", () => {
	test("a misspelt unit", () => {
		const error = thrown("20 kilomters in miles");
		expect(error.code).toBe("UNDEFINED_VARIABLE");
		expect(error.message).toBe("Undefined variable: kilomters. Did you mean kilometers?");
	});

	test("a misspelt variable from earlier in the note", () => {
		const doc = newTrackedEngine().parseDocument("budget = 100\nbudgte * 2");
		expect(doc.lines[1].error).toBe("Undefined variable: budgte. Did you mean budget?");
	});

	test("a name with nothing close keeps the plain message", () => {
		expect(thrown("x").message).toBe("Undefined variable: x");
		expect(thrown("x").suggestion).toBeUndefined();
	});
});

describe("a conversion target that is not a unit says so", () => {
	test("rather than calling it a different measure", () => {
		const value = newTrackedEngine().evaluateExpression("5 km in mies");
		expect(value.errorCode).toBe("UNKNOWN_UNIT");
		expect(formatValue(value)).toBe(`"mies" is not a unit. Did you mean miles?`);
	});

	test("while a real unit of another measure is still a mismatch", () => {
		expect(newTrackedEngine().evaluateExpression("5 kg to m").errorCode).toBe("INCOMPATIBLE_UNITS");
	});
});
