/**
 * Money and rates: the currency vocabulary, and the arithmetic built on top of
 * a "per" unit.
 *
 * `Iso4217Currencies.spec.ts` fixed one half of the `$100 in UAH` bug by
 * answering "is this a currency" from the standard instead of from a
 * hand-written list of forty-six codes. It closes with a test recording that
 * the other half is still open: an unknown code returns the input unchanged.
 *
 * This file establishes how wide the remaining half actually is. The answer is
 * that it is not limited to codes nobody has heard of. There are two lists,
 * `CURRENCY_CODES` in `lexer/units.ts` (what can be typed) and the ISO set plus
 * the crypto tickers in `CurrencyExchange` (what counts as money), they have
 * drifted apart in both directions, and each direction produces a different
 * failure: codes the lexer alone knows convert silently to nothing, and codes
 * the exchange alone knows can be a target but never a source.
 *
 * Rates then get the same treatment. Rate ARITHMETIC turns out to be in good
 * shape; rate CONVERSION is not implemented at all, and one of its shapes is
 * silent.
 *
 * Nothing here depends on a live exchange rate. A pair that reaches the
 * resolver returns Pending, which is the observable evidence that it got that
 * far, and is what the ISO spec asserts too.
 *
 * ## One assertion per `test.failing`
 * A `test.failing` passes when its body throws, so only the FIRST assertion to
 * fail is ever reached and the rest of the body never runs. Several assertions
 * in one of them therefore hide each other: an assertion before the failing one
 * can go from failing to PASSING, which means the behaviour it describes
 * changed, and the run stays green because the test still fails further down.
 *
 * That is not hypothetical here. The rate-conversion cases below asserted the
 * result type and then its number, and when `60 km/h in m/s` stopped being an
 * error and started answering `0.00 /s` (a number in a unit with no numerator,
 * from a conversion that had silently failed), the type assertion began passing
 * and this suite reported nothing at all. A differential run against the last
 * published build is what found it. Every `test.failing` in this file now makes
 * exactly one assertion, so any one of them starting to pass is reported as a
 * failure by Jest, which is the whole point of writing them this way.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { knownUnits } from "@solve-js/lexer/units";
import { ISO_4217_CODES } from "@solve-js/uom/Iso4217";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { isConvertibleUnit } from "@solve-js/uom/UomConverter";

/** One line through a real engine. */
function evaluate(source: string): Value {
	const engine = newTrackedEngine("en");
	try {
		return engine.evaluateExpression(source)[0];
	} finally {
		engine.clear();
	}
}

/** The formatted result, with the leading "= " stripped. */
function display(source: string): string {
	return formatValue(evaluate(source)).replace(/^=\s*/, "");
}

/** Whether `source` fails at tokenization rather than evaluating to anything. */
function throwsOnEvaluation(source: string): boolean {
	try {
		evaluate(source);
		return false;
	} catch {
		return true;
	}
}

/**
 * The three-letter codes the lexer will tokenize, taken from `knownUnits`
 * rather than retyped so the list cannot drift from the one the lexer uses.
 *
 * Real units of that shape are filtered out: `MVA` (megavolt-ampere) and `MTON`
 * (measurement ton) match the same pattern and are not money. `getMeasure()`
 * returning undefined for a currency is exactly how `VM.ts` tells the two
 * apart, so the same test is used here.
 */
const LEXABLE_CODES = [...knownUnits].filter(
	(unit) => /^[A-Z]{3}$/.test(unit) && !isConvertibleUnit(unit),
);

/**
 * Codes the lexer accepts that the exchange does not consider money.
 *
 * Every one of these reaches the `else` branch of `UOM_CONVERT_TO` and comes
 * back as the untouched input, which is the `$100 in ZZZ` shape with codes that
 * look far more legitimate than ZZZ does.
 */
const LEXABLE_BUT_NOT_MONEY = LEXABLE_CODES.filter(
	(code) => !sharedCurrencyExchange.isCurrency(code),
);

