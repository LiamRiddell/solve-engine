/**
 * Which price index adjusts an amount, chosen by its currency (#650, #756).
 * Kept apart from the phrase handlers so the `inflationAdjust` builtin can ask
 * the same question without importing them.
 */

import { Value, ValueType, errorValue } from "@solve-js/vm/Value";
import { describeQuantity } from "@solve-js/vm/VMConversion";
import { safeText } from "@solve-js/parser/ParseMessages";
import { nonFiniteText } from "@solve-js/utilities/Number";
import { type PriceIndex, priceIndexFor, indexRatio, yearOutsideIndex } from "./PriceIndices";

/** The amounts an index is bundled for, in the reader's words, for the refusals. */
const INDEXED = "US dollars, pounds sterling or euros, such as $100, £100 or €100";

/**
 * The index that adjusts an amount, or the refusal when none can (#756).
 *
 * The amount's currency picks the index: US dollars the BLS CPI-U, pounds the
 * ONS long-term indicator CDKO, euros the euro-area HICP. Before #756 the US
 * index was applied to whatever it was given, keeping the unit, so `what is
 * £100 from 1990` was £254.55, the American figure with a pound sign; #650
 * refused it, and now it reads the UK index. A currency with no bundled index
 * is refused by name, and so is a quantity that is not money. A bare number is
 * refused too: it names no currency, so no index can be chosen for it without
 * assuming one (payroll refuses a bare salary for the same reason). A fault is
 * handed back as it is.
 *
 * @param amount - The amount to adjust.
 * @returns The index, or an `INFLATION_NO_INDEX` error Value, or the fault.
 */
export function inflationIndexFor(amount: Value): PriceIndex | Value {
  if (amount.type === ValueType.Error || amount.type === ValueType.Pending) return amount;
  if (amount.type !== ValueType.Uom || amount.unit === undefined) {
    return errorValue("INFLATION_NO_INDEX", `a price index measures one currency, and this amount has none: write it with its currency, in ${INDEXED}`);
  }
  const index = priceIndexFor(amount.unit);
  if (index) return index;
  const what = describeQuantity(amount.unit);
  if (what === "money") {
    return errorValue("INFLATION_NO_INDEX", `no price index for ${amount.unit} is bundled, so there is no record of what it bought in another year: only an amount in ${INDEXED}, can be adjusted`);
  }
  return errorValue("INFLATION_NO_INDEX", `a price index adjusts money, and ${amount.unit} is ${what}: give an amount in ${INDEXED}${poundSterlingHint(amount.unit)}`);
}

/** The spellings of the pound as a weight, which a reader of money may have meant as sterling. */
const POUND_WEIGHT_SPELLINGS: ReadonlySet<string> = new Set(["pound", "pounds", "lb", "lbs"]);

/**
 * A pointer at the sterling spelling for an amount in pounds of weight, or an
 * empty string. `100 pounds` is a weight to the engine, as `5 pounds in kg`
 * needs it to be, so a reader asking about money is shown the sign that makes
 * it sterling.
 *
 * @param unit - The amount's unit.
 */
export function poundSterlingHint(unit: string): string {
  return typeof unit === "string" && POUND_WEIGHT_SPELLINGS.has(unit.toLowerCase()) ? ` (for pounds sterling, write £100 or 100 GBP)` : "";
}

/**
 * The refusal for an amount written as a count of something that is not money,
 * `what is 100 apples from 1990`: the word stands where a currency would, and
 * no index measures it.
 *
 * @param word - The word after the number, as the reader typed it.
 * @returns The sentence the reader sees.
 */
export function countedAmountRefusal(word: string): string {
  return `a price index adjusts money, and ${safeText(String(word))} is not a currency: give an amount in ${INDEXED}`;
}

/** Whether {@link inflationIndexFor} chose an index rather than refusing. */
export function isPriceIndex(chosen: PriceIndex | Value): chosen is PriceIndex {
  return typeof (chosen as PriceIndex).yearOutside === "function";
}

/**
 * The refusal for an amount no bundled index can adjust, or null when one can.
 * The shape #650 introduced, kept for callers that need only the yes or no.
 *
 * @param amount - The amount to adjust.
 */
