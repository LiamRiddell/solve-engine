/**
 * `check` lines: assertions inside a document (#506).
 *
 * A check passes with a tick, fails with an error naming both sides, and gives
 * the host a pass and fail count. See conditionals/CheckFunctions.ts.
 */

import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source));
const answers = (text: string) =>
	newTrackedEngine().parseDocument(text).lines.map((line) => (line.result ? formatValue(line.result) : `ERROR ${line.error}`));

describe("a passing check", () => {
	test.each([
		"check 1 + 1 == 2",
		"check 0.1 + 0.2 == 0.3",
		"check 1 km == 1000 m",
		"check 5 > 3",
		"check 3 <= 3",
		"check 2 != 3",
		'check "a" == "a"',
	])("%s is a tick", (source) => {
		expect(shown(source)).toBe("= ✓");
	});

	test("an approximate check says how close it was", () => {
		expect(shown("check 22/7 ≈ pi within 0.1%")).toBe("= ✓ (differs by 0.04%)");
		expect(shown("check 22/7 ~= pi within 0.1%")).toBe("= ✓ (differs by 0.04%)");
		expect(shown("check 5 m ≈ 5.01 m within 1 cm")).toBe("= ✓ (differs by 0.01 m)");
	});
});

describe("a failing check names both sides", () => {
	test("the reported case", () => {
		expect(answers(":spent = $2010\n:budget = $1950\ncheck :spent <= :budget")[2]).toBe(
			"check failed: $2,010.00 is more than $1,950.00",
		);
	});

	test.each([
		["check 1 + 1 == 3", "check failed: 2 is not equal to 3"],
		["check 3 >= 5", "check failed: 3 is less than 5"],
		["check 3 < 3", "check failed: 3 is not less than 3"],
		["check 2 > 5", "check failed: 2 is not more than 5"],
		["check 2 != 2", "check failed: 2 is equal to 2"],
		["check 22/7 ≈ pi within 0.01%", "check failed: 3.14286 differs from 3.14159 by 0.04%, more than 0.01%"],
		["check 5 m ≈ 5.02 m within 1 cm", "check failed: 5 m differs from 5.02 m by 0.02 m, more than 1.00 cm"],
	])("%s", (source, message) => {
		const value = newTrackedEngine().evaluateExpression(source);
		expect(value.errorCode).toBe("CHECK_FAILED");
		expect(value.errorMessage).toBe(message);
	});

	test("two things that cannot be compared are refused, not failed", () => {
		expect(newTrackedEngine().evaluateExpression("check 1 km == 1 kg").errorCode).toBe("CHECK_INCOMPARABLE");
		expect(newTrackedEngine().evaluateExpression('check "a" < "b"').errorCode).toBe("CHECK_INCOMPARABLE");
	});
});

describe("check is still a name elsewhere", () => {
	test("a restaurant check", () => {
		expect(answers("check = $80\ntip = 15% of check")).toEqual(["= $80.00", "= $12.00"]);
	});
});

describe("a check does not break a total", () => {
	test("passed or failed, the column beneath it still adds up", () => {
		expect(answers("10\n20\ncheck 10 + 20 == 30\ntotal above")[3]).toBe("= 30");
		expect(answers("10\n20\ncheck 10 + 20 == 31\ntotal above")[3]).toBe("= 30");
	});
});

describe("the host's count", () => {
	const text = "check 1 == 1\ncheck 2 == 3\nx = 5\ncheck x > 1";

	test("parseDocument counts passes and failures", () => {
		expect(newTrackedEngine().parseDocument(text).checks).toEqual({ passed: 2, failed: 1 });
	});

	test("evaluateDocument agrees", () => {
		expect(evaluateDocument(createEngine() as unknown as ExpressionEngine, text).checks).toEqual({ passed: 2, failed: 1 });
	});

	test("a document with no checks has no count", () => {
		expect(newTrackedEngine().parseDocument("1 + 1").checks).toBeUndefined();
	});
});
