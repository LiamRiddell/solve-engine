/**
 * A recurring schedule adds itself up: `<amount> <period> for <duration>`.
 *
 * Subscriptions, salaries and instalments are the most common thing anyone
 * adds up in a note, and there was no way to write the series, so the total
 * had to be worked out elsewhere and typed back in as a number, which is the
 * part worth checking. `450 monthly for 18 months` now answers 8,100 on its
 * own, `2000 every 2 weeks for 6 months` answers 26,000, and money rides
 * along: `£450 monthly for 18 months` is `£8100.00`.
 *
 * The total is the primary result. The number of payments is the secondary
 * detail that produced it (total = per-payment amount times the payment
 * count), and because the engine has no channel for a note beside a number,
 * it is the total that shows. The count is a whole number: one payment per
 * completed period, so a final part-period that has not come due is not
 * counted, and `every 2 weeks for 5 weeks` is two payments, not three.
 *
 * The period counts by a scheduling year (monthly is 12 a year, weekly 52,
 * daily 365), not by the calendar-second length of a month, which is what
 * makes `every 2 weeks for 6 months` a clean 13: twenty-six payments a year,
 * over half a year.
 *
 * It is implemented as a rewrite to a plain `amount * count`, so a currency
 * amount stays currency and an exact one (`£12.99`) stays exact through the
 * same money-multiply path that makes `£12.99 * 24` exactly `£311.76`. A bare
 * decimal stays an ordinary float, as it does everywhere else in the engine.
 * The "what must keep working" block guards the finance and rate grammar the
 * word `for` is shared with.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/** The formatted, user-facing result of a single expression. */
function display(expr: string): string {
  const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  const value = engine.evaluateExpression(expr);
  return formatValue(value);
}

/** The evaluated Value, for asserting its type, number and exact sidecar directly. */
function evaluate(expr: string) {
  const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  const value = engine.evaluateExpression(expr);
  return value;
}

describe("the headline forms total the series", () => {
  test.each<[string, string]>([
    ["450 monthly for 18 months", "= 8,100"],
    ["12.99 monthly for 2 years", "= 311.76"],
    ["2000 every 2 weeks for 6 months", "= 26,000"],
  ])("%s is %s", (expr, expected) => {
    expect(display(expr)).toBe(expected);
  });

  test.each<[string, number]>([
    ["450 monthly for 18 months", 8100],
    ["12.99 monthly for 2 years", 311.76],
    ["2000 every 2 weeks for 6 months", 26000],
  ])("%s counts out to %d", (expr, total) => {
    expect(evaluate(expr).toNumber()).toBeCloseTo(total, 6);
  });

  test("the total is exactly the per-payment amount times the payment count", () => {
    // 24 monthly payments over two years, the same as writing the product out.
    expect(evaluate("12.99 monthly for 2 years").toNumber()).toBe(evaluate("12.99 * 24").toNumber());
  });
});

describe("every named period, and the every-N form", () => {
  test.each<[string, number]>([
    ["100 weekly for 4 weeks", 400],
    ["10 daily for 1 week", 70],
    ["500 yearly for 3 years", 1500],
    ["500 annually for 3 years", 1500],
    ["100 monthly for a year", 1200],
    ["100 every 3 months for 2 years", 800],
    ["100 every 2 weeks for 1 year", 2600],
    ["100 every 6 months for 5 years", 1000],
  ])("%s totals %d", (expr, total) => {
    expect(evaluate(expr).toNumber()).toBeCloseTo(total, 6);
  });
});