describe("the two currency vocabularies", () => {
	test("the lexer's list and the exchange's disagree in both directions", () => {
		// Stated as a fact about the current state so the two counts below have
		// something to be compared against. Both numbers should be zero.
		expect(LEXABLE_CODES.length).toBeGreaterThan(130);
		expect(LEXABLE_BUT_NOT_MONEY.length).toBeGreaterThan(0);
		expect([...ISO_4217_CODES].filter((code) => !knownUnits.has(code)).length).toBeGreaterThan(0);
	});

	test.failing("every code that can be typed is one the exchange recognises", () => {
		// BUG. Seven codes are typeable but are not money, so a conversion into
		// any of them silently succeeds at a rate of one. Three are withdrawn
		// (HRK left for the euro in 2023, ZWL and VEB were both redenominated),
		// one is a non-currency by design (XDR is the IMF unit of account, which
		// `Iso4217.ts` deliberately excludes), and KGZ is not an ISO code at all:
		// Kyrgyzstan is KGS, which the lexer does NOT have.
		expect(LEXABLE_BUT_NOT_MONEY).toEqual([]);
	});

	test.failing("and every active ISO code can be typed", () => {
		// BUG. Thirty-five active codes reach `isCurrency` but never reach the
		// lexer, because `CURRENCY_CODES` in lexer/units.ts is still
		// hand-maintained. The consequence is asymmetric rather than merely
		// missing, see the test below.
		expect([...ISO_4217_CODES].filter((code) => !knownUnits.has(code))).toEqual([]);
	});
});

describe("a code the lexer knows but the exchange does not", () => {
	test("does not silently convert at a rate of one", () => {
		// Was the unfixed half of the `$100 in UAH` bug, reached through codes
		// that are not obviously nonsense. `$100 in HRK` reported "$100.00": not
		// an error, not a conversion, the input.
		for (const code of LEXABLE_BUT_NOT_MONEY) {
			expect(evaluate(`$100 in ${code}`).type).toBe(ValueType.Error);
		}
	});

	test("in either direction", () => {
		// The mirror image. A withdrawn code as the SOURCE was equally silent.
		expect(evaluate("100 HRK in EUR").type).toBe(ValueType.Error);
		expect(evaluate("100 ZWL in USD").type).toBe(ValueType.Error);
	});

	test("and neither does a code that is not a code", () => {
		// The one `Iso4217Currencies.spec.ts` already records, repeated here
		// because it is the same defect and was fixed by the same change.
		expect(evaluate("$100 in ZZZ").type).toBe(ValueType.Error);
	});

	test("whereas a code both lists agree on reaches the rate resolver", () => {
		// Pending is the evidence that a real lookup was started, and is what
		// separates the cases above from a working conversion.
		expect(evaluate("100 USD in EUR").type).toBe(ValueType.Pending);
		expect(evaluate("$100 in UAH").type).toBe(ValueType.Pending);
		expect(evaluate("$100 in DOGE").type).toBe(ValueType.Pending);
		expect(evaluate("100 euros in dollars").type).toBe(ValueType.Pending);
	});
});

describe("a code the exchange knows but the lexer does not", () => {
	// BUG. `$100 in AFN` reaches the resolver, but `100 AFN in USD` fails at
	// tokenization with "Undefined variable: AFN". The same code is money in
	// one position and a typo in the other. Thirty-five active codes are in
	// this state, including GHS, VES, PEN, IQD, KGS and BSD.
	//
	// One case per code, and the premise asserted separately below, for the
	// reason in this file's header: a loop inside a single `test.failing` stops
	// at the first code that fails, so the other four could each start working
	// or start failing differently with nothing to show for it.
	const EXCHANGE_ONLY_CODES = ["AFN", "GHS", "VES", "PEN", "BSD"];

	test("the exchange really does consider all five of these money", () => {
		// The premise of the five cases below. It passes today, which is exactly
		// why it cannot live inside them.
		for (const code of EXCHANGE_ONLY_CODES) {
			expect(sharedCurrencyExchange.isCurrency(code)).toBe(true);
		}
	});

	for (const code of EXCHANGE_ONLY_CODES) {
		test.failing(`works as a source as well as a target: ${code}`, () => {
			expect(throwsOnEvaluation(`100 ${code} in USD`)).toBe(false);
		});
	}

	test("the target direction really does work today, which is what makes it asymmetric", () => {
		expect(evaluate("$100 in AFN").type).toBe(ValueType.Pending);
		expect(evaluate("$100 in GHS").type).toBe(ValueType.Pending);
	});
});

