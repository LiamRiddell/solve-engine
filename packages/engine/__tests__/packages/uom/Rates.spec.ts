/**
 * Rates: a quantity per a unit, with no number in the denominator.
 *
 * This is the distinction the whole feature turns on. `3 hours / day` is a
 * rate; `3 hours / 3 days` is a division that cancels to a plain number. They
 * are told apart by whether a number was written, which is a fact about the
 * source text, so it is decided by a normalizer rather than at evaluation.
 *
 * An earlier attempt supplied the missing `1` and let ordinary division run.
 * It made `$50/week * 12 weeks` work and turned `3 hours / day` into 0.125,
 * because once the denominator has a number the same-measure units cancel.
 * That was reverted. The rate is now constructed directly and no division
 * happens, which is why both of the first two tests below can pass at once.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

function evaluate(source: string) {
	const engine = newTrackedEngine("en");
	const [value] = engine.evaluateExpression(source);
	return value;
}

const num = (source: string) => evaluate(source).toNumber();

describe("a bare denominator makes a rate", () => {
	test("`3 hours / day` stays a rate rather than cancelling", () => {
		const value = evaluate("3 hours / day");
		expect(value.toNumber()).toBeCloseTo(3, 6);
		expect(value.unit).toBe("hours/day");
	});

	test("`3 hours per day` reads the same", () => {
		expect(evaluate("3 hours per day").unit).toBe("hours/day");
	});

	test("the articles work too", () => {
		expect(evaluate("3 hours a day").unit).toBe("hours/day");
		expect(evaluate("3 hours each day").unit).toBe("hours/day");
	});

	test("money per period", () => {
		const value = evaluate("$99 / week");
		expect(value.toNumber()).toBeCloseTo(99, 6);
		expect(value.unit).toBe("USD/week");
	});
});

describe("a numbered denominator is still a division", () => {
	test("`3 hours / 3 days` cancels to a plain number", () => {
		// The case the reverted shortcut broke. Same measure over same
		// measure is dimensionless, and must stay that way.
		expect(num("3 hours / 3 days")).toBeCloseTo(0.0416667, 6);
	});

	test("`90 km / 3 day` was already a rate and still is", () => {
		const value = evaluate("90 km / 3 day");
		expect(value.toNumber()).toBeCloseTo(30, 6);
		expect(value.unit).toBe("km/day");
	});

	test("ordinary division is untouched", () => {
		expect(num("12 / 4")).toBe(3);
		expect(num("1000 / 200")).toBe(5);
	});
});

describe("rates in arithmetic", () => {
	test("a rate times a matching period gives the total", () => {
		expect(num("$50/week * 12 weeks")).toBeCloseTo(600, 6);
	});

	test("and the total is money, not a rate", () => {
		expect(evaluate("$50/week * 12 weeks").unit).toBe("USD");
	});
});

describe("what the rate rule must not claim", () => {
	test("`per` away from a unit is an ordinary word", () => {
		const engine = newTrackedEngine("en");
		engine.evaluateExpression(":per = 5");
		expect(engine.evaluateExpression(":per + 1")[0].toNumber()).toBe(6);
	});

	test("`a` before a non-unit is untouched", () => {
		// The article only introduces a denominator when a real unit follows.
		expect(num("seconds in a day")).toBeCloseTo(86400, 6);
	});
});

describe("still open, and failing honestly rather than wrongly", () => {
	/**
	 * Recorded so the boundary is visible. These throw rather than answering
	 * something plausible, which is the acceptable failure, but they are not
	 * done.
	 */
	test("a bare number as the numerator does not reach the rate parselet", () => {
		expect(() => evaluate("99 per week")).toThrow();
	});

	test("adding rates over different periods is not unified", () => {
		// `$20/day + $300/week` needs the two periods reconciled before they
		// can be added. It reports incompatible units instead.
		const value = evaluate("$20/day + $300/week");
		expect(String(value.value)).toMatch(/incompatible/i);
	});
});
