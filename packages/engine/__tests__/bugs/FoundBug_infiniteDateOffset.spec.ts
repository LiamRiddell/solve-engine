import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { Value } from "@solve-js/vm/Value";

/**
 * Found bug: `∞ days from today` answers `Invalid Date, Invalid Date`, and so
 * do `today + ∞ days`, `2024-01-01 - ∞ days` and a finite offset past the
 * calendar (`1e10 days from 2024-01-01`). A date moved by an infinite or
 * out-of-range length has no day to land on.
 *
 * Fixed by pull request #832 (the dates batch), which refuses any date made
 * past the range a calendar holds, or from no number at all, with
 * `DATE_OUT_OF_RANGE` where the date is made (`datetimeValue`), which covers
 * each of these. Each line was pinned as failing until #832 merged, and now
 * passes.
 */

/** The error code a value carries, or `none`. */
const codeOf = (value: Value): string => (value.isError() ? String(value.errorCode ?? "") : "none");

/** The code a line answers with on its own. */
const lineCode = (line: string): string => codeOf(newTrackedEngine().evaluateExpression(line));

describe("a date moved past the calendar is refused by name (#832)", () => {
	test("∞ days from today", () => {
		expect(lineCode("∞ days from today")).toBe("DATE_OUT_OF_RANGE");
	});

	test("∞ days from a date", () => {
		expect(lineCode("∞ days from 2024-01-01")).toBe("DATE_OUT_OF_RANGE");
	});

	test("-∞ days from a date", () => {
		expect(lineCode("-∞ days from 2024-01-01")).toBe("DATE_OUT_OF_RANGE");
	});

	test("today + ∞ days", () => {
		expect(lineCode("today + ∞ days")).toBe("DATE_OUT_OF_RANGE");
	});

	test("a date less ∞ days", () => {
		expect(lineCode("2024-01-01 - ∞ days")).toBe("DATE_OUT_OF_RANGE");
	});

	test("∞ hours from a date", () => {
		expect(lineCode("∞ hours from 2024-01-01")).toBe("DATE_OUT_OF_RANGE");
	});

	test("a finite offset past the calendar", () => {
		expect(lineCode("1e10 days from 2024-01-01")).toBe("DATE_OUT_OF_RANGE");
	});

	test("through evaluateLine", () => {
		expect(codeOf(newTrackedEngine().evaluateLine(1, "∞ days from today"))).toBe("DATE_OUT_OF_RANGE");
	});

	test("through parseDocument", () => {
		expect(newTrackedEngine().parseDocument("d = ∞ days from 2024-01-01").lines[0].result?.errorCode).toBe("DATE_OUT_OF_RANGE");
	});

	test("through evaluateDocument", () => {
		expect(evaluateDocument(newTrackedEngine(), "d = ∞ days from 2024-01-01").lines[0].result?.errorCode).toBe("DATE_OUT_OF_RANGE");
	});
});

describe("what is already refused by name", () => {
	test("an infinite count of working days meets the workday limit", () => {
		let code = "none";
		try {
			code = lineCode("∞ working days from 2024-01-01");
		} catch (e) {
			code = String((e as { code?: string }).code);
		}
		expect(code).toBe("DATE_OFFSET_LIMIT_EXCEEDED");
	});

	test("a quotient with no answer is refused before it reaches the date", () => {
		expect(lineCode("(0/0) days from 2024-01-01")).not.toBe("none");
	});
});