describe("currency spellings that do work", () => {
	test("symbols, codes and word forms all reach the same place", () => {
		expect(display("$100")).toBe("$100.00");
		expect(display("£100 in GBP")).toBe("£100.00");
		expect(display("€100 in EUR")).toBe("€100.00");
		expect(evaluate("100 dollars in EUR").type).toBe(ValueType.Pending);
		expect(evaluate("1 BTC in USD").type).toBe(ValueType.Pending);
	});

	test("a code is case sensitive as a source and forgiving as a target", () => {
		// Recorded rather than judged. `100 usd in eur` fails at tokenization
		// because the lexer's list is uppercase, while `$100 in usd` succeeds
		// because the target goes through `isCurrency`, which upper-cases. Worth
		// knowing about before the vocabularies above get reconciled.
		expect(throwsOnEvaluation("100 usd in eur")).toBe(true);
		expect(display("$100 in usd")).toBe("$100.00");
	});

	test("money and a physical unit cannot be added", () => {
		expect(evaluate("$100 + 5 kg").type).toBe(ValueType.Error);
	});

	test("and money cannot be converted into a physical unit either", () => {
		// Was the same silent no-op as the cross-measure cases in
		// UnitsConversionSafety.spec.ts, reached from the money side. Addition
		// refused and conversion did not; both refuse now.
		expect(evaluate("$100 in kg").type).toBe(ValueType.Error);
		expect(evaluate("$100 in seconds").type).toBe(ValueType.Error);
		expect(evaluate("5 kg in GBP").type).toBe(ValueType.Error);
		expect(evaluate("100 USD in m").type).toBe(ValueType.Error);
	});
});

describe("rate arithmetic", () => {
	test("a rate multiplied by a duration cancels the period", () => {
		// Checked against the arithmetic rather than against the display: three
		// days at a hundred an hour is seventy-two hours of work.
		expect(display("$100/hour * 3 hours")).toBe("$300.00");
		expect(display("$100/hour * 1 day")).toBe("$2400.00");
		expect(display("$100/hour * 90 minutes")).toBe("$150.00");
		expect(display("60 km/h * 2 h")).toBe("120.00 km");
		expect(display("10 m/s * 5 s")).toBe("50.00 m");
	});

	test("and by a quantity of whatever it is denominated in", () => {
		expect(display("$2/kg * 3 kg")).toBe("$6.00");
		expect(display("$100/m2 * 50 m2")).toBe("$5000.00");
		expect(display("10 km/l * 50 l")).toBe("500.00 km");
	});

	test("the denominator is converted first, so the units need not match", () => {
		// Three pounds at two dollars a kilogram is $2.72, which is only right if
		// the pounds became kilograms before the multiplication.
		expect(evaluate("$2/kg * 3 lbs").toNumber()).toBeCloseTo(2 * 3 * 0.45359237, 8);
	});

	test("adding two rates unifies their periods onto the right-hand one", () => {
		// A hundred a day is $4.1667 an hour, so the sum is $54.1667 an hour.
		expect(evaluate("$100/day + $50/hour").toNumber()).toBeCloseTo(100 / 24 + 50, 9);
		expect(evaluate("$100/day + $50/hour").unit).toBe("USD/hour");
	});

	test("a rate scales by a bare number and keeps its period", () => {
		expect(display("$100/hour * 24")).toBe("2400.00 USD/hour");
		expect(display("$100/hour / 4")).toBe("25.00 USD/hour");
		expect(display("$100/hour + $100/hour")).toBe("200.00 USD/hour");
	});

	test("multiplying a rate by something unrelated is refused", () => {
		// The good behaviour that makes the conversion failures below stand out.
		expect(evaluate("$100/hour * 3 kg").type).toBe(ValueType.Error);
		expect(evaluate("$100/hour * $2").type).toBe(ValueType.Error);
	});

	test("the workday shim multiplies at the documented fixed ratio", () => {
		// Four weeks is twenty-eight calendar days, which the 7/5 shim reads as
		// twenty workdays. Pinned because the shim is deliberately not the same
		// calendar-aware logic date arithmetic uses.
		expect(evaluate("$500/workday * 4 weeks").toNumber()).toBeCloseTo(10_000, 6);
	});
});

