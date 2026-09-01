/**
 * Comparison shopping (issue #275): `A vs B` says which is cheaper and by how
 * much, lower being cheaper. The discount and unit-price maths a shopper wants
 * is already ordinary arithmetic (`£80 - 20% - 10%`, `£3 / 500g`); this covers
 * the one missing piece, putting two of those side by side.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

const text = (source: string) => String(newTrackedEngine().evaluateExpression(source).value);

describe("A vs B", () => {
	test("compares two per-unit prices and names the cheaper by percent", () => {
		expect(text("£3 / 500g vs £4 / 750g")).toBe("the second is cheaper, 11% less");
		expect(text("£3 / 500g vs £4 / 500g")).toBe("the first is cheaper, 25% less");
	});

	test("compares plain prices and plain numbers", () => {
		expect(text("£3 vs £4")).toBe("the first is cheaper, 25% less");
		expect(text("10 vs 12")).toBe("the first is cheaper, 17% less");
	});

	test("lines up different-but-convertible units", () => {
		expect(text("£6/kg vs £5.33/kg")).toBe("the second is cheaper, 11% less");
	});

	test("equal amounts are the same", () => {
		expect(text("£3 vs £3")).toBe("the same");
	});

	test("`versus` is an alias", () => {
		expect(text("£3 / 500g versus £4 / 750g")).toBe("the second is cheaper, 11% less");
	});

	test("two different kinds of thing are refused, not silently compared", () => {
		expect(newTrackedEngine().evaluateExpression("500g vs £4").type).toBe(ValueType.Error);
	});
});
