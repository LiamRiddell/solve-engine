import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { lowerCased, lowersTo } from "@solve-js/normalizer/RuleIndex";

/** The written form of a token, tolerant of `text` vs `value`. */
function writtenOf(token: Token | undefined): string {
  if (token === undefined) return "";
  return token.text ?? token.value ?? "";
}

/** The fused math-phrase triggers, and the section aggregate each opens. */
const FUSED_TRIGGER: ReadonlyMap<string, string> = new Map([
  ["TOTAL_OF", "SECTION_SUM"],
  ["COUNT_OF", "SECTION_COUNT"],
  ["AVERAGE_OF", "SECTION_AVERAGE"],
]);

/**
 * The same aggregates spelled as a bare word before a separate `of`.
 *
 * A `Map`, which holds only its own keys: read as an object, a word naming an
 * inherited property (`constructor of section "x"`) found `Object` itself and
 * made it the fused token's type, which the next pass could not read.
 */
const WORD_TRIGGER: ReadonlyMap<string, string> = new Map([
  ["total", "SECTION_SUM"],
  ["sum", "SECTION_SUM"],
  ["count", "SECTION_COUNT"],
  ["average", "SECTION_AVERAGE"],
]);

/**
 * The section aggregate a bare word before `of` opens, in any case, or
 * undefined. The rule asks it at every word of a line, so a word in lower case
 * is looked up as it stands rather than copied first.
 *
 * @param token - The word.
 */
export function sectionTriggerOf(token: Token): string | undefined {
  return WORD_TRIGGER.get(lowerCased(writtenOf(token)));
}

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

      let fused = FUSED_TRIGGER.get(head.type);
      let wordAt = pos + 1;
      if (fused === undefined) {
        if (head.type !== "IDENT") return null;
        fused = sectionTriggerOf(head);
        // Standalone "of" lexes to an `OF` token, not an IDENT, so it is
        // matched on the written word.
        if (fused === undefined || !lowersTo(writtenOf(tokens[pos + 1]), "of")) return null;
        wordAt = pos + 2;
      }

      const word = tokens[wordAt];
      const name = tokens[wordAt + 1];
      if (word?.type !== "IDENT" || !lowersTo(writtenOf(word), "section")) return null;
      if (name?.type !== "STRING") return null;
      return {
        consumed: wordAt + 2 - pos,
        replacement: [createFusedToken(fused, name.value ?? "", tokens.slice(pos, wordAt + 2))],
        ruleName: "lines:section-aggregate",
      };
    },
  };
}
