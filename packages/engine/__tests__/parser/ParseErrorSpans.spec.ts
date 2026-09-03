/**
 * A parse error says where.
 *
 * Every parser error carried a code and a message and nothing an editor
 * could underline, so a half-typed line was reported as a sentence rather
 * than a position. Each error the parser raises now carries a source span:
 * the offending token's, or an empty span just after the last token when
 * the line stops short. The codes and messages are unchanged.
 */

import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { newTrackedEngine } from "@tools/trackedEngine";

const failure = (expression: string): EngineError => {
	const engine = newTrackedEngine();
	try {
		engine.evaluateExpression(expression);
	} catch (thrown) {
		return thrown as EngineError;
	}
	throw new Error(`${expression} was expected to fail`);
};

describe("where a parse error points", () => {
	test("at the token nothing could start with", () => {
		const error = failure("2 +* 3");
		expect(error.code).toBe("NO_PREFIX_PARSELET");
		expect(error.span).toEqual({ start: 3, end: 4, line: 1, col: 4 });
	});

	test("just after the last token, when the line stops short", () => {
		const error = failure("1 +");
		expect(error.code).toBe("UNEXPECTED_END_OF_INPUT");
		expect(error.span).toMatchObject({ start: 3, end: 3 });
	});

	test("at the first token left over after a complete expression", () => {
		const error = failure("1 + 2 ]");
		expect(error.code).toBe("UNEXPECTED_TRAILING_TOKEN");
		expect(error.span).toMatchObject({ start: 6, end: 7 });
	});

	test("at a literal that is not one", () => {
		const error = failure("0x");
		expect(error.code).toBe("INVALID_NUMBER_LITERAL");
		expect(error.span).toMatchObject({ start: 0, end: 2 });
	});

	test("and the span survives serialisation", () => {
		const error = failure("2 +* 3");
		expect(JSON.parse(JSON.stringify(error.toJSON())).span).toMatchObject({ start: 3, end: 4 });
	});
});
