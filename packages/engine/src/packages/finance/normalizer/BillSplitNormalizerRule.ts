import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/** The lowercased written form of a token, tolerant of `text` vs `value`. */
function wordOf(token: Token | undefined): string {
  if (token === undefined) return "";
  return (token.text ?? token.value ?? "").toLowerCase();
}

/**
 * Token types that can END a value, so one sitting directly before `split`
 * marks the infix shape (`<amount> split N ways`) rather than the prefix one
 * (`split <amount> between N`). The same set the recurring-schedule rule uses.
 */
const VALUE_ENDERS = new Set([
  "NUMBER",
  "FLOAT",
  "HEX",
  "BIGINT",
  "RPAREN",
  "RBRACKET",
  "IDENT",
  "PERCENT",
  "STRING",
]);

/**
 * A numeric-literal count. The shape is only claimed when the share count is a
 * bare number directly in position; a decimal (`between 2.5`) is claimed too so
 * the split builtin can reject it with a clear "whole number" message rather
 * than the line silently reading `split` as an ordinary word.
 */
const NUMERIC = new Set(["NUMBER", "FLOAT"]);

/**
 * `split $180 between 4` and `$120 + 18% split 3 ways`, a per-person bill split.
 *
 * `split`, `ways` and `people` are ordinary English words, so, exactly like the
 * recurring-schedule and at-rate rules, they are claimed CONTEXTUALLY here and
 * never as bare keywords: a plain IDENT is retyped to the `SPLIT`/`WAYS`/`PEOPLE`
 * token only inside the complete surrounding shape, so `:split = 5`, a variable
 * named `split`, and prose keep working everywhere else.
 *
 * Two shapes, told apart by the token before `split`:
 *  - INFIX `<value> split <N> ways`: a value-ender sits before `split`, and a
 *    NUMBER then the word `ways` follow it. Retype `split` to SPLIT and `ways`
 *    to WAYS, leaving the count between them for the parselet.
 *  - PREFIX `split <amount> between <N> [people]`: no value-ender before
 *    `split`, and a BETWEEN with a NUMBER after it sits later on the line.
 *    Retype `split` to SPLIT (BETWEEN is already its own token), and a trailing
 *    `people` after the count to PEOPLE.
 *
 * Matched ahead of implicit multiplication (priority 77, above its 50) so the
 * count-then-word `3 ways` / `4 people` never has a `*` inserted between them,
 * the same reason the recurring-schedule rule sits at 78. The count is a literal
 * NUMBER: a parenthesised or worded count leaves the shape unclaimed and `split`
 * an ordinary word, a documented boundary.
 */
export function billSplitNormalizerRule(priority = 77): NormalizerRule {
  return {
    name: "finance:bill-split",
    priority,
    match(tokens, pos): NormalizerMatch | null {
      const head = tokens[pos];
      if (head === undefined) return null;

      // INFIX `<amount> split <N> ways`, matched at the amount's last token (a
      // value-ender) rather than at `split`. Anchoring here is what lets this
      // rule win over implicit multiplication at that position (its priority is
      // higher), so no `*` is inserted between the amount and the split. The
      // same anchoring the recurring-schedule rule uses on its amount.
      if (VALUE_ENDERS.has(head.type)) {
        const split = tokens[pos + 1];
        const count = tokens[pos + 2];
        const ways = tokens[pos + 3];
        if (
          split?.type === "IDENT" &&
          wordOf(split) === "split" &&
          count !== undefined &&
          NUMERIC.has(count.type) &&
          ways?.type === "IDENT" &&
          wordOf(ways) === "ways"
        ) {
          return {
            consumed: 4,
            replacement: [
              head,
              createFusedToken("SPLIT_WAYS", "split", [split]),
              count,
              createFusedToken("WAYS", "ways", [ways]),
            ],
            ruleName: "finance:bill-split",
          };
        }
      }

      // PREFIX `split <amount> between <N> [people]`, matched at `split`. A
      // value-ender directly before `split` would be the infix shape, already
      // handled above, so decline it here.
      if (head.type !== "IDENT" || wordOf(head) !== "split") return null;
      const before = tokens[pos - 1];
      if (before !== undefined && VALUE_ENDERS.has(before.type)) return null;

      // Find the BETWEEN that closes the shape on this line; the amount tokens
      // between are re-emitted as they are, so an arithmetic amount
      // (`split $120 + $5 between 3`) still parses.
      let betweenIndex = -1;
      for (let i = pos + 1; i < tokens.length; i++) {
        if (tokens[i].type === "BETWEEN") {
          betweenIndex = i;
          break;
        }
      }
      if (betweenIndex === -1) return null;

      const count = tokens[betweenIndex + 1];
      if (count === undefined || !NUMERIC.has(count.type)) return null;

      const peopleIndex = betweenIndex + 2;
      const hasPeople = tokens[peopleIndex]?.type === "IDENT" && wordOf(tokens[peopleIndex]) === "people";
      const lastIndex = hasPeople ? peopleIndex : betweenIndex + 1;

      // SPLIT, then the amount ... BETWEEN count re-emitted unchanged, then the
      // optional PEOPLE.
      const replacement: Token[] = [
        createFusedToken("SPLIT", "split", [head]),
        ...tokens.slice(pos + 1, betweenIndex + 2),
      ];
      if (hasPeople) replacement.push(createFusedToken("PEOPLE", "people", [tokens[peopleIndex]]));

      return {
        consumed: lastIndex - pos + 1,
        replacement,
        ruleName: "finance:bill-split",
      };
    },
  };
}
