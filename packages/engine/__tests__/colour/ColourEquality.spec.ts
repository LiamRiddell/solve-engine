/**
 * Colour equality compares canonical channels, so two colours written in
 * different formats are equal when they render to the same pixels, and a colour
 * never silently coerces to a number (the fault class this repo guards against:
 * `#ff0000 == 0` must be false, not "both read as 0 so true").
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evalBool(source: string): boolean {
	const engine = newTrackedEngine();
	const v = engine.evaluateExpression(source);
	expect(v.type).toBe(ValueType.Boolean);
	return v.value === true;
}

test("equal channels are equal regardless of authored format", () => {
	expect(evalBool('color("#ff0000") == rgb(255, 0, 0)')).toBe(true);
	expect(evalBool('color("red") == color("#ff0000")')).toBe(true);
	expect(evalBool('color("#ff0000") == hsl(0, 100, 50)')).toBe(true);
});

test("different channels are not equal", () => {
	expect(evalBool('color("#ff0000") == color("#ff0001")')).toBe(false);
	expect(evalBool('color("#ff0000") != color("#0000ff")')).toBe(true);
});

test("a colour never equals a number", () => {
	expect(evalBool('color("#000000") == 0')).toBe(false);
	expect(evalBool('color("#000000") != 0')).toBe(true);
});
