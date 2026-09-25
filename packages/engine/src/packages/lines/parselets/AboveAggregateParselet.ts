import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";

/**
 * `total above` / `sum above` / `average above` -- aggregate every line's
 * result from the immediately-preceding line backward, stopping at (not
 * including) the nearest blank line or `#` heading (Numbr's "sum to
 * nearest header", NumPad-adjacent, and SoulverCore's own
 * totals-and-subtotals feature, all the SAME underlying capability).
 *
 * Phrase-fused via `LinesPackage.ts`'s `phrases` field ("total above" /
 * "sum above" / "average above") -- a deliberate departure from Numi/
 * Numbr's bare "total"/"sum" wording, to avoid the exact bare-keyword
 * collision this codebase already regressed on once (see
 * `MathPhrasesPackage.ts`'s "total" note). "total above"/"sum above"
 * share one token type/parselet instance (synonyms, matching NumPad's/
 * Numbr's own treatment of sum and total).
 */
export class AboveAggregateParselet implements PrefixParselet {
  readonly category = "Lines";
  /**
   * @param mode - What the aggregate does with the block: `total`, `average`,
   * `count`, `min`, `max` or `median`. It names the plugin function,
   * `<mode>Above`.
   */
  constructor(private readonly mode: "total" | "average" | "count" | "min" | "max" | "median") {}

  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    builder.emitPluginCall(`${this.mode}Above`, 0);
  }
}
