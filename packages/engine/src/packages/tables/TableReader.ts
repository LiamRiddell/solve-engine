/**
 * Pure markdown-table reading, no engine or Value types involved.
 *
 * A markdown table is the one block the evaluator sees and skips, so its
 * numbers cannot be totalled from where they already sit. These helpers turn
 * the raw source lines of a leading-pipe table back into a header row and its
 * data rows, so a named column can be read as a list of numbers. Everything
 * here works on plain strings and is exercised directly in
 * `__tests__/packages/tables/TableReader.spec.ts`, separately from the
 * document plumbing that feeds it.
 *
 * Scope, stated where it is enforced rather than only in the docs:
 * - Only tables whose rows begin with `|` are recognised. The borderless
 *   GitHub form (`item | cost` with no leading pipe) is deferred, since a
 *   bare `a | b` line is ambiguous with a bitwise-or expression and needs
 *   cross-line context to tell the two apart.
 * - A cell is numeric only when it is a plain number (optionally signed, with
 *   `,` thousands separators). A cell carrying a currency symbol or a unit is
 *   read as non-numeric and skipped, reading those is the more useful version
 *   and is deliberately left for a later slice.
 */

/** One markdown table found above a query line: its header cells and data rows. */
export interface MarkdownTable {
  /** Header cell texts, trimmed, in column order. */
  header: string[];
  /** Each data row, already split into trimmed cell texts. */
  rows: string[][];
}

/** Whether a line, once trimmed, begins a markdown table row (a leading `|`). */
export function isTableRow(line: string): boolean {
  return line.trimStart().startsWith("|");
}

/**
 * Whether a line is a table delimiter row, e.g. `|---|:--:|`.
 *
 * A delimiter is built only from pipes, dashes, colons and whitespace, and
 * carries at least one dash and one pipe. The dash requirement keeps a data
 * row of all-empty cells (`|  |  |`) from being read as the delimiter.
 */
export function isSeparatorRow(line: string): boolean {
  const s = line.trim();
  if (s.length === 0) return false;
  if (!s.includes("-") || !s.includes("|")) return false;
  return /^[|\s:-]+$/.test(s);
}

/**
 * Split one markdown table row into trimmed cell texts.
 *
 * The optional outer pipes are stripped first, so `| rent | 1200 |` and
 * `rent | 1200` both yield two cells. A `\|` escapes a pipe inside a cell
 * rather than ending it.
 */
export function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && s[i + 1] === "|") {
      // An escaped pipe is a literal pipe in the cell, not a separator.
      cell += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Parse a single cell as a plain number, or return `null` when it is not one.
 *
 * Thousands separators (`,`) are removed first, so `4,812` reads as 4812. A
 * cell that carries a currency symbol, a unit, or any other text is not a
 * plain number and returns `null`, the caller skips it rather than guessing.
 */
export function parseNumericCell(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const trimmed = cell.trim();
  if (trimmed.length === 0) return null;
  const cleaned = trimmed.replace(/,/g, "");
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Find the nearest markdown table whose last row sits above `fromLine`.
 *
 * Walks upward from `fromLine - 1`, takes the first table row it meets as the
 * table's bottom, then extends up through the contiguous run of table rows to
 * the top. A valid table has a delimiter row with a header row directly above
 * it, the rows below the delimiter are the data. Returns `null` when no table
 * row is found above, or when the block has no delimiter or no header (both of
 * which mean there is nothing to name a column against).
 *
 * @param getLineText - Reads a line's raw text by 1-based number.
 * @param fromLine - The 1-based line the query sits on, exclusive upper bound.
 */
export function findTableAbove(
  getLineText: (lineNumber: number) => string | undefined,
  fromLine: number,
): MarkdownTable | null {
  // Nearest table row above the query, scanning past any intervening prose.
  let bottom = -1;
  for (let n = fromLine - 1; n >= 1; n--) {
    const text = getLineText(n);
    if (text === undefined) break;
    if (isTableRow(text)) {
      bottom = n;
      break;
    }
  }
  if (bottom === -1) return null;

  // The contiguous block of table rows ending at `bottom`.
  let top = bottom;
  while (top - 1 >= 1) {
    const text = getLineText(top - 1);
    if (text === undefined || !isTableRow(text)) break;
    top--;
  }

  // Locate the delimiter row within the block.
  let separator = -1;
  for (let n = top; n <= bottom; n++) {
    if (isSeparatorRow(getLineText(n)!)) {
      separator = n;
      break;
    }
  }
  // No delimiter, or no header row above it: not a table we can read columns from.
  if (separator === -1 || separator === top) return null;

  const header = splitTableRow(getLineText(separator - 1)!);
  const rows: string[][] = [];
  for (let n = separator + 1; n <= bottom; n++) {
    rows.push(splitTableRow(getLineText(n)!));
  }
  return { header, rows };
}

/**
 * Zero-based index of the column named `name` in a header, or `-1` if absent.
 *
 * Matching is case-insensitive and trims surrounding whitespace, so `"Cost"`
 * finds a `cost` header. The first matching column wins.
 */
export function columnIndex(header: string[], name: string): number {
  const target = name.trim().toLowerCase();
  for (let i = 0; i < header.length; i++) {
    if (header[i].trim().toLowerCase() === target) return i;
  }
  return -1;
}

/**
 * The numeric cells of one column, in row order, skipping non-numeric ones.
 *
 * A row too short to reach the column contributes nothing, as does a cell that
 * is not a plain number (see {@link parseNumericCell}).
 */
export function numericColumn(table: MarkdownTable, colIndex: number): number[] {
  const out: number[] = [];
  for (const row of table.rows) {
    const value = parseNumericCell(row[colIndex]);
    if (value !== null) out.push(value);
  }
  return out;
}
