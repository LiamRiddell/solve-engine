import { Value, ValueType, numberValue, uomValue, errorValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import { calendarOf } from "@solve-js/calendar/DateCalendar";
import { adjustByCurrency, countedAmountRefusal, inflationIndexFor, inflationYear, isPriceIndex, isYear } from "../data/InflationAmount";
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
 * money, by the index the amount's currency picks. A year that is not a plain
 * whole number is refused (see `inflationYear`).
 */
export function inflationFromYearToPresentHandler(args: Value[], context?: LineExecutionContext): Value {
  const chosen = inflationIndexFor(args[0]);
  if (!isPriceIndex(chosen)) return chosen;
  const year = inflationYear(args[1]);
  if (!isYear(year)) return year;
  return adjusted(args[0], year, presentYear(context));
}

/**
 * "what was $X worth in YEAR" -> X (given as present-day money) expressed in
 * YEAR's money, by the index the amount's currency picks. A year that is not
 * a plain whole number is refused (see `inflationYear`).
 */
export function inflationToYearFromPresentHandler(args: Value[], context?: LineExecutionContext): Value {
  const chosen = inflationIndexFor(args[0]);
  if (!isPriceIndex(chosen)) return chosen;
  const year = inflationYear(args[1]);
  if (!isYear(year)) return year;
  return adjusted(args[0], presentYear(context), year);
}

/**
 * The amount of `what is 100 apples from 1990`: the refusal, since the word
 * stands where a currency would and no index measures it. The argument is the
 * word as typed (see `countedWord` in InflationQueryParselet.ts).
 */
export function inflationCountedAmountHandler(args: Value[]): Value {
  return errorValue("INFLATION_NO_INDEX", countedAmountRefusal(String(args[0]?.value ?? "")));
}

/** How `in <year> ...` names each currency it reads, and the currency in full. */
const IN_YEAR_CURRENCY_NAMES: ReadonlyMap<string, { readonly word: string; readonly name: string }> = new Map([
  ["USD", { word: "dollars", name: "US dollars" }],
  ["GBP", { word: "pounds", name: "pounds sterling" }],
  ["EUR", { word: "euros", name: "euros" }],
]);

/**
 * The refusal for `<amount> in <year> <currency>` when the amount is in another
 * currency an index is bundled for, or null when the two agree.
 *
 * The phrase names the currency it answers in, so `£100 in 1990 dollars` asks
 * for dollars of a pound amount, which is a conversion and an adjustment at
 * once, and neither is what the line says. The refusal points at the form that
 * reads the amount's own index. A dollar phrase keeps its code,
 * `INFLATION_EXPECTED_USD`; the pound and euro phrases answer
 * `INFLATION_EXPECTED_CURRENCY`.
 *
 * @param asked - The ISO code the phrase names (`USD`, `GBP` or `EUR`).
 * @param amountCurrency - The ISO code of the amount's own index.
 * @param indexName - That index in the reader's words.
 * @param year - The year the phrase names.
 * @returns The error Value, or null.
 */
export function inYearCurrencyRefused(asked: string, amountCurrency: string, indexName: string, year: number): Value | null {
  if (asked === amountCurrency) return null;
  const named = IN_YEAR_CURRENCY_NAMES.get(asked) ?? { word: asked, name: asked };
  return errorValue(
    asked === "USD" ? "INFLATION_EXPECTED_USD" : "INFLATION_EXPECTED_CURRENCY",
    `in ${year} ${named.word} asks for ${named.name}, and this amount is in ${amountCurrency}: ask what it was worth in ${year} instead, which reads ${indexName}`,
  );
}

/**
 * "$X in YEAR dollars", "£X in YEAR pounds", "€X in YEAR euros" -> the same
 * question as `what was $X worth in YEAR`, asked in the currency the phrase
 * names (the third argument, its ISO code). An amount in another currency is
 * refused with the form that reads its own index (see
 * {@link inYearCurrencyRefused}).
 */
export function inflationToYearInCurrencyHandler(args: Value[], context?: LineExecutionContext): Value {
  const amount = args[0];
  const chosen = inflationIndexFor(amount);
  if (!isPriceIndex(chosen)) return chosen;
  const year = inflationYear(args[1]);
  if (!isYear(year)) return year;
  const refused = inYearCurrencyRefused(String(args[2]?.value ?? "USD"), chosen.currency, chosen.name, year);
  if (refused) return refused;
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
