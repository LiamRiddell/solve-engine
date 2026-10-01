import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { isInsideRangeContext } from "@solve-js/normalizer/BuiltinNormalizerRules";
import { rangeBeforeLaterArgument } from "@solve-js/normalizer/RangeArgumentOrder";

/** The token a colon pair that is no clock time is fused into. See `InvalidClockTimeParselet`. */
export const INVALID_CLOCK_TIME = "INVALID_CLOCK_TIME";

/**
 * The words a colon pair that is no clock time is refused with, the same as a
 * line holding only that pair is.
 *
 * @param literal - The pair as the reader wrote it.
 */
export function invalidTimeMessage(literal: string): string {
  return `"${String(literal)}" is not a valid time`;
}

/** The most tokens one refused literal takes, so a hostile run of colons costs a bounded match. */
const MAX_FIELDS = 8;

/**
 * Whether token `pos` sits inside a bracket that is still open there, `(` or
 * `[`. A colon at the top level of a line may be a label's (`Week 12: 75`),
 * which the engine reads after the parse has failed; inside a bracket no
 * label can stand, so a colon between two numbers there is a time or a range.
 *
 * @param tokens - The pass's tokens.
 * @param pos - The position asked about.
 */
export function isInsideBrackets(tokens: readonly Token[], pos: number): boolean {
  let depth = 0;
  for (let i = 0; i < pos && i < tokens.length; i++) {
    const type = tokens[i].type;
    if (type === "LPAREN" || type === "LBRACKET") depth++;
    else if ((type === "RPAREN" || type === "RBRACKET") && depth > 0) depth--;
  }
  return depth > 0;
}

/**
 * The colon pair at `pos` as the reader wrote it, `24:00` or `13:00pm`, with
 * how many tokens it takes: numbers joined by colons, then an am or pm if one
 * follows. Null when `pos` does not start one.
 *
 * @param tokens - The pass's tokens.
 * @param pos - The position of the first number.
 */
export function colonPairAt(tokens: readonly Token[], pos: number): { literal: string; consumed: number } | null {
  if (tokens[pos]?.type !== "NUMBER" || tokens[pos + 1]?.type !== "COLON" || tokens[pos + 2]?.type !== "NUMBER") return null;
  let end = pos + 3;
  while (end - pos < MAX_FIELDS * 2 - 1 && tokens[end]?.type === "COLON" && tokens[end + 1]?.type === "NUMBER") end += 2;
  const marker = tokens[end];
  if (marker?.type === "IDENT" && /^(am|pm)$/i.test(marker.value)) end++;
  const literal = tokens.slice(pos, end).map((t) => t.text || t.value).join("");
  return { literal, consumed: end - pos };
}

/**
 * A colon between two numbers inside a bracket that no time rule read:
 * `(24:00)`, `max(9:60, 1)`, `total(24:00, 0:00)`. Fused into one
 * `INVALID_CLOCK_TIME` token, which the parser refuses with
 * `INVALID_TIME_LITERAL`, as `24:00` on its own line is refused.
 *
 * The clock-time, lap-time, timecode and pace rules read every colon pair
 * they can, and this rule sits below all of them, so it sees only what each
 * declined: an hour past 23, a minute past 59, a decimal or a long number on
 * either side, an am or pm on an hour the twelve-hour clock has not got.
 * Those used to be left as a bare colon, which the bracket's parselet then
 * met where it expected its `)`, and the reader saw the parser's `Expected
 * ")", but found ":"`.
 *
 * The boundary: only inside a bracket, and never where a colon is a range
 * (the collection of `sum`, `prod`, `map` or `reduce`, or a matrix slice; see
 * `isInsideRangeContext`). At the top level of a line a colon may be a
 * label's, and the engine's label reading already refuses a colon pair that
 * stands alone. A pair whose first number follows another colon is part of a
 * longer literal a rule has partly read, and is left as it is.
 *
 * @param priority - Where the rule sits among the normaliser's rules; below every time rule.
 */
export function invalidClockTimeNormalizerRule(priority = 20): NormalizerRule {
  return {
    name: "time:invalid-clock-time",
    priority,
    shape: [{ types: ["NUMBER"] }, { types: ["COLON"] }],
    match(tokens, pos): NormalizerMatch | null {
      const pair = colonPairAt(tokens, pos);
      if (pair === null) return null;
      if (tokens[pos - 1]?.type === "COLON") return null;
      if (!isInsideBrackets(tokens, pos) || isInsideRangeContext(tokens, pos)) return null;
      const fused = createFusedToken(INVALID_CLOCK_TIME, pair.literal, tokens.slice(pos, pos + pair.consumed));
      // The refusal rides on the token, so the parser gives it wherever it
      // meets the pair, as a value or where it needed another token.
      // A whole-number pair before a later argument of sum, prod, map or
      // reduce is a range in the wrong place, and is refused as one.
      fused.fault = rangeBeforeLaterArgument(tokens, pos, pair.consumed) ?? { code: "INVALID_TIME_LITERAL", message: invalidTimeMessage(pair.literal) };
      return {
        consumed: pair.consumed,
        replacement: [fused],
        ruleName: "time:invalid-clock-time",
      };
    },
  };
}
