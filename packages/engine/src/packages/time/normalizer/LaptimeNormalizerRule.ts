import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { isInsideRangeContext } from "@solve-js/normalizer/BuiltinNormalizerRules";

/**
 * Fuses a lap-time / stopwatch-split literal, `HH:MM:SS[.f]`, always
 * TWO colons, into a single `LAPTIME` prefix token carrying total
 * seconds (fractional-precision) as its value.
 *
 * A laptime is a DURATION, not a point in time (unlike clock-time's one
 * colon), SoulverCore's own docs note "a laptime must include two
 * colons so Soulver can distinguish it from a clock time," which this
 * rule mirrors: it must run at HIGHER priority than
 * {@link clockTimeNormalizerRule} so `03:04:05` gets a chance to match
 * all three number groups before the clock-time rule greedily fuses just
 * the first two.
 */
export function laptimeNormalizerRule(priority = 70): NormalizerRule {
  return {
    name: "time:laptime",
    priority,
    // `HH:MM:SS`, so a number with a colon after it. The colon is what
    // separates this family from every other rule firing on a bare number.
    shape: [{ types: ["NUMBER"] }, { types: ["COLON"] }],
    match(tokens, pos): NormalizerMatch | null {
      const h = tokens[pos];
      const c1 = tokens[pos + 1];
      const m = tokens[pos + 2];
      const c2 = tokens[pos + 3];
      const s = tokens[pos + 4];
      if (h.type !== "NUMBER") return null;
      if (c1?.type !== "COLON") return null;
      if (m?.type !== "NUMBER") return null;
      if (c2?.type !== "COLON") return null;
      if (s?.type !== "NUMBER") return null;

      // See ClockTimeNormalizerRule's identical guard, a laptime inside
      // `[...]` has no legitimate meaning; reserved for matrix ranges.
      // Ordered AFTER the shape test deliberately: this scans back to the
      // start of the line, so running it first paid an O(pos) walk at every
      // token of every type. It only ever returns null, so testing it last
      // among the null-returning guards cannot change any result.
      if (isInsideRangeContext(tokens, pos)) return null;

      const hours = parseInt(h.value, 10);
      const minutes = parseInt(m.value, 10);
      const seconds = parseFloat(s.value);
      if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
      if (minutes < 0 || minutes > 59 || seconds < 0 || seconds >= 60) return null;

      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      return {
        consumed: 5,
        replacement: [createFusedToken("LAPTIME", String(totalSeconds), tokens.slice(pos, pos + 5))],
        ruleName: "time:laptime",
      };
    },
  };
}
