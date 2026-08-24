import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/** The lowercased written form of a token, tolerant of `text` vs `value`. */
function wordOf(token: Token | undefined): string {
  if (token === undefined) return "";
  return (token.text ?? token.value ?? "").toLowerCase();
}

/** The fused-trigger token each math-phrase aggregate maps to for a tag. */
const AGGREGATE_TOKEN: Record<string, string> = {
  TOTAL_OF: "TAG_SUM",
  COUNT_OF: "TAG_COUNT",
  AVERAGE_OF: "TAG_AVERAGE",
};

/** The words that open an `... of #tag` aggregate, before the phrase fuses. */
const AGGREGATE_WORDS: ReadonlySet<string> = new Set(["total", "sum", "count", "average"]);

/**
 * `total of #tag` / `count of #tag` / `average of #tag` / `sum of #tag`, the
 * category tag aggregates. Fuses the trigger and the following TAG into one
 * TAG_SUM / TAG_COUNT / TAG_AVERAGE token whose value is the tag name.
 *
 * Two shapes. The math-phrase package fuses "total of"/"count of"/"average of"
 * into TOTAL_OF/COUNT_OF/AVERAGE_OF, so those reach this rule as a single
 * trigger token; "sum of" has no such phrase, so it arrives as the raw words
 * `sum` `of`. Either shape must be immediately followed by a TAG, so
 * `total of 1, 2, 3` (a number follows, not a tag) still falls through to the
 * ordinary variadic aggregate, and `:total = 5` is untouched.
 */
export function tagAggregateNormalizerRule(priority = 80): NormalizerRule {
  return {
    name: "tags:aggregate",
    priority,
    match(tokens, pos): NormalizerMatch | null {
      const head = tokens[pos];
      if (head === undefined) return null;

      // Shape A: a fused math-phrase trigger directly followed by a TAG.
      const fused = AGGREGATE_TOKEN[head.type];
      if (fused !== undefined) {
        const tag = tokens[pos + 1];
        if (tag?.type !== "TAG") return null;
        return {
          consumed: 2,
          replacement: [createFusedToken(fused, tag.value ?? "", [head, tag])],
          ruleName: "tags:aggregate",
        };
      }

      // Shape B: bare `sum of #tag` (there is no "sum of" math phrase, so it
      // arrives as the raw word `sum` then the `of` keyword). Match on the
      // written word, not the token type: standalone "of" lexes to an `OF`
      // token, not an IDENT.
      if (head.type === "IDENT" && wordOf(head) === "sum") {
        const of = tokens[pos + 1];
        const tag = tokens[pos + 2];
        if (wordOf(of) !== "of") return null;
        if (tag?.type !== "TAG") return null;
        return {
          consumed: 3,
          replacement: [createFusedToken("TAG_SUM", tag.value ?? "", [head, of as Token, tag])],
          ruleName: "tags:aggregate",
        };
      }

      return null;
    },
  };
}

/**
 * A lone TAG token, a data-line annotation like `1200 #housing`, is dropped so
 * the line evaluates to its number. Lower priority than the aggregate rule, and
 * declines a TAG that directly follows `of` or a fused `...of` trigger, so a TAG
 * destined for `total of #tag` is never eaten before the aggregate rule (which
 * only sees the fused trigger on a later pass) can claim it.
 */
export function tagStripNormalizerRule(priority = 40): NormalizerRule {
  return {
    name: "tags:strip",
    priority,
    match(tokens, pos): NormalizerMatch | null {
      if (tokens[pos]?.type !== "TAG") return null;
      const before = tokens[pos - 1];
      if (before !== undefined) {
        // A TAG right after a fused aggregate trigger (`total of`/`count of`/
        // `average of`) is claimed by the aggregate rule on the next pass.
        if (AGGREGATE_TOKEN[before.type] !== undefined) return null;
        // A TAG after the bare word "of" is only part of an aggregate when the
        // "of" completes one of the aggregate phrases (`total`/`sum`/`count`/
        // `average` of). `cost of #living` is ordinary prose, so its tag is a
        // data-line annotation to strip, not a stray TAG left to error.
        if (wordOf(before) === "of" && AGGREGATE_WORDS.has(wordOf(tokens[pos - 2]))) return null;
      }
      return { consumed: 1, replacement: [], ruleName: "tags:strip" };
    },
  };
}
