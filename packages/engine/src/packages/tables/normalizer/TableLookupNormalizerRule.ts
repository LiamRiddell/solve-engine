import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/** The trigger token a table lookup starts with. */
export const TABLE_LOOKUP_TOKEN = "TABLE_LOOKUP";
const TABLE_LOOKUP_TYPE_ID = tokenTypeId(TABLE_LOOKUP_TOKEN);

/**
 * Fuses `column` into the `TABLE_LOOKUP` trigger, but only when a quoted column
 * name follows it: `column "cost" for "food"`.
 *
 * `column` is an ordinary word and a plausible variable name, so it is never a
 * bare keyword (this codebase's phrase-fusion rule, see `MathPhrasesPackage.ts`).
 * The quoted name is what makes the reading safe: a variable followed by a
 * string is not otherwise an expression, so nothing that parsed before stops
 * parsing. Only the word is replaced, and the string stays for the parselet to
 * read, the way the `sum(` fusion keeps its parenthesis.
 *
 * `sum of column "cost"` and its siblings never reach this rule: the phrase trie
 * runs first at each position and has already taken `sum of column` whole. A
 * `column` straight after a variable-definition colon (`:column = 5`) is left
 * alone, the same colon guard the line-reference rule keeps.
 */
export function tableLookupNormalizerRule(): NormalizerRule {
  return {
    name: "tables:lookup",
    priority: 80,
    shape: [{ types: ["IDENT"], values: ["column"] }, { types: ["STRING"] }],
    match(tokens: Token[], pos: number): NormalizerMatch | null {
      const token = tokens[pos];
      if (!token || token.type !== "IDENT" || token.value.toLowerCase() !== "column") return null;
      if (tokens[pos + 1]?.type !== "STRING") return null;
      if (pos > 0 && tokens[pos - 1].type === "COLON") return null;
      return {
        consumed: 1,
        replacement: [
          new LexerToken(TABLE_LOOKUP_TOKEN, TABLE_LOOKUP_TYPE_ID, token.value, token.value, token.offset, 0, token.line, token.col),
        ],
        ruleName: "tables:lookup",
      };
    },
  };
}
