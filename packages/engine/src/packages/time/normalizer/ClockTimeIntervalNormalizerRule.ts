import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import type { Token } from "@solve-js/lexer/Token";

/**
 * The fused interval, its text what was written (`9am to 5pm`), so a message
 * that quotes it does not show its minutes, `540:1020` (#692). The minutes
 * are the value the parselet reads.
 */
function intervalToken(source: Token[], minutes: string): Token {
  const token = createFusedToken("CLOCK_TIME_INTERVAL", minutes, source);
  token.text = source.map((t) => t.text ?? "").join(" ");
  return token;
}

/**
 * Fuses `CLOCK_TIME TO CLOCK_TIME` (e.g. `7:30 to 20:45`) into a single
 * `CLOCK_TIME_INTERVAL` prefix token carrying both endpoints as
 * `"<startMinutes>:<endMinutes>"`.
 *
 * Why fuse instead of an infix parselet on `TO`: `TO` is already claimed
 * by `PercentageChangeParselet` (`800 to 1000` percentage change) and
 * UOM's unit-conversion handling (`10 cm to m`), an infix parselet
 * registered here would silently collide with one of those (last
 * registration wins). Fusing at the normalizer stage, keyed on the
 * specific `CLOCK_TIME TO CLOCK_TIME` token shape, means `TO`'s existing
 * infix dispatch never even sees this case. This relies on
 * {@link clockTimeNormalizerRule} having already run in an earlier
 * normalizer pass to produce the `CLOCK_TIME` tokens this rule looks
 * for, the engine's `TokenNormalizer.normalize()` is multi-pass
 * specifically to support this kind of cascading fusion.
 *
 * `until` reads as `to` (`9am until 5pm`, #704): between two clock times it
 * can mean nothing else, and `days until` never sees two clock times.
 *
 * Only the unambiguous `to` and `until` forms are handled, SoulverCore's own docs flag
 * a bare `-` between two clock times as genuinely ambiguous (`5pm - 7pm`
 * read as a range vs. `5pm - 2pm` read as subtraction) and recommend
 * `to`; this package does the same rather than guessing.
 */
export function clockTimeIntervalNormalizerRule(priority = 66): NormalizerRule {
  return {
    name: "time:clock-time-interval",
    priority,
    // Derived from this rule's own opening guards; see RuleSlot on why an
    // over-broad slot is safe and an over-narrow one is not.
    shape: [{ types: ["CLOCK_TIME"] }, { types: ["TO", "UNTIL"] }],
    match(tokens, pos): NormalizerMatch | null {
      const start = tokens[pos];
      const to = tokens[pos + 1];
      const end = tokens[pos + 2];
      if (start.type !== "CLOCK_TIME") return null;
      if (to?.type !== "TO" && to?.type !== "UNTIL") return null;
      if (end?.type !== "CLOCK_TIME") return null;

      return {
        consumed: 3,
        replacement: [intervalToken(tokens.slice(pos, pos + 3), `${start.value}:${end.value}`)],
        ruleName: "time:clock-time-interval",
      };
    },
  };
}
