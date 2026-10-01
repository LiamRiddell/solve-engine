/**
 * Which price index adjusts an amount, chosen by its currency (#650, #756).
 * Kept apart from the phrase handlers so the `inflationAdjust` builtin can ask
 * the same question without importing them.
 */

import { Value, ValueType, errorValue } from "@solve-js/vm/Value";
import { describeQuantity } from "@solve-js/vm/VMConversion";
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
  return errorValue("INFLATION_NO_INDEX", `a price index adjusts money, and ${amount.unit} is ${what}: give an amount in ${INDEXED}`);
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
