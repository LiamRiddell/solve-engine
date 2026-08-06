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

	test("a bare number as the numerator, with no unit of its own", () => {
		// This threw until implicit multiplication stopped inserting a `*`
		// between the number and the `per`. The slash spelling never had the
		// problem, which is what made it hard to find.
		expect(evaluate("99 per week").unit).toBe("/week");
		expect(num("99 per week")).toBeCloseTo(99, 6);
	});

	test("and the same through an article", () => {
		expect(evaluate("99 a week").unit).toBe("/week");
	});

	test("money per period, both spellings", () => {
		expect(evaluate("$99 per week").unit).toBe("USD/week");
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

	test("implicit multiplication still fires where it should", () => {
		// The guard added for rate words is narrow: it only suppresses the
		// multiplication when one of those words is followed by a real unit.
		expect(num("2 pi")).toBeCloseTo(Math.PI * 2, 6);
		expect(num("2(3 + 4)")).toBe(14);
	});

	test("`a` before a non-unit is untouched", () => {
		// The article only introduces a denominator when a real unit follows.
		expect(num("seconds in a day")).toBeCloseTo(86400, 6);
	});
});

describe("rates over different periods", () => {
	test("`$20/day + $300/week` is $440/week", () => {
		// Reported incompatible units, because USD/day and USD/week are
		// literally different unit strings. They measure the same thing per
		// different periods, so one converts into the other.
		const value = evaluate("$20/day + $300/week");
		expect(value.toNumber()).toBeCloseTo(440, 6);
		expect(value.unit).toBe("USD/week");
	});

	test("the right operand's period wins, being the one just written", () => {
		expect(evaluate("$300/week + $20/day").unit).toBe("USD/day");
		expect(num("$300/week + $20/day")).toBeCloseTo(62.857143, 5);
	});

	test("subtraction reconciles the same way", () => {
		expect(num("$20/day - $70/week")).toBeCloseTo(70, 6);
	});

	test("matching periods are unaffected", () => {
		expect(num("$20/day + $10/day")).toBeCloseTo(30, 6);
	});

	test("rates measuring different things are still refused", () => {
		// Money per day and kilometres per hour have no common sum, and
		// reconciling only the period would produce a confident nonsense.
		expect(String(evaluate("$20/day + 5 km/hour").value)).toMatch(/incompatible/i);
	});
});

describe("a quantity at a rate", () => {
	test("`30 hours at $30/hour` is $900", () => {
		const value = evaluate("30 hours at $30/hour");
		expect(value.toNumber()).toBeCloseTo(900, 6);
		expect(value.unit).toBe("USD");
	});

	test("`$500 at $20/hour` is 25 hours", () => {
		// The same word, the opposite operation. Which one applies is decided
		// by which half of the rate the left side matches.
		const value = evaluate("$500 at $20/hour");
		expect(value.toNumber()).toBeCloseTo(25, 6);
		expect(value.unit).toBe("hour");
	});

	test("a bare number counts denominators", () => {
		expect(num("30 at $30/hour")).toBeCloseTo(900, 6);
	});

	test("the period is converted when it does not match", () => {
		expect(num("120 minutes at $30/hour")).toBeCloseTo(60, 6);
	});

	test("a left side matching neither half is refused", () => {
		// The error code; the message naming both units is in `unit`.
		expect(String(evaluate("5 km at $30/hour").value)).toBe("INCOMPATIBLE_UNITS");
	});
});

describe("what `at` must not disturb", () => {
	/**
	 * The reason this is triggered by a normalizer with lookahead rather than
	 * by an infix on the plain word. An infix took the token before the finance
	 * parselets could, and every mortgage and investment expression failed with
	 * "Unexpected end of input".
	 */
	test("compound interest still parses", () => {
		expect(num("$1,000 after 3 years at 7%")).toBeCloseTo(1225.043, 2);
	});

	test("mortgage repayments still parse", () => {
		expect(num("monthly repayment on $10,000 over 6 years at 6%")).toBeCloseTo(165.73, 1);
	});

	test("sales tax still parses", () => {
		expect(num("tax on $300 at 15%")).toBeCloseTo(45, 6);
	});
});

describe("still open, and failing honestly rather than wrongly", () => {

	test("an unrecognised numerator word is not a unit", () => {
		// "30 bottles / week" needs "bottles" to be treated as a countable
		// label rather than a variable, which is a lexer question.
		expect(() => evaluate("30 bottles / week")).toThrow();
	});
});