export function inflationAmountRefused(amount: Value): Value | null {
  const chosen = inflationIndexFor(amount);
  return isPriceIndex(chosen) ? null : chosen;
}

/**
 * Adjust an amount's number from one year's money to another's by the index its
 * currency picks.
 *
 * @param amount - The amount, with its currency.
 * @param fromYear - The year the amount is in.
 * @param toYear - The year to express it in.
 * @returns `{ value }`, the adjusted number, or `{ refused }`, the error Value
 *   (no index for the amount, or a year outside the index).
 */
export function adjustByCurrency(amount: Value, fromYear: number, toYear: number): { value: number } | { refused: Value } {
  const chosen = inflationIndexFor(amount);
  if (!isPriceIndex(chosen)) return { refused: chosen };
  const ratio = indexRatio(chosen, fromYear, toYear);
  if (ratio === undefined) {
    const year = yearOutsideIndex(chosen, fromYear, toYear) ?? fromYear;
    return { refused: errorValue("INFLATION_YEAR_OUT_OF_RANGE", chosen.yearOutside(year)) };
  }
  return { value: amount.toNumber() * ratio };
}

/** What a value given as a year is, in the reader's words, for {@link inflationYear}'s refusal. */
function describeNotAYear(value: Value): string {
  switch (value.type) {
    case ValueType.Uom:
      return value.unit === undefined ? "not a plain number" : describeQuantity(value.unit);
    case ValueType.Percentage:
      return "a percentage";
    case ValueType.Datetime:
      return "a date or time (write its year on its own, such as 1990)";
    case ValueType.String:
      return "text";
    case ValueType.Boolean:
      return "true or false";
    case ValueType.Matrix:
      return "a list";
    case ValueType.Range:
      return "a range";
    default:
      return "not a plain number";
  }
}

/** The opening every {@link inflationYear} refusal shares. */
const A_YEAR_IS = "the year of an inflation question is a plain whole number, such as 1990";

/**
 * The year an inflation question names, or the refusal when the value given
 * for it is not a year.
 *
 * A year is a plain whole number. The year after `from`, `in` or `worth in`
 * used to be read for its number whatever it was, so `$1990` and `1990 kg`
 * were the year 1990 and `1990.5` was looked up as 1990, each answered with a
 * confident figure. A whole number outside the index's range is not refused
 * here: it is a year, and the index says which years it holds
 * (`INFLATION_YEAR_OUT_OF_RANGE`). A fault or a pending value is handed back
 * as it is.
 *
 * @param value - The value given as the year.
 * @returns The year, or an `INFLATION_EXPECTED_YEAR` error Value, or the fault.
 */
export function inflationYear(value: Value | undefined): number | Value {
  if (value === undefined || value === null) return errorValue("INFLATION_EXPECTED_YEAR", `an inflation question needs a year: ${A_YEAR_IS}`);
  if (value.type === ValueType.Error || value.type === ValueType.Pending) return value;
  const plain = value.type === ValueType.Number || value.type === ValueType.Hex || value.type === ValueType.BigInt
    || (value.type === ValueType.Uom && value.unit === undefined);
  if (!plain) return errorValue("INFLATION_EXPECTED_YEAR", `${A_YEAR_IS}, and this one is ${describeNotAYear(value)}`);
  const year = value.toNumber();
  // An infinity is named as the reader sees it (`∞`), and NaN, which a reader
  // never wrote, as what it is.
  if (!Number.isFinite(year)) return errorValue("INFLATION_EXPECTED_YEAR", `${A_YEAR_IS}, and this one is ${Number.isNaN(year) ? "not a number" : nonFiniteText(year)}`);
  if (!Number.isInteger(year)) return errorValue("INFLATION_EXPECTED_YEAR", `${A_YEAR_IS}, and ${String(year)} is not a whole number`);
  // `-0` is the year 0, which the index then refuses as out of range.
  return year + 0;
}

/** Whether {@link inflationYear} read a year rather than refusing. */
export function isYear(year: number | Value): year is number {
  return typeof year === "number";
}
