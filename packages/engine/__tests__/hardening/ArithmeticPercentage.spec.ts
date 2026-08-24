/**
 * Percentage semantics at the edges of the rate.
 *
 * `RelativePercentage.spec.ts` covers the rule itself: a percentage next to a
 * quantity scales that quantity, two percentages add as proportions. This file
 * takes that rule and pushes on the rate, because the rule is only as good as
 * its behaviour at 0%, at 100%, past 100%, and below zero, and those are
 * exactly the rates a discount or a markup actually reaches in use.
 *
 * The values are worked out from the rule, not from the engine: `x + p%` is
 * `x * (1 + p)` and `x - p%` is `x * (1 - p)`, so `200 - 100%` has to be
 * exactly 0 and `200 - 150%` has to be -100. Where a chain of percentages is
 * involved the arithmetic compounds, so `1 + 15% + 25%` is 1.15 * 1.25 and not
 * 1.40; a reader who expects the second reading gets a different number and
 * this file is where they find out which one the engine means.
 *
 * A few results are compared with `toBeCloseTo` rather than `toBe`, matching
 * the existing percentage specs. The factor form introduces a rounding error
 * an addition would not (`200 + 10%` lands on 220.00000000000003), which is
 * reported separately; the tolerance here keeps this file about semantics.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

function evaluate(source: string) {
	const engine = newTrackedEngine();
	const value = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("the rate at its boundaries", () => {
	test("nothing at all leaves the quantity alone", () => {
		expect(num("200 + 0%")).toBe(200);
		expect(num("200 - 0%")).toBe(200);
		expect(num("0% of 200")).toBe(0);
	});

	test("all of it doubles or cancels", () => {
		// x * (1 + 1) and x * (1 - 1). The second is the one worth having a
		// test for: a full discount has to reach exactly zero, not a residue.
		expect(num("200 + 100%")).toBe(400);
		expect(num("200 - 100%")).toBe(0);
		expect(num("100% of 200")).toBe(200);
	});

	test("more than all of it is allowed in both directions", () => {
		expect(num("200 + 150%")).toBe(500);
		expect(num("200 - 150%")).toBe(-100);
		expect(num("200% of 50")).toBe(100);
	});

	test("a negative rate reverses the operator", () => {
		// Adding -10% is the same as subtracting 10%, which is the only
		// reading that keeps the arithmetic consistent.
		expect(num("200 + -10%")).toBeCloseTo(180, 10);
		expect(num("200 - -10%")).toBeCloseTo(220, 10);
		expect(num("-50% of 200")).toBe(-100);
	});

	test("which requires a negated percentage to still be a percentage", () => {
		// NEG used to fall through to its plain-number branch, so `-10%` came
		// out as the bare number -0.1 and every rule that reads a Percentage
		// operand stopped recognising one: `200 + -10%` answered 199.9, the
		// sum of 200 and a tenth. Unary plus had the same hole.
		expect(evaluate("-10%").type).toBe(ValueType.Percentage);
		expect(evaluate("+10%").type).toBe(ValueType.Percentage);
		expect(evaluate("-(10%)").type).toBe(ValueType.Percentage);
		expect(num("-10%")).toBeCloseTo(-0.1, 12);
	});

	test("and a negated rate cancels the same rate exactly", () => {
		const cancelled = evaluate("-10% + 10%");
		expect(cancelled.type).toBe(ValueType.Percentage);
		expect(cancelled.toNumber()).toBe(0);
	});

	test("a negated rate on money discounts it", () => {
		const discounted = evaluate("$300 + -15%");
		expect(discounted.type).toBe(ValueType.Uom);
		expect(discounted.unit).toBe("USD");
		expect(discounted.toNumber()).toBeCloseTo(255, 10);
	});

	test("and a negative quantity keeps the scaling honest", () => {
		expect(num("-200 + 10%")).toBeCloseTo(-220, 10);
		expect(num("-200 - 10%")).toBeCloseTo(-180, 10);
	});
});

describe("chains compound rather than accumulate", () => {
	test("two increases multiply", () => {
		// 1.1 * 1.1 = 1.21, not 1 + 0.1 + 0.1.
		expect(num("200 + 10% + 10%")).toBeCloseTo(242, 8);
		expect(num("1 + 15% + 25%")).toBeCloseTo(1.4375, 10);
	});

	test("two decreases do too, which is why they never reach zero", () => {
		// 0.9 * 0.9 = 0.81. A reader expecting 20% off in total gets 19%.
		expect(num("1000 - 10% - 10%")).toBe(810);
		expect(num("100 - 50% - 50%")).toBe(25);
	});

	test("an increase and a decrease do not cancel", () => {
		// 1.1 * 0.9 = 0.99. The classic markup-then-discount trap, and the
		// engine gets it right.
		expect(num("200 + 10% - 10%")).toBeCloseTo(198, 8);
		expect(num("200 - 10% + 10%")).toBeCloseTo(198, 8);
	});

	test("a full discount stays at zero however many follow it", () => {
		expect(num("200 - 100% + 50%")).toBe(0);
	});
});

describe("units come through the scaling", () => {
	test("money keeps its currency", () => {
		const marked = evaluate("$300 + 15%");
		expect(marked.type).toBe(ValueType.Uom);
		expect(marked.unit).toBe("USD");
		expect(marked.toNumber()).toBeCloseTo(345, 10);
	});

	test("and so does anything else measured", () => {
		const heavier = evaluate("5 kg + 10%");
		expect(heavier.type).toBe(ValueType.Uom);
		expect(heavier.unit).toBe("kg");
		expect(heavier.toNumber()).toBeCloseTo(5.5, 10);
	});

	test("a full discount on money is zero of that money", () => {
		const nothing = evaluate("$300 - 100%");
		expect(nothing.type).toBe(ValueType.Uom);
		expect(nothing.unit).toBe("USD");
		expect(nothing.toNumber()).toBe(0);
	});

	test("multiplying by a rate is a share of the quantity, unit intact", () => {
		const share = evaluate("$300 * 10%");
		expect(share.type).toBe(ValueType.Uom);
		expect(share.unit).toBe("USD");
		expect(share.toNumber()).toBeCloseTo(30, 10);
	});
});

describe("two proportions", () => {
	test("add and subtract as proportions, staying proportions", () => {
		expect(evaluate("50% + 50%").type).toBe(ValueType.Percentage);
		expect(num("50% + 50%")).toBe(1);
		expect(num("90% - 40%")).toBeCloseTo(0.5, 10);
		expect(num("10% - 30%")).toBeCloseTo(-0.2, 10);
	});

	test("a percentage of a percentage is the product", () => {
		expect(num("50% of 50%")).toBe(0.25);
		expect(num("10% of 10%")).toBeCloseTo(0.01, 12);
	});

	test("and dividing two rates cancels them", () => {
		expect(num("10% / 10%")).toBe(1);
		expect(num("50% / 10%")).toBeCloseTo(5, 10);
	});
});

describe("the two spoken orders agree with the written one", () => {
	test("a markup", () => {
		expect(num("10% on 200")).toBeCloseTo(220, 10);
		expect(num("200 + 10%")).toBeCloseTo(220, 10);
	});

	test("a discount", () => {
		expect(num("10% off 200")).toBe(180);
		expect(num("200 - 10%")).toBe(180);
	});

	test("at the boundary rates too", () => {
		expect(num("100% off 200")).toBe(0);
		expect(num("0% off 200")).toBe(200);
		expect(num("150% on 200")).toBe(500);
	});

	test("and a percentage written first scales what follows it", () => {
		// "10% + $5" is $5.50, the same answer as "$5 + 10%": a proportion has
		// to be a proportion OF something, and the money is the only candidate
		// on the line. It used to answer $5.10, the bare fraction 0.1 added as
		// though it were ten cents, and it kept the currency symbol while
		// doing it, so nothing on screen said anything had gone wrong.
		const markup = evaluate("10% + $5");
		expect(markup.type).toBe(ValueType.Uom);
		expect(markup.unit).toBe("USD");
		expect(markup.toNumber()).toBeCloseTo(5.5, 10);

		// Subtraction reads the same way round, which keeps it one rule.
		const discount = evaluate("10% - $5");
		expect(discount.unit).toBe("USD");
		expect(discount.toNumber()).toBeCloseTo(4.5, 10);
	});

	test("and it does the same for a unit that is not money", () => {
		const heavier = evaluate("10% + 200 kg");
		expect(heavier.unit).toBe("kg");
		expect(heavier.toNumber()).toBeCloseTo(220, 10);
	});

	test("while a percentage on both sides is still a proportion", () => {
		// The new rule is about a measured quantity on the other side, so the
		// existing percentage-plus-percentage and percentage-plus-number
		// readings have to be untouched.
		expect(evaluate("10% + 20%").type).toBe(ValueType.Percentage);
		expect(num("10% + 20%")).toBeCloseTo(0.3, 10);
		expect(evaluate("100% + 2").type).toBe(ValueType.Percentage);
		expect(num("100% + 2")).toBe(3);
	});

	test("and solving backwards from a result returns the base", () => {
		// 200 * 1.05 = 210 and 200 * 0.95 = 190, so both have to come back
		// to 200 exactly.
		expect(num("5% on what is 210")).toBe(200);
		expect(num("5% off what is 190")).toBe(200);
		expect(num("10% of what is 20")).toBe(200);
	});
});

describe("percentage change between two numbers", () => {
	test("up and down", () => {
		expect(num("100 to 150")).toBeCloseTo(0.5, 10);
		expect(num("150 to 100")).toBeCloseTo(-1 / 3, 10);
	});

	test("all the way down is minus everything", () => {
		expect(num("100 to 0")).toBe(-1);
	});

	test("no change at all is zero, not a rounding residue", () => {
		expect(num("100 to 100")).toBe(0);
		expect(num("0.1 to 0.1")).toBe(0);
	});

	test("the result is a proportion, so it renders as one", () => {
		expect(evaluate("100 to 150").type).toBe(ValueType.Percentage);
	});
});

describe("what a bare percentage is worth on its own", () => {
	test("its fraction, whatever the rate", () => {
		expect(num("0%")).toBe(0);
		expect(num("100%")).toBe(1);
		expect(num("250%")).toBe(2.5);
		expect(num("-25%")).toBe(-0.25);
	});

	test("and it stays a Percentage rather than degrading to a number", () => {
		expect(evaluate("0%").type).toBe(ValueType.Percentage);
		expect(evaluate("250%").type).toBe(ValueType.Percentage);
		expect(evaluate("(10)%").type).toBe(ValueType.Percentage);
	});

	test("asking for it as a decimal takes the tag off", () => {
		expect(evaluate("20% as decimal").type).toBe(ValueType.Number);
		expect(num("20% as decimal")).toBe(0.2);
	});
});
