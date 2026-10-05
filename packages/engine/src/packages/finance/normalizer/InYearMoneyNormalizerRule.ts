import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * The currency words `in <year> ...` names, each with the token it fuses into.
 * A map rather than an object literal, so a word that names an inherited
 * property (`constructor`) finds nothing.
 */
const IN_YEAR_CURRENCY_WORDS: ReadonlyMap<string, string> = new Map([
  ["dollars", "IN_YEAR_DOLLARS"],
  ["dollar", "IN_YEAR_DOLLARS"],
  ["pounds", "IN_YEAR_POUNDS"],
  ["pound", "IN_YEAR_POUNDS"],
  ["euros", "IN_YEAR_EUROS"],
  ["euro", "IN_YEAR_EUROS"],
]);

/**
 * The token `in <year> <word>` fuses into for a currency word, or undefined
 * when the word names no currency the phrase reads.
 *
 * @param word - The word after the year, as typed (any case).
 * @returns `IN_YEAR_DOLLARS`, `IN_YEAR_POUNDS`, `IN_YEAR_EUROS`, or undefined.
 */
export function inYearTokenTypeFor(word: string): string | undefined {
  if (typeof word !== "string") return undefined;
  return IN_YEAR_CURRENCY_WORDS.get(word.toLowerCase());
}

/**
 * Fuses `in <year> dollars`, `in <year> pounds` and `in <year> euros` into one
 * token carrying the year as its value, one token type per currency.
 *
 * Custom normalizer rule instead of IEnginePackage.phrases: the static
 * phrase trie only fuses fixed word sequences, with no slot for an
 * arbitrary NUMBER between two keyword words -- same class of problem as
 * uom/normalizer/IngredientNameNormalizerRule.ts and ClampParselet.ts.
 *
 * Also sidesteps a real collision: the currency package's InParselet is a
 * generic infix parselet on the bare IN token that unconditionally
 * consumes IN as soon as it's seen, even when the following token isn't a
 * valid conversion target (a bare NUMBER year is not) -- it silently
 * no-ops but has already eaten the IN token, stranding "YEAR dollars".
 * Fusing the whole span here, before parsing starts, removes the bare IN
 * token from the stream so InParselet never sees it.
 *
 * Only fires when a currency word immediately follows the year, so forms
 * like "what is $X in YEAR1 worth in YEAR2" and "value of $X in YEAR
 * assuming N% inflation" (which also have a bare IN NUMBER, but not
 * followed by a currency word) are left alone for InflationQueryParselet /
 * InflationFutureValueParselet to consume directly -- see their own
 * binding-power guards against the same InParselet collision.
 *
 * "dollars", "pounds" and "euros" lex as UNIT tokens ("pounds" as the mass,
 * the others as currency aliases), not IDENT, so both token types are
 * accepted. A year between `in` and the word is what makes it this phrase:
 * `5 kg in pounds` has none, and stays the conversion it is.
 */
export function inYearMoneyNormalizerRule(priority = 70): NormalizerRule {
  return {
    name: "finance:in-year-money",
    priority,
    // Derived from this rule's own opening guards; see RuleSlot on why an
    // over-broad slot is safe and an over-narrow one is not.
    shape: [{ types: ["IN"] }, { types: ["NUMBER"] }],
    match(tokens, pos): NormalizerMatch | null {
      const inToken = tokens[pos];
      const yearToken = tokens[pos + 1];
      const wordToken = tokens[pos + 2];
      if (inToken.type !== "IN") return null;
      if (yearToken?.type !== "NUMBER") return null;
      if (wordToken?.type !== "IDENT" && wordToken?.type !== "UNIT") return null;
      const tokenType = inYearTokenTypeFor(wordToken.value);
      if (tokenType === undefined) return null;

      return {
        consumed: 3,
        replacement: [createFusedToken(tokenType, yearToken.value, tokens.slice(pos, pos + 3))],
        ruleName: "finance:in-year-money",
      };
    },
  };
}