describe("rate conversion", () => {
	/*
	 * Converting a rate. A rate carries the compound unit "numerator/denominator"
	 * (km/h, m/s), and #89 made that unit a first-class conversion source and
	 * target: `convertRate` in uom/UomConverter.ts converts each axis on its own,
	 * and the slash-notation normalizer means a written `km/h` reaches it whole.
	 *
	 * The money-denominated cases below still assert exactly one thing each, which
	 * is why this block is split. It used to assert the type and then the number
	 * inside one `test.failing` each. When the failure mode changed from a visible
	 * error to `0.00 /s` (a conversion that failed, read as zero by the conversion
	 * after it, and dressed in the unit the reader asked for), the type assertion
	 * went from failing to passing while the number went on failing, so the test
	 * went on "failing correctly" and the run stayed green through a change that
	 * made the engine strictly worse. See this file's header, and
	 * `DifferentialRegressions.spec.ts` for the run that caught it.
	 *
	 * A money target written with a symbol and slash, `in $/day`, is still not
	 * captured: `$` lexes as a currency token, not a UNIT, so the slash-notation
	 * normalizer leaves it alone and the target reads as `$` with a stray `/day`.
	 * That pair stays `test.failing`, deferred with #89.
	 */

	test.failing("changes the period", () => {
		expect(evaluate("$100/hour in $/day").toNumber()).toBeCloseTo(2400, 6);
	});

	test.failing("and answers in a unit rather than an error", () => {
		expect(evaluate("$100/hour in $/day").type).toBe(ValueType.Uom);
	});

	test("and the denominator, for a non-money rate", () => {
		// Sixty kilometres an hour is 16.67 metres a second.
		expect(evaluate("60 km/h in m/s").toNumber()).toBeCloseTo(60_000 / 3600, 6);
	});

	test("which is likewise a unit rather than an error", () => {
		expect(evaluate("60 km/h in m/s").type).toBe(ValueType.Uom);
	});

	test("and does not silently do nothing when the target is a speed unit", () => {
		// This one used to be the worst of the three because it was silent:
		// `60 km/h to mph` reported "60.00 km/h", the target dropped and the
		// input handed back. Now the whole `km/h` is one unit and `convertRate`
		// bridges it to the speed spelling `mph`. Sixty kilometres an hour is
		// 37.28 mph, the same answer the engine gives when the source is `kph`.
		expect(evaluate("60 km/h to mph").toNumber()).toBeCloseTo(37.28227153, 6);
	});

	test("and keeps the unit that was asked for", () => {
		expect(evaluate("60 km/h to mph").unit).toBe("mph");
	});

	test("the extended speed units convert between themselves correctly", () => {
		// Which is what makes the case above a plumbing failure rather than a
		// missing conversion: the number is available, the rate unit just cannot
		// reach it.
		expect(evaluate("60 kph in mph").toNumber()).toBeCloseTo(37.28227153, 6);
		expect(evaluate("1 kn in kph").toNumber()).toBeCloseTo(1.852, 9);
		expect(evaluate("1 mps in kph").toNumber()).toBeCloseTo(3.6, 9);
	});
});
