/**
 * "<label>: <expression>" — a non-expression prefix separated from a real
 * expression by a colon (e.g. "pi approximation: 355/113") is recognized
 * by evaluating just the part after the LAST colon. See GitHub issue #65.
 *
 * Only attempted as a fallback once the whole-line parse has already
 * failed — it can never change behavior for a line that already worked.
 * Clock times, lap times, and ":name = value" variable definitions all
 * consume their own colon(s) during lexing and never produce a real
 * COLON token, so this can't misfire on any of them (see the regression
 * guards below, which assert against the SAME result the unlabeled form
 * produces, not just "didn't throw").
 */
import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

describe("labeled-line fallback", () => {
	test("a plain-text label before a real expression", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("pi approximation: 355/113");
		expect(value.toNumber()).toBeCloseTo(Math.PI, 4);
	});

	test("combined with the trailing bare '=' from issue #65's own example", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("pi approximation: 355/113=");
		expect(value.toNumber()).toBeCloseTo(Math.PI, 4);
	});

	test("a label before a datetime phrase", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("age: years since 27/11/2010");
		expect(value.type).toBe(6); // Uom
		expect(value.unit).toBe("years");
	});

	test("a label word that collides with a real MathPhrases keyword ('total') is still just a label", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("total: 5 + 3");
		expect(value.toNumber()).toBe(8);
	});

	test("a label before a ':name = value' definition falls back past the definition's OWN leading colon (a real bug found during review: trying only the rightmost colon strips the colon VariableParselet needs, breaking the definition)", () => {
		const engine = newTrackedEngine();
		const defResult = engine.evaluateExpression("input value: :x = 5");
		expect(defResult.toNumber()).toBe(5);
		const readResult = engine.evaluateExpression(":x + 1");
		expect(readResult.toNumber()).toBe(6);
	});

	test("multiple colons: only the text after the LAST one is used", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("label one: label two: 5 + 3");
		expect(value.toNumber()).toBe(8);
	});

	test("regression guard: a clock time is completely unaffected (produces the identical result with or without a label)", () => {
		const engine = newTrackedEngine();
		const labeled = engine.evaluateExpression("meeting notes: 9:30 + 5");
		const plain = engine.evaluateExpression("9:30 + 5");
		expect(labeled.value).toBe(plain.value);
	});

	test("regression guard: a lap time is completely unaffected", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("03:04:05");
		expect(value.toNumber()).toBe(11045);
	});

	test("regression guard: ':name = value' variable definitions are completely unaffected", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression(":x = 5");
		expect(value.toNumber()).toBe(5);
	});

	test("regression guard: pure prose with no valid expression anywhere still throws", () => {
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression("just some prose with no numbers")).toThrow(/unexpected token/i);
	});

	test("regression guard: a colon with nothing meaningful after it still throws", () => {
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression("label:")).toThrow();
	});

	test("regression guard: a genuinely malformed expression after the label still throws (not silently accepted)", () => {
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression("bad label: 5 3")).toThrow(/unexpected token/i);
	});

	test("regression guard: a user-defined function definition's own '=' is unaffected", () => {
		const engine = newTrackedEngine();
		const value = engine.evaluateExpression("f(x) = 2*x");
		expect(String(value.value)).toMatch(/defined/i);
	});
});

describe("a label that is the same word as the variable it assigns (#561)", () => {
	test("assigns rather than storing an equation", () => {
		// `rent: :rent = 1200` has one unknown on the left only because the label
		// repeats the name, and the scalar-equation detector used to claim it.
		const engine = newTrackedEngine();
		const lines = engine.parseDocument("rent: :rent = 1200\nrent * 2").lines;
		expect(lines[0].result?.toNumber()).toBe(1200);
		expect(lines[1].result?.toNumber()).toBe(2400);
	});

	test("a real equation is still stored", () => {
		const engine = newTrackedEngine();
		const lines = engine.parseDocument("2x + 1 = 7\nx =>").lines;
		expect(String(lines[0].result?.value)).toMatch(/stored as an equation/);
		expect(lines[1].result?.toNumber()).toBe(3);
	});
});
