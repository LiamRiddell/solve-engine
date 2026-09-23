import {
  Value,
  ValueType,
  numberValue,
  numberValueExact,
  uomValue,
  uomValueExact,
  percentageValue,
  errorValue,
  faultedOperand,
} from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import {
  decimalAdd,
  decimalCompare,
  decimalFromInteger,
  decimalFromNumberIfExact,
  decimalIsZero,
  decimalMultiply,
  decimalSubtract,
  decimalToNumber,
  type DecimalData,
} from "@solve-js/decimal";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { CURRENCY_DISPLAY } from "@solve-js/uom/CurrencyAliases";
import { moneyExactMagnitude } from "@solve-js/vm/MoneyExact";
import { findTableAbove, type MarkdownTable } from "./TableReader";
import { readCell, type CellReading } from "./TableCells";
import { TablesErrorCodes } from "./TablesPluginFunctions";

/**
 * Runtime handlers for the table lookups and banded rates (issue #507):
 *
 * - `column "cost" for "food"`: the cell in the named column, on the row whose
 *   label (its first cell) is the one given. An exact match.
 * - `column "rate" for 45,000 in bands above`: the same cell, on the row of the
 *   band the amount falls in, reading the first column as where each band
 *   starts. An approximate match, the one a spreadsheet's VLOOKUP makes when
 *   told the column is sorted.
 * - `45,000 through bands above`: the progressive total, each part of the amount
 *   charged at the rate of the band it falls in, reading the last column as the
 *   rate. This is how an income tax, a commission scheme or a tiered tariff is
 *   worked out, and the user writes the bands, so the engine assumes none.
 *
 * Like the column aggregates beside them, every handler resolves at execution
 * time from the {@link LineExecutionContext}: the nearest table above is read
 * back from source text, since the evaluator skips a table's rows.
 *
 * The error discipline is the package's: a lookup that finds nothing, finds two
 * rows it cannot choose between, or reads a band table that does not say what a
 * band is, answers with a coded error Value naming the line to fix. Never a
 * zero, never a guess, never a throw. The two readings a person could mean by a
 * table are kept apart by the words they write: `in bands` is the only thing
 * that turns an exact lookup into a band lookup.
 *
 * Money stays exact. A cell is read into a decimal (see `TableCells.ts`), the
 * amount's exact decimal is recovered the way the percentage and tax operators
 * recover it (`vm/MoneyExact.ts`), and a progressive total is summed in base ten,
 * so a banded tax on a pound salary lands on the penny.
 */

/** Rows named in full in a not-found message before the rest are counted. */
const MAX_LABELS_LISTED = 12;

/**
 * A first-column header that names where a band ENDS rather than where it
 * starts. A band table is read by where each band starts, so a table headed
 * `up to` would be misread one row out, silently; it is refused instead.
 */
const UPPER_BOUND_HEADER = /^(up\s*to|to|until|till|under|below|max|maximum|upper|ceiling|less\s+than)\b/i;

// ── Shared reading ──────────────────────────────────────────────────────────

/** A coded error Value whose message reads as a sentence, full stop included. */
function refuse(code: string, message: string): Value {
  return errorValue(code, message.endsWith(".") ? message : `${message}.`);
}

/** The column name a parselet pushed as the first argument. */
function columnNameOf(args: Value[]): string {
  const value = args[0];
  if (value && value.type === ValueType.String && typeof value.value === "string") return value.value;
  // The parselet always pushes a string, so this is defensive only.
  return String(value?.value ?? "");
}

/** The nearest table above the query line, or the coded error saying why there is none. */
function tableAbove(context: LineExecutionContext | undefined): MarkdownTable | Value {
  const getLineText = context?.getLineText;
  if (!getLineText || context!.lineIndex < 1) {
    return refuse(
      TablesErrorCodes.TABLE_NO_DOCUMENT,
      "A table lookup needs a document to read the table from, which the single-expression path (evaluateLine) does not have",
    );
  }
  const table = findTableAbove(getLineText, context!.lineIndex);
  if (!table) {
    return refuse(
      TablesErrorCodes.TABLE_NOT_FOUND,
      'No markdown table found above this line (a table row starts with "|", and needs a "|---|" separator under its header)',
    );
  }
  return table;
}

