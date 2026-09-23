import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { consumeZoneList, checkZoneCount, emitNamedZones } from "./shared/ZoneReference";
import { tryParseOnDate } from "./shared/OnDate";
import { HOURS_OVERLAP_FN } from "./OverlapPluginFunctions";

/**
 * The hours an `overlap of` line names, as minutes past midnight at each end,
 * or `null` (consuming nothing) when what follows is not a pair of clock times.
 *
 * Two spellings. `9am to 5pm` arrives as one `CLOCK_TIME_INTERVAL` token, fused
 * by `clockTimeIntervalNormalizerRule`. `9am-5pm` arrives as `CLOCK_TIME MINUS
 * CLOCK_TIME`, because that rule deliberately leaves a hyphen alone: between
 * two clock times anywhere else it is ambiguous with subtraction. Here it is
 * not, since `overlap of` has already said what follows is a stretch of the
 * day, so the hyphen is read as `to` inside this form and nowhere else.
 */
function consumeHours(parser: Parser): { start: number; end: number } | null {
  const first = parser.peek();
  if (first?.type === "CLOCK_TIME_INTERVAL") {
    parser.consume();
    const [start, end] = first.value.split(":").map((part) => parseInt(part, 10));
    return { start, end };
  }
  if (first?.type === "CLOCK_TIME" && parser.peekAt(1)?.type === "MINUS" && parser.peekAt(2)?.type === "CLOCK_TIME") {
    parser.consume();
    parser.consume();
    const last = parser.consume();
    return { start: parseInt(first.value, 10), end: parseInt(last.value, 10) };
  }
  return null;
}

/**
 * `overlap of <hours> in <zone>, <zone> and <zone> [on <date>]`: the stretch
 * of the day that falls inside the same hours in every place named. See
 * `hoursOverlapHandler` for how the stretch is found.
 *
 * Triggered on the fused `OVERLAP_OF` token, so a bare `overlap` stays an
 * ordinary variable name, the same reasoning as `time in` and `time difference
 * between`. The hours are written on the line rather than assumed, and one set
 * applies to every place.
 *
 * Emits `[startMinutes, endMinutes, date or now, ...(zoneRef, label)]`. A line
 * with fewer than two places parses, and the handler refuses it as an Error
 * value, since it is well formed and only has nothing to overlap with.
 */
export class HoursOverlapParselet implements PrefixParselet {
  readonly category = "Time";

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    const hours = consumeHours(parser);
    if (hours === null) {
      throw ErrorFactory.parsing(
        "OVERLAP_EXPECTED_HOURS",
        `Expected hours after "overlap of", as in "overlap of 9am to 5pm in London and New York"`,
      );
    }
    if (parser.peek()?.type !== "IN") {
      throw ErrorFactory.parsing(
        "OVERLAP_EXPECTED_IN",
        `Expected "in" and the places after the hours, as in "overlap of 9am to 5pm in London and New York"`,
      );
    }
    parser.consume(); // "in"
    const zones = consumeZoneList(parser);
    if (zones.length === 0) {
      throw ErrorFactory.parsing(
        "OVERLAP_EXPECTED_CITY",
        `Expected a city or zone name after "in", as in "overlap of 9am to 5pm in London and New York"`,
      );
    }
    checkZoneCount(zones);

    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(hours.start);
    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(hours.end);
    if (!tryParseOnDate(parser, builder)) builder.emitOpcode(OpCode.DATE_NOW);
    emitNamedZones(builder, zones);
    builder.emitPluginCall(HOURS_OVERLAP_FN, 3 + zones.length * 2);
  }
}
