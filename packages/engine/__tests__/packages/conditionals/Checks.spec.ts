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

	// #581: exact kinds are checked exactly, the way the operators compare them.
	test.each([
		"check 2^53 + 1 > 2^53",
		"check 2^53 + 1 != 2^53",
		"check 2^53 + 1 >= 2^53",
		"check 2^53 < 2^53 + 1",
		"check 3^40 == 12157665459056928801n",
		"check 5n == 5",
		"check 12345678901234567891n > 12345678901234567890n",
		"check 1.0000000000001 != 1",
		"check 1.0000000000001 > 1",
		"check $1.0000000000001 != $1",
		"check $0.1 + $0.2 == $0.3",
		"check 1/3 * 3 == 1",
	])("%s is a tick, as the operator says", (source) => {
		expect(shown(source)).toBe("= ✓");
	});

	// #595: a check across an offset conversion agrees with `==`, whose margin
	// scales with the sides as written: 32 F in Celsius is 5.7e-14, not 0.
	test.each(["check 0 C == 32 F", "check 32 F == 0 C", "check 100 C == 212 F", "check 0 C >= 32 F", "check 0 C <= 32 F"])(
		"%s is a tick, as the operator says",
		(source) => {
			expect(shown(source)).toBe("= ✓");
		},
	);

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

	// #582: a failure's sides differ, so they must not read the same. The usual
	// two places round 1.845 and 1.85 together; the sides widen until they part.
	test.each([
		["check 1.845 == 1.85", "check failed: 1.845 is not equal to 1.850"],
		["check 12.3 kWh * $0.15/kWh == $1.85", "check failed: $1.845 is not equal to $1.850"],
		["check 1.845 > 1.85", "check failed: 1.845 is not more than 1.850"],
		["check 1.0000000000001 == 1", "check failed: 1.0000000000001 is not equal to 1"],
		["check 3.1415926 ≈ 3.1415927", "check failed: 3.1415926 is not equal to 3.1415927"],
		["check 1 km == 1000.001 m", "check failed: 1.000000 km is not equal to 1,000.001000 m"],
	])("%s names two sides that read apart", (source, message) => {
		const value = newTrackedEngine().evaluateExpression(source);
		expect(value.errorCode).toBe("CHECK_FAILED");
		expect(value.errorMessage).toBe(message);
	});

	test("sides that differ at the usual places are shown as usual", () => {
		expect(newTrackedEngine().evaluateExpression("check 1.84 == 1.85").errorMessage).toBe("check failed: 1.84 is not equal to 1.85");
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

	// #594: only a line written with `check` counts. Text that begins with a
	// tick is text, and a variable called `check` is a variable.
	test("text that begins with a tick is not a check, in either pass", () => {
		const text = '"✓ shipped"\nx = "✓ ok"\ncheck 1 == 2';
		expect(newTrackedEngine().parseDocument(text).checks).toEqual({ passed: 0, failed: 1 });
		expect(evaluateDocument(createEngine() as unknown as ExpressionEngine, text).checks).toEqual({ passed: 0, failed: 1 });
	});

	test("a variable called check, holding a tick, is not counted", () => {
		expect(newTrackedEngine().parseDocument('check = "✓"\ncheck 1 == 1').checks).toEqual({ passed: 1, failed: 0 });
	});

	test("a document with no checks has no count", () => {
		expect(newTrackedEngine().parseDocument("1 + 1").checks).toBeUndefined();
	});
});