/** Zero-based index of the one column named `name`, or the coded error when there is none or more than one. */
function lookupColumn(table: MarkdownTable, name: string): number | Value {
  const target = name.trim().toLowerCase();
  const matches: number[] = [];
  table.header.forEach((h, i) => {
    if (h.trim().toLowerCase() === target) matches.push(i);
  });
  if (matches.length === 0) {
    const names = table.header.map((h) => `"${h}"`).join(", ");
    return refuse(
      TablesErrorCodes.TABLE_COLUMN_NOT_FOUND,
      `The table above has no column named "${name}". Its columns are: ${names}`,
    );
  }
  if (matches.length > 1) {
    return refuse(
      TablesErrorCodes.TABLE_COLUMN_AMBIGUOUS,
      `The table above has ${matches.length} columns named "${name}", so the lookup cannot tell which one is meant: rename one of them`,
    );
  }
  return matches[0];
}

/** A list of line numbers as prose: `4`, `4 and 6`, `4, 6 and 9`. */
function lineList(lines: number[]): string {
  if (lines.length === 1) return `line ${lines[0]}`;
  return `lines ${lines.slice(0, -1).join(", ")} and ${lines[lines.length - 1]}`;
}

/**
 * The Value a looked-up cell answers with, or the coded error when the cell holds
 * nothing a calculation can use.
 *
 * Text is refused rather than handed on. A text Value in arithmetic reads as
 * nothing (`"n/a" * 2` is 0), so answering a lookup with the text of a label
 * would let the next operator turn it into a wrong number without a word.
 */
function cellValue(cell: string | undefined, line: number, columnName: string): Value {
  const reading = readCell(cell);
  switch (reading.kind) {
    case "empty":
      return refuse(
        TablesErrorCodes.TABLE_CELL_EMPTY,
        `The "${columnName}" cell on line ${line} is empty, so there is nothing to look up`,
      );
    case "text":
      return refuse(
        TablesErrorCodes.TABLE_CELL_NOT_A_VALUE,
        `The "${columnName}" cell on line ${line} reads "${reading.text}", which is not a number, an amount of money or a percentage`,
      );
    case "number":
      // A whole number reads as the plain number a typed literal would be; a
      // decimal keeps its exact digits, as a typed `12.50` does.
      return reading.exact.scale === 0 ? numberValue(reading.value) : numberValueExact(reading.value, reading.exact);
    case "money":
      return uomValueExact(reading.value, reading.currency, reading.exact);
    case "percent":
      return percentageValue(reading.value);
  }
}

/** A number as a message shows it: grouped, with no trailing zeros. */
function plainNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

/** An amount as a message shows it: `$45,000`, `45,000` or `1,200 CHF`. */
function describeAmount(n: number, currency: string | undefined): string {
  if (currency === undefined) return plainNumber(n);
  const display = CURRENCY_DISPLAY[currency];
  if (display && display.position === "prefix" && !display.spaced) {
    return `${n < 0 ? "-" : ""}${display.symbol}${plainNumber(Math.abs(n))}`;
  }
  return `${plainNumber(n)} ${currency}`;
}

// ── Exact lookup: column "cost" for "food" ─────────────────────────────────

/** The row key an exact lookup matches against first cells. */
type RowKey = { readonly text: string } | { readonly number: number };

/** Read the lookup key, or the coded error for a value that cannot label a row. */
function rowKeyOf(key: Value | undefined): RowKey | Value {
  if (key?.type === ValueType.String && typeof key.value === "string") return { text: key.value };
  if (key?.type === ValueType.Number) return { number: key.toNumber() };
  return refuse(
    TablesErrorCodes.TABLE_LOOKUP_KEY_INVALID,
    'A row is looked up by its label, written in quotes ("food") or as a plain number. To find the band an amount falls in, write "in bands above" after it',
  );
}