describe("money rides along, and stays exact where the amount is exact", () => {
  test.each<[string, string]>([
    ["£450 monthly for 18 months", "= £8100.00"],
    ["$12.99 monthly for 2 years", "= $311.76"],
    ["$19.99 monthly for 3 months", "= $59.97"],
    ["$2000 every 2 weeks for 6 months", "= $26000.00"],
  ])("%s is %s", (expr, expected) => {
    expect(display(expr)).toBe(expected);
  });

  test("a currency amount produces a currency total", () => {
    const value = evaluate("$450 monthly for 18 months");
    expect(value.type).toBe(ValueType.Uom);
    expect(value.unit).toBe("USD");
    expect(value.toNumber()).toBeCloseTo(8100, 6);
  });

  test("an exact cent amount totals exactly, not on the drifted double", () => {
    // 0.10 * 3 is 0.30000000000000004 in raw float; the money path carries the
    // exact 0.3, the same guarantee `$0.10 + $0.20` relies on.
    const value = evaluate("$0.10 weekly for 3 weeks");
    expect(value.type).toBe(ValueType.Uom);
    expect(value.value).toBe(0.3);
  });

  test("the boundary is the currency: a bare decimal series is still a float", () => {
    // Stated so the exactness above reads as a currency guarantee, not a
    // schedule one. A plain number behaves as it does everywhere in the engine.
    expect(evaluate("0.10 weekly for 3 weeks").value).toBe(0.30000000000000004);
  });
});

describe("a part period has not come due, so it is not a payment", () => {
  test("every 2 weeks for 5 weeks is two payments, the third has not fallen", () => {
    expect(evaluate("2000 every 2 weeks for 5 weeks").toNumber()).toBe(4000);
  });

  test("a span shorter than one whole period is zero payments", () => {
    expect(evaluate("2000 every 2 weeks for 1 week").toNumber()).toBe(0);
  });

  test("a monthly amount over a part of a month floors to the whole months", () => {
    // 45 days is one whole month on the scheduling year (12 a year), not two.
    expect(evaluate("300 monthly for 45 days").toNumber()).toBe(300);
  });

  test("a currency zero-payment total keeps the currency", () => {
    expect(display("£50 every 2 weeks for 1 week")).toBe("= £0.00");
  });
});

describe("a schedule that cannot be counted says so, and the engine goes on", () => {
  test("a zero interval is reported, not divided by", () => {
    expect(() => evaluate("100 every 0 weeks for 6 months")).toThrow(/positive/);
  });

  test("the error is contained to its line, the next line still evaluates", () => {
    const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    const { lines } = engine.parseDocument("100 every 0 weeks for 6 months\n2 + 2", {
      inputType: "markdown",
    });
    expect(lines[0].error).toBeTruthy();
    expect(lines[1].result?.value).toBe(4);
  });
});

describe("what must keep working", () => {
  test("the investment `for` is untouched: a rate, not a schedule", () => {
    // `1000 for 3 years at 7%` has no period word and ends in a rate, so it
    // stays compound growth. This is the collision the design guards against.
    expect(evaluate("1000 for 3 years at 7%").toNumber()).toBeCloseTo(1225.043, 3);
    expect(display("$1,000 after 3 years at 7%")).toBe("= $1225.04");
  });

  test("the loan-repayment phrase still amortizes", () => {
    expect(evaluate("monthly repayment on 10000 over 6 years at 6%").toNumber()).toBeCloseTo(165.7289, 3);
  });

  test("a rate times a duration (`$24 a day for a year`) is untouched", () => {
    // `a day` is an article and a unit, not a period word, so the uom rate
    // grammar keeps it: $24/day over 365 days.
    expect(display("$24 a day for a year")).toBe("= $8760.00");
  });

  test("the period words are still ordinary variable names", () => {
    const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    engine.evaluateExpression(":monthly = 5");
    engine.evaluateExpression(":weekly = 7");
    engine.evaluateExpression(":daily = 3");
    engine.evaluateExpression(":yearly = 2");
    engine.evaluateExpression(":every = 9");
    const value = engine.evaluateExpression(":monthly + :weekly + :daily + :yearly + :every");
    expect(value.toNumber()).toBe(26);
  });

  test("the amount may be a variable or a grouped expression", () => {
    const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    engine.evaluateExpression(":rent = 1200");
    expect(engine.evaluateExpression(":rent monthly for 12 months").toNumber()).toBe(14400);
    expect(evaluate("(20 + 5) monthly for 2 years").toNumber()).toBe(600);
  });

  test("ordinary arithmetic and precedence are unaffected", () => {
    expect(evaluate("(1 + 2) * 3").toNumber()).toBe(9);
  });
});
