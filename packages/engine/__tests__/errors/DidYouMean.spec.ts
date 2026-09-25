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
import { nearestNames, didYouMeanSentence, NameIndex } from "@solve-js/errors/DidYouMean";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

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

describe("the search stays exact and cheap", () => {
	/** The optimal string alignment distance, as a full matrix, with no shortcuts. */
	function referenceDistance(a: string, b: string): number {
		const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
		for (let i = 1; i <= a.length; i++) {
			for (let j = 1; j <= b.length; j++) {
				d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
				if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
			}
		}
		return d[a.length][b.length];
	}

	/** The suggestion rule applied by brute force: every candidate, every distance. */
	function reference(word: string, candidates: readonly string[], minLength: number): string[] {
		if (word.length < minLength) return [];
		const limit = word.length <= 5 ? 1 : word.length <= 9 ? 2 : 3;
		const scored = [...new Set(candidates)]
			.filter((c) => c !== word)
			.map((c) => ({ c, d: referenceDistance(word.toLowerCase(), c.toLowerCase()) }))
			.filter((s) => s.d <= limit);
		if (scored.length === 0) return [];
		const best = Math.min(...scored.map((s) => s.d));
		const found = scored.filter((s) => s.d === best).map((s) => s.c);
		return found.length > 3 ? [] : found.sort();
	}

	test("the prefilter and the index never drop a real match", () => {
		// Every third unit spelling (every thirtieth outside the full run, where
		// the whole sweep was a third of the fast loop's time, #690), each misspelt
		// by a deletion, an insertion, a substitution and a transposition,
		// searched through the index and by brute force. A deterministic
		// generator, so a failure repeats.
		const full = process.env.SOLVE_FULL_SUITE === "1";
		const step = full ? 3 : 30;
		const units = Object.keys(UNIT_TABLE);
		const index = new NameIndex(units);
		let state = 12345;
		const next = (n: number) => {
			state = (Math.imul(state, 1103515245) + 12345) >>> 0;
			return state % n;
		};
		const letters = "abcdefghijklmnopqrstuvwxyz0123456789";
		let checked = 0;
		for (let u = 0; u < units.length; u += step) {
			const unit = units[u];
			if (unit.length < 2) continue;
			const at = next(unit.length);
			const words = [
				unit.slice(0, at) + unit.slice(at + 1),
				unit.slice(0, at) + letters[next(letters.length)] + unit.slice(at),
				unit.slice(0, at) + letters[next(letters.length)] + unit.slice(at + 1),
				at + 1 < unit.length ? unit.slice(0, at) + unit[at + 1] + unit[at] + unit.slice(at + 2) : unit + "s",
			];
			for (const word of words) {
				expect(nearestNames(word, [], 3, index)).toEqual(reference(word, units, 3));
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(full ? 1000 : 100);
	});

	test("a long document's unknown names do not compare against every variable", () => {
		// Past the limit the variables are left out, and the unit table still
		// answers: a generated document of thousands of variables and unknown
		// names used to grow with the square of its length.
		const lines: string[] = [];
		for (let i = 0; i < 600; i++) lines.push(`:value${i} = ${i}`);
		lines.push("valeu1 + 1", "5 kilometrs");
		const result = newTrackedEngine().parseDocument(lines.join("\n"));
		expect(result.lines[600].error).toBe("Undefined variable: valeu1");
		expect(result.lines[601].error).toBe("Undefined variable: kilometrs. Did you mean kilometers, kilometre or kilometres?");
	});
});
