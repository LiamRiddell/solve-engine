/**
 * A pasted minus sign or en dash subtracts.
 *
 * A word processor, a chat client or a web page turns a typed hyphen into a
 * minus sign (U+2212) or an en dash (U+2013), and a line pasted from one of
 * them arrived with a character the lexer filed as an unknown identifier, so
 * "10 − 3" was an undefined variable rather than 7. Both now lex as MINUS,
 * in the one-character fast path and in the main loop alike. The em dash is
 * deliberately not included: it is a sentence mark, and a line carrying one
 * is prose.
 */

import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { newTrackedEngine } from "@tools/trackedEngine";

describe("a Unicode minus", () => {
	test("subtracts, whichever of the two characters it is", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("10 \u2212 3").toNumber()).toBe(7);
		expect(engine.evaluateExpression("10 \u2013 3").toNumber()).toBe(7);
	});

	test("negates as a prefix", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("\u22125 + 8").toNumber()).toBe(3);
	});

	test("is a MINUS token on its own, through the one-character fast path", () => {
		const engine = newTrackedEngine();
		const tokens = engine.getLexer().getHighlightTokens("\u2212");
		expect(tokens.map((t) => t.type)).toEqual(["MINUS"]);
	});

	test("the em dash is still not an operator", () => {
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression("10 \u2014 3")).toThrow(EngineError);
	});
});
