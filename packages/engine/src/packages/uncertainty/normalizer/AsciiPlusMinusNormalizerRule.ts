import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * `a +/- b` as the uncertainty operator, the ASCII spelling of `a ± b`.
 *
 * The `±` symbol lexes directly (ExpressionLexer.ts, alongside `×`/`÷`), but the
 * ASCII form arrives as three separate tokens, PLUS then SLASH then MINUS, since
 * each is an ordinary operator character. This fuses that exact run into a single
 * PLUS_MINUS token so both spellings reach the one infix parselet.
 *
 * The run is unambiguous: `+/-` has no other reading, `/` has no prefix parselet,
 * so `x + /- y` is a parse error today rather than any valid expression this
 * could be stealing. The rule requires the three consecutively and in order, so
 * an ordinary `10 / -5` (SLASH then MINUS, no leading PLUS) is untouched.
 */
export function asciiPlusMinusNormalizerRule(priority = 90): NormalizerRule {
    return {
        name: "uncertainty:ascii-plus-minus",
        priority,
        match(tokens, pos): NormalizerMatch | null {
            const plus = tokens[pos];
            if (plus?.type !== "PLUS") return null;
            const slash = tokens[pos + 1];
            if (slash?.type !== "SLASH") return null;
            const minus = tokens[pos + 2];
            if (minus?.type !== "MINUS") return null;

            return {
                consumed: 3,
                replacement: [createFusedToken("PLUS_MINUS", "±", [plus, slash, minus])],
                ruleName: "uncertainty:ascii-plus-minus",
            };
        },
    };
}
