/**
 * A tokeniser error stays on its line.
 *
 * `tokenizeString` refuses an unterminated string literal with a structured
 * error, which is right for a single expression: the caller asked for one
 * value and there is none. In a whole-document scan the same throw used to
 * escape `scanDocument`, so one half-typed quote anywhere in a document took
 * every other line's result down with it, on every keystroke while the quote
 * was open. The scan now records the error on the line the way a parse error
 * is already recorded, and carries on.
 */

import { describe, expect, test } from "@jest/globals";
import { Lexer } from "@solve-js/lexer/Lexer";
import { EngineError } from "@solve-js/errors/EngineError";
import { newTrackedEngine } from "@tools/trackedEngine";

const DOCUMENT = ['1 + 1', '"unterminated', ':x = 5', 'x * 2'].join("\n");

describe("an unterminated string in a document", () => {
	test("is recorded on its line by the scan, and the scan continues", () => {
		const scanned = new Lexer("en").scanDocument(DOCUMENT);
		expect(scanned).toHaveLength(4);
		expect(scanned[1].error).toBeInstanceOf(EngineError);
		expect(scanned[1].error?.code).toBe("UNTERMINATED_STRING");
		expect(scanned[1].tokens).toEqual([]);
		// The lines after it are tokenised as if it were not there.
		expect(scanned[2].tokens.length).toBeGreaterThan(0);
		expect(scanned[3].tokens.length).toBeGreaterThan(0);
		expect(scanned[3].lineNumber).toBe(4);
	});

	test("leaves every other line's result intact through parseDocument", () => {
		const result = newTrackedEngine().parseDocument(DOCUMENT);
		expect(result.lines[0].result?.toNumber()).toBe(2);
		expect(result.lines[1].error).toContain("Unterminated string literal");
		expect(result.lines[1].result).toBeNull();
		expect(result.lines[2].result?.toNumber()).toBe(5);
		expect(result.lines[3].result?.toNumber()).toBe(10);
		expect(result.errors).toEqual(['Line 2: Unterminated string literal: "unterminated']);
	});

	test("leaves every other line's result intact through evaluateLines", () => {
		const lines = newTrackedEngine().evaluateLines(DOCUMENT.split("\n"));
		expect(lines[0].result?.toNumber()).toBe(2);
		expect(lines[1].error).toContain("Unterminated string literal");
		expect(lines[3].result?.toNumber()).toBe(10);
	});

	test("a single expression still throws, since there is no value to hand back", () => {
		expect(() => newTrackedEngine().evaluateExpression('"unterminated')).toThrow(EngineError);
	});
});

describe("an unterminated string while highlighting", () => {
	test("paints the tokens read before the quote rather than nothing", () => {
		// The line as it looks between typing the opening quote and the closing one.
		const tokens = new Lexer("en").getHighlightTokens('1 + "abc');
		expect(tokens.map((t) => t.type)).toEqual(["NUMBER", "PLUS"]);
	});

	test("a closed string still paints in full", () => {
		const tokens = new Lexer("en").getHighlightTokens('1 + "abc"');
		expect(tokens.map((t) => t.type)).toEqual(["NUMBER", "PLUS", "STRING"]);
	});
});