/** Whether a first cell carries the key: the same text ignoring case, or the same plain number. */
function labelMatches(label: string | undefined, key: RowKey): boolean {
  if ("text" in key) return (label ?? "").trim().toLowerCase() === key.text.trim().toLowerCase();
  const reading = readCell(label);
  return reading.kind === "number" && reading.value === key.number;
}

/** How a key reads in a message. */
function describeKey(key: RowKey): string {
  return "text" in key ? `"${key.text}"` : plainNumber(key.number);
}

/**
 * `column "cost" for "food" [in table above]`: the named column's cell, on the
 * row whose label is the key.
 *
 * @param args - The column name (a String) and the key (a String or a Number).
 * @param context - Per-line execution context, the source of the current line
 * and the raw text of the lines above. Missing outside a document, in which
 * case a coded TABLE_NO_DOCUMENT error is returned.
 * @returns The cell as a number, an amount of money or a percentage, or a coded
 * error Value: no such row, more than one, no such column, or a cell that holds
 * nothing to calculate with.
 */
export function tableRowLookupHandler(args: Value[], context?: LineExecutionContext): Value {
  const keyArg = args[1];
  const fault = keyArg ? faultedOperand(keyArg) : null;
  if (fault) return fault;

  const table = tableAbove(context);
  if (table instanceof Value) return table;
  const columnName = columnNameOf(args);
  const column = lookupColumn(table, columnName);
  if (column instanceof Value) return column;
  const key = rowKeyOf(keyArg);
  if (key instanceof Value) return key;

  const matches: number[] = [];
  table.rows.forEach((row, i) => {
    if (labelMatches(row[0], key)) matches.push(i);
  });

  if (matches.length === 0) {
    const labels = table.rows.slice(0, MAX_LABELS_LISTED).map((row) => `"${row[0] ?? ""}"`);
    const more = table.rows.length > MAX_LABELS_LISTED ? `, and ${table.rows.length - MAX_LABELS_LISTED} more` : "";
    const rows = table.rows.length === 0 ? "It has no rows" : `Its rows are: ${labels.join(", ")}${more}`;
    // A number that matches no label is most often an amount meant for a band
    // table, so the refusal names the form that places it.
    const hint = "number" in key ? '. To find the band a number falls in, write "in bands above" after it' : "";
    return refuse(
      TablesErrorCodes.TABLE_ROW_NOT_FOUND,
      `The table above has no row labelled ${describeKey(key)} in its first column. ${rows}${hint}`,
    );
  }
  if (matches.length > 1) {
    return refuse(
      TablesErrorCodes.TABLE_ROW_AMBIGUOUS,
      `The table above has ${matches.length} rows labelled ${describeKey(key)} (${lineList(matches.map((i) => table.rowLines[i]))}), so the lookup cannot tell which one is meant`,
    );
  }

  const index = matches[0];
  return cellValue(table.rows[index][column], table.rowLines[index], table.header[column]);
}

// ── Bands ───────────────────────────────────────────────────────────────────

/** The amount placed in the bands: its magnitude, its exact decimal when it has one, and its currency. */
interface Amount {
  readonly value: number;
  readonly exact: DecimalData | null;
  readonly currency: string | undefined;
}

/** Where one band starts, as read from the first column. */
interface BandStart {
  readonly value: number;
  readonly exact: DecimalData;
  readonly text: string;
}

/** A table read as bands: where each starts, in rising order, and the currency they are written in. */
interface BandSchedule {
  readonly starts: BandStart[];
  readonly currency: string | undefined;
}

/** The coded error for a band table that does not say what a band is. */
function malformed(message: string): Value {
  return refuse(TablesErrorCodes.TABLE_BANDS_MALFORMED, message);
}

