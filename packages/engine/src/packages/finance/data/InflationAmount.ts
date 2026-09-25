/**
 * Which amounts the bundled price index can adjust (#650). Kept apart from the
 * phrase handlers so the `inflationAdjust` builtin can ask the same question
 * without importing them.
 */

import { Value, ValueType, errorValue } from "@solve-js/vm/Value";
import { describeQuantity } from "@solve-js/vm/VMConversion";

/**
 * The refusal for an amount the bundled price index cannot adjust, or null when
 * it is an amount in US dollars (#650).
 *
 * The table is the US consumer price index (CPI-U), so it says what a dollar
 * bought in each year and nothing about any other currency. Every form applied
 * it to whatever it was given and kept the unit: `what is £100 from 1990` was
 * £254.55, the American figure with a pound sign, and `what is 100 kg from 1990`
 * was 254.55 kg. A currency other than the dollar is refused with a sentence
 * naming the index, the way the payroll forms refuse dollars against HMRC's
 * bands; so is a quantity that is not money, and so is a bare number, which
 * would assume dollars without saying so (payroll refuses a bare salary for the
 * same reason). A fault is handed back as it is.
 *
 * @param amount - The amount to adjust.
 * @returns The `INFLATION_EXPECTED_USD` error Value, the fault, or null.
 */
export function inflationAmountRefused(amount: Value): Value | null {
  if (amount.type === ValueType.Error || amount.type === ValueType.Pending) return amount;
  if (amount.type === ValueType.Uom && amount.unit === "USD") return null;
  const index = "this is the US consumer price index";
  if (amount.type !== ValueType.Uom || amount.unit === undefined) {
    return errorValue("INFLATION_EXPECTED_USD", `${index}, so it adjusts an amount in US dollars: write the amount with its currency, as $100 or 100 USD`);
  }
  const what = describeQuantity(amount.unit);
  if (what === "money") {
    return errorValue("INFLATION_EXPECTED_USD", `${index}, which says nothing about what ${amount.unit} bought: only an amount in US dollars, such as $100, can be adjusted with it`);
  }
  return errorValue("INFLATION_EXPECTED_USD", `${index}, which adjusts money, and ${amount.unit} is ${what}: give an amount in US dollars, such as $100`);
}
