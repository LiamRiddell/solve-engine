/**
 * The syntax-highlighting key on the landing page.
 *
 * Data rather than markup because it was wrong twice while it was markup. The
 * vector swatch showed `[1, 2]`, which the language service categorises as
 * punctuation and numbers, and the datetime swatch showed `friday`, which it
 * does not categorise at all. Both looked entirely plausible.
 *
 * `HighlightLegend.spec.ts` in the engine package now runs every line below
 * through `getSemanticTokens` and asserts the named token comes back with the
 * claimed category, so a swatch cannot describe a colour the engine would never
 * produce.
 *
 * Two of the thirteen built-in categories are deliberately absent:
 *
 *   · `datetime` is declared and mapped from four token types, but nothing the
 *     highlighter emits reaches it today. `12/09/2026` comes back as number,
 *     operator, number, because DATETIME_LITERAL is produced downstream of the
 *     highlight pass. Showing it here would promise a colour that never
 *     appears.
 *   · `error` is what an unparseable span gets, so there is no tidy fragment
 *     that demonstrates it out of context.
 */

export interface LegendEntry {
  /** A whole line, valid Solve, that the spec runs through the engine. */
  line: string;
  /** The token within that line this swatch is about. */
  token: string;
  /** The category `getSemanticTokens` returns for it. */
  category: string;
}

export const HIGHLIGHT_LEGEND: LegendEntry[] = [
  { line: "42", token: "42", category: "number" },
  { line: '"gbp"', token: '"gbp"', category: "string" },
  { line: "if 1 > 2 then 3 else 4", token: "if", category: "keyword" },
  { line: "1 + 2", token: "+", category: "operator" },
  { line: "1 >= 2", token: ">=", category: "comparison" },
  { line: "5 & 3", token: "&", category: "bitwise" },
  { line: "sqrt(9)", token: "sqrt", category: "function" },
  { line: "total = 1", token: "total", category: "variable" },
  { line: "12 km", token: "km", category: "unit" },
  { line: "vec2(1,2)", token: "vec2", category: "vector" },
  { line: "(1)", token: "(", category: "punctuation" },
];
