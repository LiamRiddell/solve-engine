/**
 * A percentage combined with a quantity is relative to that quantity.
 *
 * `200 + 10%` used to be 200.10, because `%` compiled to a literal
 * divide-by-100 and the result was an ordinary number. Nobody writing that line
 * means 200.10. Soulver answers 220, and so does this engine now.
 *
 * The rule is decided by the operand types, in the VM's `combinePercentage()`,
 * because a percentage is a proportion *of* something and which reading applies
 * depends on what it is next to:
 *
 *   - quantity ± percentage  →  scales the quantity, keeping its unit
 *   - percentage ± anything  →  proportions add, result stays a percentage
 *
 * Multiplication and division are untouched: `50% × 30` is 15, because there
 * the percentage is already being used as the factor it is.
 *
 * This changed the answers pinned by issues #79 and #81. Those tests are
 * updated rather than deleted, and both issues' actual complaints (that `15%`
 * did not resolve to 0.15, and operator precedence) still hold.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("a percentage applied to a quantity", () => {
	test("adding is an increase", () => {
		expect(num("200 + 10%")).toBeCloseTo(220, 10);
	});

	test("subtracting is a discount", () => {
		expect(num("200 - 10%")).toBeCloseTo(180, 10);
	});

	test("chained percentages compound, each applying to the running total", () => {
		// 1 × 1.15 × 1.25. Not 1 + 0.15 + 0.25.
		expect(num("1+15%+25%")).toBeCloseTo(1.4375, 10);
	});

	test("the quantity keeps its unit", () => {
		const value = evaluate("$300 + 15%");
		expect(value.type).toBe(ValueType.Uom);
		expect(value.toNumber()).toBeCloseTo(345, 10);
	});

	test("a discount keeps its unit too", () => {
		expect(num("$300 - 15%")).toBeCloseTo(255, 10);
	});
});

describe("two proportions", () => {
	test("add, and the result is still a proportion", () => {
		const value = evaluate("10% + 20%");
		expect(value.type).toBe(ValueType.Percentage);
		expect(value.toNumber()).toBeCloseTo(0.3, 10);
	});

	test("subtract", () => {
		expect(num("90% - 40%")).toBeCloseTo(0.5, 10);
	});

	test("a percentage and a bare fraction add as fractions", () => {
		// 0.3 + 0.4 = 0.7, rendered "70%". The left operand decides the reading.
		const value = evaluate("30% + 0.4");
		expect(value.type).toBe(ValueType.Percentage);
		expect(value.toNumber()).toBeCloseTo(0.7, 10);
	});

	test("which is why `100% + 2` is 300% rather than 3", () => {
		expect(num("100% + 2")).toBeCloseTo(3, 10);
		expect(evaluate("100% + 2").type).toBe(ValueType.Percentage);
	});
});

describe("what did not change", () => {
	test("a bare percentage is still its fraction", () => {
		expect(num("15%")).toBeCloseTo(0.15, 10);
		expect(num("50%")).toBeCloseTo(0.5, 10);
	});

	test("multiplication uses the percentage as a factor", () => {
		expect(num("200 * 10%")).toBeCloseTo(20, 10);
		expect(num("50% * 30")).toBeCloseTo(15, 10);
	});

	test("`% of` is unaffected", () => {
		expect(num("10% of 200")).toBeCloseTo(20, 10);
	});

	test("division", () => {
		expect(num("5 * 10%")).toBeCloseTo(0.5, 10);
	});
});

describe("both parse tiers agree", () => {
	/**
	 * `%` is registered twice: as a Tier-1 entry in PrecedenceParser's
	 * hardcoded table and as PercentParselet in the Tier-2 registry. Tier 1 is
	 * what runs for ordinary expressions, so changing only the parselet changes
	 * nothing at all. That is precisely how the old divide-by-100 survived its
	 * own replacement during this fix, and the run stayed green.
	 */
	test("the Tier-1 fast path produces a Percentage, not a bare number", () => {
		expect(evaluate("10%").type).toBe(ValueType.Percentage);
	});

	test("and so does a percentage reached through a parenthesised sub-expression", () => {
		expect(evaluate("(10)%").type).toBe(ValueType.Percentage);
	});
});