/** Read the amount to place in the bands, or the coded error for one that cannot be. */
function amountOf(value: Value): Amount | Value {
  if (value.type === ValueType.Number) {
    const n = value.toNumber();
    if (Number.isFinite(n)) return { value: n, exact: value.exact ?? decimalFromNumberIfExact(n), currency: undefined };
  } else if (value.type === ValueType.Uom && value.unit !== undefined) {
    const n = value.toNumber();
    if (sharedCurrencyExchange.isCurrency(value.unit) && Number.isFinite(n)) {
      return { value: n, exact: moneyExactMagnitude(value, value.unit), currency: value.unit };
    }
    if (!sharedCurrencyExchange.isCurrency(value.unit)) {
      return refuse(
        TablesErrorCodes.TABLE_BAND_AMOUNT_INVALID,
        `Bands place a plain number or an amount of money, and this amount is in ${value.unit}, a unit the table does not state. Write the number alone`,
      );
    }
  }
  return refuse(
    TablesErrorCodes.TABLE_BAND_AMOUNT_INVALID,
    "Bands need a plain number or an amount of money to place in them",
  );
}

/**
 * Read the table as bands: the first column is where each band starts, and the
 * starts must rise down the table. Returns the coded error naming the line to
 * fix when they do not.
 */
function bandsOf(table: MarkdownTable): BandSchedule | Value {
  if (table.rows.length === 0) return malformed("The table above has no rows to read as bands");

  const header = table.header[0] ?? "";
  if (UPPER_BOUND_HEADER.test(header.trim())) {
    return malformed(
      `The first column is headed "${header}", which reads as where each band ends. Bands are read by where each one starts: head the column "from" and write each band's starting point, the first being 0`,
    );
  }

  const starts: BandStart[] = [];
  let currency: string | undefined;
  for (let i = 0; i < table.rows.length; i++) {
    const line = table.rowLines[i];
    const text = (table.rows[i][0] ?? "").trim();
    const reading = readCell(text);
    if (reading.kind !== "number" && reading.kind !== "money") {
      return malformed(
        reading.kind === "empty"
          ? `Line ${line} has no starting point in its first column, which is where each band starts`
          : `Line ${line}: the first column holds where each band starts, and "${text}" is not a number or an amount of money`,
      );
    }
    if (reading.kind === "money") {
      if (currency !== undefined && currency !== reading.currency) {
        return malformed(`The band starts mix ${currency} and ${reading.currency} (line ${line}), so they cannot be compared`);
      }
      currency = reading.currency;
    }
    const previous = starts[starts.length - 1];
    if (previous && decimalCompare(reading.exact, previous.exact) <= 0) {
      return malformed(
        `Line ${line}: bands must start in rising order down the table, and ${text} does not come after ${previous.text}`,
      );
    }
    starts.push({ value: reading.value, exact: reading.exact, text });
  }
  return { starts, currency };
}

/**
 * The currency the amount and the band starts share, or the coded error when
 * they name two. A plain number on either side takes the other's currency, the
 * way `45000 + £5` is pounds: the table says what the money is.
 */
function sharedCurrency(amount: Amount, schedule: BandSchedule): string | undefined | Value {
  if (amount.currency !== undefined && schedule.currency !== undefined && amount.currency !== schedule.currency) {
    return refuse(
      TablesErrorCodes.TABLE_BAND_UNIT_MISMATCH,
      `The amount is in ${amount.currency} and the bands are in ${schedule.currency}. Convert one of them first`,
    );
  }
  return amount.currency ?? schedule.currency;
}

/** Compare the amount with a band start, exactly when the amount has an exact value. */
function compareToStart(amount: Amount, start: BandStart): number {
  if (amount.exact !== null) return decimalCompare(amount.exact, start.exact);
  return amount.value < start.value ? -1 : amount.value > start.value ? 1 : 0;
}

/**
 * `column "rate" for 45,000 in bands above`: the named column's cell, on the row
 * of the band the amount falls in.
 *
 * A band runs from where its row says it starts up to where the next row's band
 * starts, so an amount exactly on a start belongs to the band that starts there.
 *
 * @param args - The column name (a String) and the amount (a Number or money).
 * @param context - Per-line execution context (see {@link tableRowLookupHandler}).
 * @returns The cell, or a coded error Value: the amount falls below the first
 * band, the table is not a band table, or the cell holds nothing to calculate with.
 */
