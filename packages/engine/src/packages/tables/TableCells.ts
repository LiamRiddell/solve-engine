/**
 * Reading one table cell as a value: a plain number, an amount of money, or a
 * percentage.
 *
 * The column aggregates read plain numbers only (see `TableReader.ts`), which is
 * enough to total a column. A lookup answers with one cell, and the tables a
 * person looks things up in are price lists and rate schedules, whose cells say
 * `£12,570` and `20%`. So a lookup reads those too, and reads them exactly: the
 * digits go straight into a decimal, never through a double, which is what lets
 * a looked-up price or a banded tax stay exact to the penny.
 *
 * Pure: strings in, a tagged reading out, no engine Value involved, so the edge
 * of what counts as each kind is tested directly.
 *
 * What is read, and what deliberately is not:
 * - A number with optional sign, decimals, and `,` thousands grouping written
 *   properly (`1,200`, `12,570.50`). Grouping in the wrong places (`12,57`) is
 *   not a number, since a misplaced comma is more likely a typo or a decimal
 *   comma than a thousands separator, and a lookup must not guess.
 * - Money as a currency symbol before the number (`$5`, `£12,570`, `-$5`) or an
 *   ISO code after it (`1,200 GBP`), the two spellings the engine itself reads.
 * - A percentage (`20%`, `12.5 %`), read as its proportion (`0.2`).
 * - Anything else is text, and an empty cell is empty. Quantities with a unit
 *   (`12 kg`) are text here: a unit in a cell is not read yet.
 */

import { decimalFromLiteral, decimalToNumber, makeDecimal, type DecimalData } from "@solve-js/decimal";
import { CURRENCY_SYMBOL_ALIASES } from "@solve-js/uom/CurrencyAliases";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";

/** What one table cell reads as. */
export type CellReading =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly text: string }
  /** A plain number, with its exact decimal. */
  | { readonly kind: "number"; readonly value: number; readonly exact: DecimalData }
  /** An amount of money: the ISO code, the magnitude, and its exact decimal. */
  | { readonly kind: "money"; readonly value: number; readonly exact: DecimalData; readonly currency: string }
  /** A percentage, held as its proportion (`20%` is `0.2`), with its exact decimal. */
  | { readonly kind: "percent"; readonly value: number; readonly exact: DecimalData };

/** An unsigned number: properly grouped thousands, or plain digits, with optional decimals. */
const UNSIGNED = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`;

const PLAIN_RE = new RegExp(String.raw`^([+-]?)(${UNSIGNED})$`);
const PERCENT_RE = new RegExp(String.raw`^([+-]?)(${UNSIGNED})\s*%$`);
const CODE_SUFFIX_RE = new RegExp(String.raw`^([+-]?)(${UNSIGNED})\s*([A-Z]{3,4})$`);

/** Escape one character for use inside a regular expression character class. */
function escapeForClass(ch: string): string {
  return /[\\\]^-]/.test(ch) ? `\\${ch}` : ch;
}

/** The currency symbols the engine reads, as one character class. */
const SYMBOL_CLASS = `[${Object.keys(CURRENCY_SYMBOL_ALIASES).map(escapeForClass).join("")}]`;
const SYMBOL_PREFIX_RE = new RegExp(String.raw`^([+-]?)\s*(${SYMBOL_CLASS})\s*([+-]?)(${UNSIGNED})$`, "u");

/** The exact decimal of a matched sign and unsigned number, grouping stripped. */
function exactOf(sign: string, unsigned: string): DecimalData {
  const digits = unsigned.replace(/,/g, "");
  return decimalFromLiteral(sign === "-" ? `-${digits}` : digits);
}

/**
 * Read one cell's text.
 *
 * @param cell - The trimmed or untrimmed cell text; `undefined` (a row too short
 * to reach the column) reads as empty.
 * @returns The tagged reading.
 */
export function readCell(cell: string | undefined): CellReading {
  const text = (cell ?? "").trim();
  if (text.length === 0) return { kind: "empty" };

  const plain = PLAIN_RE.exec(text);
  if (plain) {
    const exact = exactOf(plain[1], plain[2]);
    return { kind: "number", value: decimalToNumber(exact), exact };
  }

  const percent = PERCENT_RE.exec(text);
  if (percent) {
    const whole = exactOf(percent[1], percent[2]);
    // Dividing by a hundred is moving the decimal point two places, so the
    // proportion is exact: 12.5% is 0.125, not the nearest double to it.
    const exact = makeDecimal(whole.coef, whole.scale + 2);
    return { kind: "percent", value: decimalToNumber(exact), exact };
  }

  const symbol = SYMBOL_PREFIX_RE.exec(text);
  if (symbol) {
    // A sign may sit either side of the symbol (`-$5` or `$-5`), not both.
    if (symbol[1] !== "" && symbol[3] !== "") return { kind: "text", text };
    const currency = CURRENCY_SYMBOL_ALIASES[symbol[2]];
    const exact = exactOf(symbol[1] || symbol[3], symbol[4]);
    return { kind: "money", value: decimalToNumber(exact), exact, currency };
  }

  const coded = CODE_SUFFIX_RE.exec(text);
  if (coded && sharedCurrencyExchange.isCurrency(coded[3])) {
    const exact = exactOf(coded[1], coded[2]);
    return { kind: "money", value: decimalToNumber(exact), exact, currency: coded[3] };
  }

  return { kind: "text", text };
}
