import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { isInsideRangeContext } from "@solve-js/normalizer/BuiltinNormalizerRules";

/**
 * Converts an hour[:minute] + optional am/pm marker into total
 * minutes-since-midnight (0-1439), or `null` if the combination is out of
 * range for whichever clock convention applies:
 * - With an am/pm marker: 12-hour clock, hour must be 1-12 (`12am`
 *   midnight -> 0, `12pm` noon -> 720).
 * - Without: 24-hour clock, hour must be 0-23.
 */
function computeTotalMinutes(hour: number, minute: number, ampm: string | undefined): number | null {
  if (minute < 0 || minute > 59) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    const isPM = ampm.toLowerCase() === "pm";
    const hour24 = (hour % 12) + (isPM ? 12 : 0);
    return hour24 * 60 + minute;
  }
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

function isAmPmToken(token: { type: string; value: string } | undefined): token is { type: string; value: string } {
  return !!token && token.type === "IDENT" && /^(am|pm)$/i.test(token.value);
}

/**
 * The fused clock-time token, carrying its own source text.
 *
 * `createFusedToken` writes the value into both fields, which for this token
 * means the text reads `540` where the line said `9am`. Nothing consumes a
 * clock time's text as a payload (the minutes are in `value`), and two things
 * want the real thing: a span that covers what was written, and
 * `clockTimeSumNormalizerRule`, which adds bare times and refuses times of day,
 * a distinction only the source spelling carries.
 */
function fusedClockTime(source: Token[], totalMinutes: number): Token {
  const token = createFusedToken("CLOCK_TIME", String(totalMinutes), source);
  token.text = source.map((t) => t.text ?? "").join("");
  return token;
}

/**
 * Fuses a clock-time-of-day literal into a single `CLOCK_TIME` prefix
 * token carrying total minutes-since-midnight as its value (a plain
 * decimal string, e.g. "540" for 9:00am).
 *
 * Two source shapes:
 * - `NUMBER COLON NUMBER [am|pm]`, `9:00am`, `9:00 am`, `16:00` (24h
 *   no am/pm).
 * - `NUMBER am|pm`, the bare-hour form, `4pm`.
 *
 * "am"/"pm" are matched as plain `IDENT` tokens (case-insensitively)
 * deliberately NOT added to the locale keywordMap, so this doesn't change
 * lexing for "am"/"pm" used as ordinary identifiers/variable names
 * anywhere else; the pattern only fires when one immediately follows a
 * number (optionally via `H:MM`), which is a narrow, low-collision-risk
 * trigger. Not a general per-word keyword change like the datetime
 * package's weekday names.
 */
export function clockTimeNormalizerRule(priority = 65): NormalizerRule {
  return {
    name: "time:clock-time",
    priority,
    // Two shapes, so the second slot is their union: `9:00am` puts a COLON
    // after the number, while the bare-hour `4pm` puts the am/pm IDENT there.
    // Declaring only COLON would make the bare form unreachable.
    shape: [{ types: ["NUMBER"] }, { types: ["COLON", "IDENT"] }],
    match(tokens, pos): NormalizerMatch | null {
      const hourToken = tokens[pos];
      if (hourToken.type !== "NUMBER") return null;
      const hour = parseInt(hourToken.value, 10);
      if (isNaN(hour) || hour < 0 || hour > 23) return null;

      // A clock time inside `[...]` (matrix literal/index/slice) has no
      // legitimate meaning, reserve bare `NUMBER:NUMBER` there for a
      // matrix range instead (see isInsideRangeContext's own doc comment).
      //
      // Ordered AFTER the hour test deliberately: this scans back to the
      // start of the line, so running it first paid an O(pos) walk at every
      // token of every type. It sits above both shape branches because it
      // must suppress each of them, and it only ever returns null, so
      // moving it below the cheap guards cannot change any result.
      if (isInsideRangeContext(tokens, pos)) return null;

      // Pattern: NUMBER COLON NUMBER [am|pm]
      const colonToken = tokens[pos + 1];
      const minuteToken = tokens[pos + 2];
      if (colonToken?.type === "COLON" && minuteToken?.type === "NUMBER") {
        const minute = parseInt(minuteToken.value, 10);
        const ampmToken = tokens[pos + 3];
        const hasAmPm = isAmPmToken(ampmToken);
        const totalMinutes = computeTotalMinutes(hour, minute, hasAmPm ? ampmToken!.value : undefined);
        if (totalMinutes === null) return null;
        const consumed = hasAmPm ? 4 : 3;
        return {
          consumed,
          replacement: [fusedClockTime(tokens.slice(pos, pos + consumed), totalMinutes)],
          ruleName: "time:clock-time",
        };
      }

      // Pattern: NUMBER am|pm (bare hour, e.g. "4pm")
      const bareAmPmToken = tokens[pos + 1];
      if (isAmPmToken(bareAmPmToken)) {
        const totalMinutes = computeTotalMinutes(hour, 0, bareAmPmToken.value);
        if (totalMinutes === null) return null;
        return {
          consumed: 2,
          replacement: [fusedClockTime(tokens.slice(pos, pos + 2), totalMinutes)],
          ruleName: "time:clock-time",
        };
      }

      return null;
    },
  };
}