export function tableBandLookupHandler(args: Value[], context?: LineExecutionContext): Value {
  const amountArg = args[1];
  const fault = amountArg ? faultedOperand(amountArg) : null;
  if (fault) return fault;

  const table = tableAbove(context);
  if (table instanceof Value) return table;
  const columnName = columnNameOf(args);
  const column = lookupColumn(table, columnName);
  if (column instanceof Value) return column;
  // The parselet always pushes an amount, so the fallback is defensive only.
  const amount = amountOf(amountArg ?? numberValue(Number.NaN));
  if (amount instanceof Value) return amount;
  const schedule = bandsOf(table);
  if (schedule instanceof Value) return schedule;
  const currency = sharedCurrency(amount, schedule);
  if (currency instanceof Value) return currency;

  let index = -1;
  for (let i = 0; i < schedule.starts.length; i++) {
    if (compareToStart(amount, schedule.starts[i]) >= 0) index = i;
    else break;
  }
  if (index === -1) {
    return refuse(
      TablesErrorCodes.TABLE_BAND_BELOW_FIRST,
      `${describeAmount(amount.value, currency)} falls below the first band, which starts at ${schedule.starts[0].text}`,
    );
  }
  return cellValue(table.rows[index][column], table.rowLines[index], table.header[column]);
}

/** What the rate column charges: a share of the amount, or a price per unit of it. */
interface RateColumn {
  readonly kind: "share" | "price";
  /** The currency of the prices, for `price`. */
  readonly currency: string | undefined;
  readonly rates: ReadonlyArray<{ readonly value: number; readonly exact: DecimalData }>;
}

/**
 * Read the last column as each band's rate, or the coded error naming the line
 * whose rate cannot be read, or read one way.
 *
 * A percentage, a plain number, or a price are each clear alone. Mixed, only a
 * plain 0 sits safely among the others, since a zero rate is zero whichever way
 * it is read; a plain `20` among percentages is refused rather than charged at
 * twenty times the amount, because the missing `%` is the likelier story.
 */
function ratesOf(table: MarkdownTable): RateColumn | Value {
  const column = table.header.length - 1;
  if (column < 1) {
    return malformed("A band table needs at least two columns: where each band starts, first, and its rate, last");
  }
  const name = table.header[column];

  const readings: CellReading[] = table.rows.map((row) => readCell(row[column]));
  let hasPercent = false;
  let priceCurrency: string | undefined;
  for (let i = 0; i < readings.length; i++) {
    const reading = readings[i];
    const line = table.rowLines[i];
    if (reading.kind === "empty") {
      return malformed(`Line ${line} has no rate in its "${name}" cell (the last column is read as each band's rate)`);
    }
    if (reading.kind === "text") {
      return malformed(`Line ${line}'s rate "${reading.text}" is not a percentage, a number or a price`);
    }
    if (reading.kind === "percent") hasPercent = true;
    if (reading.kind === "money") {
      if (priceCurrency !== undefined && priceCurrency !== reading.currency) {
        return malformed(`The rates mix ${priceCurrency} and ${reading.currency} prices (line ${line})`);
      }
      priceCurrency = reading.currency;
    }
  }
  if (hasPercent && priceCurrency !== undefined) {
    return malformed(
      "The rates mix percentages and prices, so it is not clear whether a band charges a share of the amount or a price for each unit of it",
    );
  }
  if (hasPercent || priceCurrency !== undefined) {
    const others = hasPercent ? "percentages" : "prices";
    for (let i = 0; i < readings.length; i++) {
      const reading = readings[i];
      if (reading.kind === "number" && !decimalIsZero(reading.exact)) {
        const text = (table.rows[i][column] ?? "").trim();
        const fix = hasPercent ? `write ${text}% if a percentage is meant` : "write it as a price";
        return malformed(`Line ${table.rowLines[i]}'s rate ${text} is a plain number among ${others}: ${fix}`);
      }
    }
  }

  const rates = readings.map((reading) => {
    // Every reading is a number, a percentage or money by now.
    const r = reading as { value: number; exact: DecimalData };
    return { value: r.value, exact: r.exact };
  });
  return { kind: priceCurrency !== undefined ? "price" : "share", currency: priceCurrency, rates };
}

