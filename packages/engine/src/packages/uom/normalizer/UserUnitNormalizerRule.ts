import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { UserUnitTable } from "@solve-js/packages/uom/UserUnitTable";

/**
 * Expands a document-defined unit back to its definition so the built-in unit
 * machinery handles it: `6 sprints` becomes `6 * 2 weeks` once `1 sprint = 2
 * weeks` is in scope. The multiplication is what carries the dimension, so
 * `6 sprints in days` converts and `6 sprints in kg` reports incompatible units.
 *
 * Bound to the engine's own {@link UserUnitTable}, which is why it is wired in
 * ExpressionEngine rather than shipped in the shared UOM package descriptor: the
 * table is per-document state, and a package descriptor is shared across every
 * engine in the process. Reading the table is side-effect-free, so this stays a
 * pure normalizer rule (the registration side of the feature happens in the
 * engine's own definition-line handling, not here).
 *
 * Deliberately narrow, so a made-up unit name cannot shadow ordinary prose:
 *
 * - It fires only after a value (a NUMBER, or a closing paren), the way a unit
 *   always attaches to a quantity. A bare `sprint` on its own is left as an
 *   identifier, so a word that happens to match a definition is not rewritten
 *   mid-sentence.
 * - It declines when the name is immediately followed by `=`, which is the
 *   left side of a (re)definition, not a use.
 *
 * Runs above implicit multiply, so a matched name is expanded whole here rather
 * than first split into `value * name` with the name stranded as a variable.
 */
export function userUnitExpansionRule(table: UserUnitTable, priority = 82): NormalizerRule {
  return {
    name: "uom:user-unit",
    priority,
    match(tokens: Token[], pos: number): NormalizerMatch | null {
      // Nothing is defined on most lines, so bail before any scanning.
      if (table.isEmpty) return null;

      const value = tokens[pos];
      // A user unit attaches to a preceding value, exactly like a built-in one.
      if (value.type !== "NUMBER" && value.type !== "RPAREN") return null;

      // Gather the run of identifiers that could spell a multi-word name,
      // capped at the longest name actually registered.
      const words: string[] = [];
      const maxWords = table.maxWordCount;
      for (let i = pos + 1; i < tokens.length && words.length < maxWords; i++) {
        if (tokens[i].type !== "IDENT") break;
        words.push(tokens[i].value);
      }
      if (words.length === 0) return null;

      const matched = table.match(words);
      if (matched === null) return null;

      // `1 sprint = ...` is a definition's left side, not a use of `sprint`.
      const after = tokens[pos + 1 + matched.wordCount];
      if (after?.type === "EQUALS") return null;

      const { ratioText, baseUnit } = matched.definition;
      const star = new LexerToken("STAR", tokenTypeId("STAR"), "*", "*", value.offset, 0, value.line, value.col);
      const ratio = new LexerToken("NUMBER", tokenTypeId("NUMBER"), ratioText, ratioText, value.offset, 0, value.line, value.col);
      const unit = new LexerToken("UNIT", tokenTypeId("UNIT"), baseUnit, baseUnit, value.offset, 0, value.line, value.col);

      return {
        consumed: 1 + matched.wordCount,
        replacement: [value, star, ratio, unit],
        ruleName: "uom:user-unit",
      };
    },
  };
}
