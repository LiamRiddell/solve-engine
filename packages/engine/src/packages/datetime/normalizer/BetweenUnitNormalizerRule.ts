import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { valueLowersTo } from "@solve-js/normalizer/RuleIndex";

/** The tokens that end an amount a unit after them belongs to. */
const AMOUNT_ENDS: ReadonlySet<string> = new Set(["NUMBER", "RPAREN"]);

/**
 * Fuses `UNIT BETWEEN` → a single `BETWEEN_UNIT` prefix token carrying the
 * unit name as its value (e.g. "days"), so `days between <a> and <b>`
 * parses.
 *
 * Same rationale as {@link untilSinceNormalizerRule}, which this mirrors
 * exactly: a bare `UNIT` in prefix position is already claimed by
 * VariablesPackage's IdentifierParselet, so the collision has to be
 * removed before parsing starts rather than resolved during it.
 *
 * Also swallows a preceding `how many` (`how many days between ...`,
 * `how many days until ...`). That reads as one phrase to a human but is
 * two ordinary identifier tokens to the lexer, and fusing them here, only
 * ever directly in front of a unit-plus-connector, keeps "how" and "many"
 * from becoming keywords that would shadow variables named either.
 */
export function betweenUnitNormalizerRule(priority = 60): NormalizerRule {
  return {
    name: "datetime:between-unit",
    priority,
    // No second slot: an optional `how many` prefix means the first token
    // is either of two words or the unit itself, and what follows differs
    // per spelling. The start types still narrow it.
    startTokenTypes: ["UNIT", "IDENT"],
    match(tokens, pos): NormalizerMatch | null {
      // Optional leading "how many".
      let start = pos;
      let howManyLength = 0;
      // Compared in place: asked at every unit and word of a line, a
      // lower-cased copy of each was built only to be thrown away.
      if (valueLowersTo(tokens[pos], "how") && valueLowersTo(tokens[pos + 1], "many")) {
        start = pos + 2;
        howManyLength = 2;
      }

      const unitToken = tokens[start];
      const keywordToken = tokens[start + 1];
      if (!unitToken || !keywordToken) return null;
      if (unitToken.type !== "UNIT") return null;
      // A unit straight after a number is that quantity's unit, not the
      // start of `days between`: `solve line 2 for d = 3000 m between 0 and
      // 10` names a range after a target in metres (#739). So is one straight
      // after a closing bracket: `split 1/2 KWD between 3` reaches here as
      // `(1/2) KWD between 3`, the fraction bracketed as the amount it is.
      if (howManyLength === 0 && pos > 0 && AMOUNT_ENDS.has(tokens[pos - 1]?.type ?? "")) return null;

      // "how many days until X" reuses the existing UNTIL_UNIT/SINCE_UNIT
      // tokens. This rule only has to drop the "how many" for those, since
      // untilSinceNormalizerRule then sees a plain `UNIT UNTIL` pair.
      const isBetween = keywordToken.type === "BETWEEN";
      const isUntilSince = keywordToken.type === "UNTIL" || keywordToken.type === "SINCE";
      if (!isBetween && !isUntilSince) return null;
      if (isUntilSince && howManyLength === 0) return null; // nothing for this rule to do

      const sources = tokens.slice(pos, start + 2);
      if (isUntilSince) {
        // Re-emit the pair untouched, minus the "how many".
        return {
          consumed: howManyLength + 2,
          replacement: [unitToken, keywordToken],
          ruleName: "datetime:how-many",
        };
      }

      return {
        consumed: howManyLength + 2,
        replacement: [createFusedToken("BETWEEN_UNIT", unitToken.value, sources)],
        ruleName: "datetime:between",
      };
    },
  };
}