/**
 * `45,000 through bands above`: the progressive total, each part of the amount
 * charged at the rate of the band it falls in.
 *
 * The first column is where each band starts, the last is its rate, and the
 * first band must start at 0 so every part of the amount falls in one. The part
 * of the amount between a band's start and the next band's start is charged at
 * that band's rate, and the last band runs on without end. A percentage charges
 * a share of that part, a price charges per unit of it (a tiered tariff), and a
 * plain number multiplies it.
 *
 * @param args - The amount (a Number or money).
 * @param context - Per-line execution context (see {@link tableRowLookupHandler}).
 * @returns The total, in the amount's currency (or the table's, or the prices'),
 * exact where the amount is; or a coded error Value naming what to fix.
 */
export function tableThroughBandsHandler(args: Value[], context?: LineExecutionContext): Value {
  const amountArg = args[0];
  const fault = amountArg ? faultedOperand(amountArg) : null;
  if (fault) return fault;

  const table = tableAbove(context);
  if (table instanceof Value) return table;
  const amount = amountOf(amountArg ?? numberValue(Number.NaN));
  if (amount instanceof Value) return amount;
  const schedule = bandsOf(table);
  if (schedule instanceof Value) return schedule;
  if (!decimalIsZero(schedule.starts[0].exact)) {
    return refuse(
      TablesErrorCodes.TABLE_BANDS_NOT_FROM_ZERO,
      `The first band starts at ${schedule.starts[0].text}, so the part of an amount below it falls in no band. Add a band from 0, at 0% if nothing is charged there`,
    );
  }
  if (amount.value < 0) {
    return refuse(
      TablesErrorCodes.TABLE_BAND_AMOUNT_INVALID,
      `${describeAmount(amount.value, amount.currency)} is below zero, so it falls in no band`,
    );
  }
  const currency = sharedCurrency(amount, schedule);
  if (currency instanceof Value) return currency;
  const rates = ratesOf(table);
  if (rates instanceof Value) return rates;
  if (rates.kind === "price" && currency !== undefined) {
    return refuse(
      TablesErrorCodes.TABLE_BAND_UNIT_MISMATCH,
      `The rates are prices in ${rates.currency}, charged for each unit of the amount, and the amount is itself money (${currency}). A price table charges a count, such as units used; a share of money is written as a percentage`,
    );
  }
  const unit = rates.kind === "price" ? rates.currency : currency;
  const { starts } = schedule;

  if (amount.exact !== null) {
    // Base ten throughout, so a banded tax on a pound salary is exact to the penny.
    const whole = amount.exact;
    let total = decimalFromInteger(0);
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i].exact;
      if (decimalCompare(whole, start) <= 0) break;
      const next = i + 1 < starts.length ? starts[i + 1].exact : null;
      const top = next !== null && decimalCompare(whole, next) > 0 ? next : whole;
      total = decimalAdd(total, decimalMultiply(decimalSubtract(top, start), rates.rates[i].exact));
    }
    const n = decimalToNumber(total);
    return unit === undefined ? numberValue(n) : uomValueExact(n, unit, total);
  }

  // An amount with no exact value (a computed fraction) stays a double, the same
  // boundary the other money helpers draw.
  let total = 0;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].value;
    if (amount.value <= start) break;
    const next = i + 1 < starts.length ? starts[i + 1].value : Infinity;
    total += (Math.min(amount.value, next) - start) * rates.rates[i].value;
  }
  return unit === undefined ? numberValue(total) : uomValue(total, unit);
}
