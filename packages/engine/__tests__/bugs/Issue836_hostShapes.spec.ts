import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";
import { serializeValue, serializeParsingResult } from "@solve-js/worker/serialize";
import { EngineError } from "@solve-js/errors/EngineError";
import { ValueType, errorValue, uomValue, numberValue, type Value } from "@solve-js/vm/Value";

/**
 * Issue #836: three small faults in what a host receives.
 *
 * - `serializeValue` copied an error's `unit` into the DTO, and an error keeps
 *   its message there, so `5 m + 3 kg` crossed the worker boundary with
 *   `unit: "length and mass cannot be added"`. The DTO's `unit` is units only;
 *   an error's message crosses as `text`, and its code as `errorCode`.
 * - `evaluateLine(4, "3 + * 4")` threw a span on line 1, whatever line the host
 *   passed. The span names the line now.
 * - Four messages a reader sees carried em-dashes, where the house style uses
 *   a colon: the stored equation, the empty and the ragged matrix, and
 *   `LINE_REF_NO_DOCUMENT`. They are reworded; the codes are unchanged.
 */

/** What a line throws, or its value. */
function outcome(run: () => Value): { thrown?: EngineError; value?: Value } {
	try {
		return { value: run() };
	} catch (error) {
		return { thrown: error as EngineError };
	}
}

describe("serializeValue keeps an error's message out of unit", () => {
	test("the issue's line: text and errorCode, and no unit", () => {
		const dto = serializeValue(newTrackedEngine().evaluateExpression("5 m + 3 kg"));
		expect(dto).toEqual({ type: ValueType.Error, text: "length and mass cannot be added", number: 0, errorCode: "INCOMPATIBLE_UNITS" });
		expect("unit" in dto).toBe(false);
	});

	test("a quantity still carries its unit, and a plain number none", () => {
		expect(serializeValue(uomValue(5, "km")).unit).toBe("km");
		expect("unit" in serializeValue(numberValue(5))).toBe(false);
	});

	test("an error value built by hand, with an empty message or a unit-shaped one", () => {
		expect("unit" in serializeValue(errorValue("X", ""))).toBe(false);
		expect("unit" in serializeValue(errorValue("X", "km"))).toBe(false);
		expect(serializeValue(errorValue("X", "km")).errorCode).toBe("X");
	});

	test("a document's error lines cross without a unit, and round-trip JSON", () => {
		const result = serializeParsingResult(newTrackedEngine().parseDocument("5 m + 3 kg\n10 km"));
		expect(result.lines[0].result).not.toHaveProperty("unit");
		expect(result.lines[1].result?.unit).toBe("km");
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});

	test("adversarial: an error whose message is markup, a prototype word or an invisible character", () => {
		expectPrototypeUntouched(() => {
			for (const message of ["<script>alert(1)</script>", ...PROTOTYPE_WORDS, "‮km", "​"]) {
				const dto = serializeValue(errorValue("X", message));
				expect("unit" in dto).toBe(false);
				expect(dto.text).toContain(message.replace(/^=\s*/, ""));
			}
		});
	});
});

describe("evaluateLine names the host's line in a parse error's span", () => {
	test("line 4, and the offsets and column unchanged", () => {
		const { thrown } = outcome(() => newTrackedEngine().evaluateLine(4, "3 + * 4"));
		expect(thrown?.span).toEqual({ start: 4, end: 5, line: 4, col: 5 });
	});

	test("evaluateExpression still reports line 1, having no line of its own", () => {
		const { thrown } = outcome(() => newTrackedEngine().evaluateExpression("3 + * 4"));
		expect(thrown?.span).toEqual({ start: 4, end: 5, line: 1, col: 5 });
	});

	test("a replayed failure (the failed-parse cache) names the new line too", () => {
		const engine = newTrackedEngine();
		outcome(() => engine.evaluateLine(2, "3 + * 4"));
		expect(outcome(() => engine.evaluateLine(9, "3 + * 4")).thrown?.span?.line).toBe(9);
		expect(outcome(() => engine.evaluateLine(2, "3 + * 4")).thrown?.span?.line).toBe(2);
	});

	test("the code and message are unchanged by the move", () => {
		const alone = outcome(() => newTrackedEngine().evaluateExpression("5 +")).thrown!;
		const onLine = outcome(() => newTrackedEngine().evaluateLine(7, "5 +")).thrown!;
		expect({ code: onLine.code, message: onLine.message, suggestion: onLine.suggestion }).toEqual({ code: alone.code, message: alone.message, suggestion: alone.suggestion });
	});

	test("edge: line numbers that are not positive whole numbers leave the span as it was", () => {
		for (const n of [0, -1, 2.5]) {
			expect(outcome(() => newTrackedEngine().evaluateLine(n, "3 + * 4")).thrown?.span?.line).toBe(1);
		}
		expect(outcome(() => newTrackedEngine().evaluateLine(100_000, "3 + * 4")).thrown?.span?.line).toBe(100_000);
	});

	test("a runtime failure with no span still has none", () => {
		expect(outcome(() => newTrackedEngine().evaluateLine(3, "price * 2")).thrown?.span).toBeUndefined();
	});

	test("realistic: the text edges before a failing tail keep the span on the host's line", () => {
		for (const edge of TEXT_EDGES) {
			const { thrown } = outcome(() => newTrackedEngine().evaluateLine(6, `${edge} 2 + * 3`));
			if (thrown?.span?.line !== undefined) expect(thrown.span.line).toBe(6);
		}
	});
});

describe("the messages a reader sees carry no em-dash", () => {
	const EM_DASH = "—";

	test.each([
		["2 x = 10", "x stored as an equation: solve with \"x =>\""],
		["[]", "A matrix literal cannot be empty: `[]` has no valid shape."],
		["[1, 2; 3]", "Matrix literal rows must all have the same number of columns: row 2 has 1, but a previous row has 2."],
		["line 1", "A line reference needs a document to read, and an expression evaluated on its own has none"],
		["[1, 2] * [3, 4]", "Cannot multiply a 1x2 matrix by a 1x2 matrix: the first has 2 columns and the second 1 row, and the two must match."],
	])("%s", (line, message) => {
		const { thrown, value } = outcome(() => newTrackedEngine().evaluateExpression(line));
		const shown = thrown?.message ?? String(value?.type === ValueType.Error ? value.unit : value?.value);
		expect(shown).toBe(message);
		expect(shown).not.toContain(EM_DASH);
	});

	test("the codes behind them are unchanged", () => {
		expect(outcome(() => newTrackedEngine().evaluateExpression("[]")).thrown?.code).toBe("EMPTY_MATRIX_LITERAL");
		expect(outcome(() => newTrackedEngine().evaluateExpression("[1, 2; 3]")).thrown?.code).toBe("RAGGED_MATRIX_LITERAL");
		expect(String(outcome(() => newTrackedEngine().evaluateExpression("line 1")).value?.value)).toBe("LINE_REF_NO_DOCUMENT");
		expect(String(outcome(() => newTrackedEngine().evaluateExpression("[1, 2] * [3, 4]")).value?.value)).toBe("DIMENSION_MISMATCH");
	});
});
