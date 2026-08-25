import { Value, ValueType, numberValue, uomValue, errorValue } from "@solve-js/vm/Value";
import { adjustForInflation, CPI_MIN_YEAR, CPI_MAX_YEAR } from "../data/CpiTable";

/**
 * Inflation plugin functions -- registered via IEnginePackage.pluginFunctions
 * (collision-safe allocator), not VMBuiltins.ts's shared builtinFunctions
 * registry, since none of these three need function-call (`name(args)`)
 * reachability through FunctionCallParselet -- only the general 3-arg
 * `inflationAdjust(amount, fromYear, toYear)` needs that (see VMBuiltins.ts
 * CALL_BUILTIN index 60). Matches TimezonePluginFunctions.ts's pattern.
 *
 * "Present year" is computed at VM EXECUTION time (new Date().getFullYear()
 * inside the handler), not baked in at parse time -- same reasoning as this
 * engine's DATE_NOW opcode: a parse-time constant would go stale if the
 * compiled bytecode for a line is ever re-executed on a later date.
 */

function yearRangeError(code: string, badYear: number): Value {
  return errorValue(
    code,
    `Year ${badYear} is outside the bundled CPI table's range (${CPI_MIN_YEAR}-${CPI_MAX_YEAR})`,
  );
}

/** "what is $X from YEAR" -> X (given as YEAR's dollars) expressed in present-day dollars. */
export function inflationFromYearToPresentHandler(args: Value[]): Value {
  const amountValue = args[0];
  const fromYear = args[1].toNumber();
  const toYear = new Date().getFullYear();
  const result = adjustForInflation(amountValue.toNumber(), fromYear, toYear);
  if (result === undefined) return yearRangeError("INFLATION_YEAR_OUT_OF_RANGE", fromYear);
  return amountValue.type === ValueType.Uom ? uomValue(result, amountValue.unit!) : numberValue(result);
}

/**
 * "what was $X worth in YEAR" / "$X in YEAR dollars" -> X (given as
 * present-day dollars) expressed in YEAR's dollars.
 */
export function inflationToYearFromPresentHandler(args: Value[]): Value {
  const amountValue = args[0];
  const fromYear = new Date().getFullYear();
  const toYear = args[1].toNumber();
  const result = adjustForInflation(amountValue.toNumber(), fromYear, toYear);
  if (result === undefined) return yearRangeError("INFLATION_YEAR_OUT_OF_RANGE", toYear);
  return amountValue.type === ValueType.Uom ? uomValue(result, amountValue.unit!) : numberValue(result);
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
export function inflationFutureValueHandler(args: Value[]): Value {
  const amountValue = args[0];
  const futureYear = args[1].toNumber();
  const rate = args[2].toNumber();
  const years = futureYear - new Date().getFullYear();
  if (1 + rate <= 0) {
    return errorValue("INVALID_RATE", `inflationFutureValue: rate ${rate} makes (1 + rate) non-positive`);
  }
  const amount = amountValue.toNumber();
  const worth = amount / Math.pow(1 + rate, years);
  return amountValue.type === ValueType.Uom ? uomValue(worth, amountValue.unit!) : numberValue(worth);
}
