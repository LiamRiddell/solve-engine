import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { iso8601Grain } from "@solve-js/packages/datetime/Iso8601";
import { wallTimeOn } from "@solve-js/calendar/WallTime";

/** The plugin function name the grained branch below compiles to. See `DatetimeTimestampPluginFunctions.ts`. */
export const DATETIME_GRAIN_FN = "datetimeLiteralGrain";

/**
 * A month and year with no day, as the month-name rule writes its text
 * (`February2026`): the whole month, not a day in it.
 */
const WHOLE_MONTH = /^[A-Za-z]+\d{4}$/;

/**
 * The seconds since midnight a time token names, when it is a time of day: a
 * clock time (`14:30`, `3pm`), or `HH:MM:SS` in whole seconds short of
 * midnight (`14:30:15`), which on its own is a stopwatch reading and after a
 * date can only be the time on it.
 */
function secondsOfDay(token: Token | undefined): number | null {
  if (token?.type === "CLOCK_TIME") return Number(token.value) * 60;
  if (token?.type === "LAPTIME") {
    const seconds = Number(token.value);
    return Number.isInteger(seconds) && seconds < 86_400 ? seconds : null;
  }
  return null;
}

/**
 * The time of day written straight after a calendar date, bare or after
 * `at` (`2026-01-04 14:30`, `23 September 2026 at 3pm`), and how many
 * tokens it takes. A pure look: nothing is consumed.
 *
 * Only a fused time token counts, so the time package's reading of the clock
 * (`12am` is midnight, `25:00` is no time) is the one that applies, and a
 * date followed by a bare number (`2026-01-04 14`) is left for the parser to
 * refuse as it always did. `at` claims the join only when a time follows it;
 * before a rate it stays the rate's (`40 hours at £15/hour`).
 */
function timeOfDayAfter(parser: Parser, date: Token): { seconds: number; tokens: number } | null {
  // `February 2026` is the whole month, read as its first day. A time after it
  // would pin a day the reader never named, so it is left unread.
  if (WHOLE_MONTH.test(date.text)) return null;
  const next = parser.peek();
  const bare = secondsOfDay(next);
  if (bare !== null) return { seconds: bare, tokens: 1 };
  if (next?.type === "RATE_AT" || next?.type === "AT") {
    const afterAt = secondsOfDay(parser.peekAt(1));
    if (afterAt !== null) return { seconds: afterAt, tokens: 2 };
  }
  return null;
}

/**
 * Pushes a datetime literal (25/12/2023, 12-25-2023, 2023-12-25, 25.12.2023,
 * 2026-04-03T09:30, 2026-04-03T10:30:00+09:00) whose epoch-ms was already
 * computed by {@link dateLiteralNormalizerRule} during token fusion.
 *
 * A calendar day is the whole of the emission: one `DATE_LITERAL` and its
 * constant, exactly as before, which is what keeps the commonest date line off
 * any slower path. The VM reads the grain `date` off that opcode, and it is
 * true by construction because the other two shapes never reach it.
 *
 * A literal carrying a time of day takes one extra step: the grain and the
 * zone it named go on the stack as strings and a plugin call fastens them to
 * the value. That spelling was chosen because the alternatives all move the
 * bytecode. A second `DATE_LITERAL` operand, or a new opcode, changes
 * `SerializedBytecode`, which `EngineSnapshot` carries and validates, and a
 * snapshot written by one version and restored by another would then read the
 * wrong constant. A plugin call adds no opcode and no operand: it is the same
 * idiom the datetime package's other computed values already use.
 */
export class DateLiteralParselet implements PrefixParselet {
	readonly category = "Date/Time";
	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    // Read from the literal's own text, never from the instant: under `TZ=UTC`
    // an explicit `T09:00:00+09:00` IS midnight, so the fields cannot say which
    // of the three shapes was written.
    const { grain, zone } = iso8601Grain(token.text);

    if (grain === "date") {
      // A calendar date with a time of day after it (#692) is the `T` literal
      // for that day and time: the same instant, found the same way, and the
      // same wall-clock grain, so it goes wherever `2026-01-04T14:30` goes.
      const time = timeOfDayAfter(parser, token);
      const at = time === null ? null : wallTimeOn(Number(token.value), time.seconds, parser.getCalendar());
      if (time !== null && at !== null) {
        for (let i = 0; i < time.tokens; i++) parser.consume();
        builder.emitOpcode(OpCode.DATE_LITERAL);
        builder.emitNumber(at);
        builder.emitOpcode(OpCode.PUSH_STRING);
        builder.emitString("datetime");
        builder.emitOpcode(OpCode.PUSH_STRING);
        builder.emitString("");
        builder.emitPluginCall(DATETIME_GRAIN_FN, 3);
        return;
      }
      builder.emitOpcode(OpCode.DATE_LITERAL);
      builder.emitNumber(Number(token.value));
      return;
    }

    builder.emitOpcode(OpCode.DATE_LITERAL);
    builder.emitNumber(Number(token.value));

    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(grain);
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(zone ?? "");
    builder.emitPluginCall(DATETIME_GRAIN_FN, 3);
  }
}
