import { Value, ValueType, numberValue, uomValue, errorValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { calendarOf } from "@solve-js/calendar/DateCalendar";
import { adjustByCurrency, inflationIndexFor, isPriceIndex } from "../data/InflationAmount";
import { rateAtOrBelowMinusHundred } from "@solve-js/vm/FinanceFormulas";

/**
 * Inflation plugin functions -- registered via IEnginePackage.pluginFunctions
 * (collision-safe allocator), not VMBuiltins.ts's shared builtinFunctions
 * registry, since none of these need function-call (`name(args)`)
 * reachability through FunctionCallParselet -- only the general 3-arg
 * `inflationAdjust(amount, fromYear, toYear)` needs that (see VMBuiltins.ts
 * CALL_BUILTIN index 60). Matches TimezonePluginFunctions.ts's pattern.
 *
 * "Present year" is computed at VM EXECUTION time (read from the calendar
 * backend inside the handler), not baked in at parse time -- same reasoning
 * as this engine's DATE_NOW opcode: a parse-time constant would go stale if
 * the compiled bytecode for a line is ever re-executed on a later date.
 *
 * The index is chosen by the amount's currency (#756): see
 * `data/InflationAmount.ts` and `data/PriceIndices.ts`.
 */

/** The current calendar year, read through the engine's calendar backend. */
function presentYear(context: LineExecutionContext | undefined): number {
  const calendar = calendarOf(context);
  return calendar.fields(calendar.now()).year;
}

/** Adjust `amount` between two years by its currency's index, keeping its unit. */
function adjusted(amount: Value, fromYear: number, toYear: number): Value {
  const result = adjustByCurrency(amount, fromYear, toYear);
  if ("refused" in result) return result.refused;
  return amount.type === ValueType.Uom ? uomValue(result.value, amount.unit!) : numberValue(result.value);
}

/**
 * "what is $X from YEAR" -> X (given as YEAR's money) expressed in present-day
 * money, by the index the amount's currency picks.
 */
export function inflationFromYearToPresentHandler(args: Value[], context?: LineExecutionContext): Value {
  const chosen = inflationIndexFor(args[0]);
  if (!isPriceIndex(chosen)) return chosen;
  return adjusted(args[0], args[1].toNumber(), presentYear(context));
}

/**
 * "what was $X worth in YEAR" -> X (given as present-day money) expressed in
 * YEAR's money, by the index the amount's currency picks.
 */
export function inflationToYearFromPresentHandler(args: Value[], context?: LineExecutionContext): Value {
  const chosen = inflationIndexFor(args[0]);
  if (!isPriceIndex(chosen)) return chosen;
  return adjusted(args[0], presentYear(context), args[1].toNumber());
}

/**
 * "$X in YEAR dollars" -> the same question as `what was $X worth in YEAR`,
 * asked in dollars. The phrase names the currency, so an amount in another
 * currency an index is bundled for is refused with the form that reads its own
 * index (`£100 in 1990 dollars` asks for dollars of a pound amount, which is a
 * conversion and an adjustment at once, and neither is what the line says).
 */
export function inflationToYearDollarsHandler(args: Value[], context?: LineExecutionContext): Value {
  const amount = args[0];
  const chosen = inflationIndexFor(amount);
  if (!isPriceIndex(chosen)) return chosen;
  const year = args[1].toNumber();
  if (chosen.currency !== "USD") {
    return errorValue(
      "INFLATION_EXPECTED_USD",
      `in ${year} dollars asks for US dollars, and this amount is in ${chosen.currency}: ask what it was worth in ${year} instead, which reads ${chosen.name}`,
    );
  }
  return adjusted(amount, presentYear(context), year);
}

/**
 * "value of $X in FUTURE_YEAR assuming N% inflation" -> what that money will
 * be WORTH then, i.e. its purchasing power, discounted rather than grown:
 * PV = amount / (1 + rate) ^ years. Not CPI-table-based, since future years
 * are not in the historical table. `rate` is a decimal fraction (0.03 for 3%),
 * matching the convention everywhere else in this codebase.
 *
 * This used to multiply, reporting `value of $500 in 2028 assuming 5%
 * inflation` as a number LARGER than $500. That is the wrong direction and it
 * inverts the meaning of the question: inflation makes money worth less, and
 * the whole point of asking is to see how much less. Soulver answers $411.35
 * for that line, and shows the same figure for its `purchasing power of $500
 * in 2028 at 5% inflation` phrasing, which is what settles the reading.
 *
 * Growing a sum at a rate is still available and is a different question:
 * `$500 after 4 years at 5%` (see InvestmentParselets.ts).
 */
export function inflationFutureValueHandler(args: Value[], context?: LineExecutionContext): Value {
  const amountValue = args[0];
  const futureYear = args[1].toNumber();
  const rate = args[2].toNumber();
  const years = futureYear - presentYear(context);
  if (1 + rate <= 0) {
    return rateAtOrBelowMinusHundred(rate, "An inflation rate");
  }
  const amount = amountValue.toNumber();
  const worth = amount / Math.pow(1 + rate, years);
  return amountValue.type === ValueType.Uom ? uomValue(worth, amountValue.unit!) : numberValue(worth);
}
