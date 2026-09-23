import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/** The lowercased written form of a token, tolerant of `text` vs `value`. */
function wordOf(token: Token | undefined): string {
  if (token === undefined) return "";
  return (token.text ?? token.value ?? "").toLowerCase();
}

/** The fused math-phrase triggers, and the section aggregate each opens. */
const FUSED_TRIGGER: Readonly<Record<string, string>> = {
  TOTAL_OF: "SECTION_SUM",
  COUNT_OF: "SECTION_COUNT",
  AVERAGE_OF: "SECTION_AVERAGE",
};

/** The same aggregates spelled as a bare word before a separate `of`. */
const WORD_TRIGGER: Readonly<Record<string, string>> = {
  total: "SECTION_SUM",
  sum: "SECTION_SUM",
  count: "SECTION_COUNT",
  average: "SECTION_AVERAGE",
};

/**
 * `total of section "Travel"` / `sum of section "Travel"` / `average of section
 * "Travel"` / `count of section "Travel"`, the section aggregates. Fuses the
 * trigger, the word `section` and the quoted heading name into one
 * SECTION_SUM / SECTION_AVERAGE / SECTION_COUNT token whose value is the name.
 *
 * Two shapes, for the reason the tag aggregate rule gives. The math-phrases
 * package fuses `total of`/`count of`/`average of` into one trigger token, so
 * those usually arrive fused; `sum of` has no such phrase and arrives as the
 * raw words, and an engine registered without math phrases sees every one of
 * them that way.
 *
 * Collision-safety: the whole of `section "name"` has to follow, a quoted name
 * included. `section` never becomes a keyword on its own, so a variable named
 * `section` still reads (`total of section` with `:section = 5` is 5), and
 * `total of 1, 2, 3` falls through to the ordinary aggregate untouched.
 */
export function sectionAggregateNormalizerRule(priority = 80): NormalizerRule {
  return {
    name: "lines:section-aggregate",
    priority,
    // Derived from this rule's own opening guards; see RuleSlot on why an
    // over-broad slot is safe and an over-narrow one is not.
    shape: [{ types: ["TOTAL_OF", "COUNT_OF", "AVERAGE_OF", "IDENT"] }],
    match(tokens, pos): NormalizerMatch | null {
      const head = tokens[pos];
      if (head === undefined) return null;

      let fused = FUSED_TRIGGER[head.type];
      let wordAt = pos + 1;
      if (fused === undefined) {
        if (head.type !== "IDENT") return null;
        fused = WORD_TRIGGER[wordOf(head)];
        // Standalone "of" lexes to an `OF` token, not an IDENT, so it is
        // matched on the written word.
        if (fused === undefined || wordOf(tokens[pos + 1]) !== "of") return null;
        wordAt = pos + 2;
      }

      const word = tokens[wordAt];
      const name = tokens[wordAt + 1];
      if (word?.type !== "IDENT" || wordOf(word) !== "section") return null;
      if (name?.type !== "STRING") return null;
      return {
        consumed: wordAt + 2 - pos,
        replacement: [createFusedToken(fused, name.value ?? "", tokens.slice(pos, wordAt + 2))],
        ruleName: "lines:section-aggregate",
      };
    },
  };
}
