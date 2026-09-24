import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { tryConsumeZoneReference, consumeZoneList, checkZoneCount, emitNamedZones } from "./shared/ZoneReference";
import { nextIsOnClause, tryParseOnDate } from "./shared/OnDate";
import { ZONE_CONVERT_FN, ZONE_CONVERT_AT_FN } from "./TimezonePluginFunctions";

/**
 * `9:00am` / `16:00` / `4pm`, a clock-time-of-day literal, anchored to
 * today's calendar date (see `OpCode.CLOCK_TIME_TODAY` in `vm/VM.ts`).
 * Handles the fused `CLOCK_TIME` token produced by
 * {@link clockTimeNormalizerRule} (token value = total minutes since
 * midnight, as a decimal string).
 *
 * Also handles the optional timezone-conversion suffix, `<clock-time>
 * <sourceZone> in <targetZone>` (e.g. "6pm Sydney in Chicago"). See
 * {@link tryConsumeZoneReference}. The suffix is entirely optional and
 * only consumes tokens once a recognized zone name is actually found
 * immediately after the clock-time literal, so the plain
 * `CLOCK_TIME_TODAY` path below is completely unchanged when no suffix is
 * present. A recognized source zone with no following "in <target>" is a
 * parse error (not silently ignored), once a zone name is consumed
 * there's no going back given this parser has no backtracking.
 *
 * The target may be a list, `in Tokyo, New York and Sydney`, and the line may
 * name the day with `on <date>`, either before the `in` (`3pm London on 23
 * September 2026 in Tokyo`) or at the end (`3pm London in Tokyo on 23
 * September 2026`). A single undated target emits exactly the bytecode it
 * always did, the three-argument `zoneConvert` call; anything else goes to
 * `zoneConvertAt`, which takes the date (or `now`) and every target. The
 * target strings are emitted last, after the date's own bytecode, so the
 * argument order is the same wherever the reader put the `on` clause.
 */
export class ClockTimeParselet implements PrefixParselet {
	readonly category = "Time";

  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    const totalMinutes = parseInt(token.value, 10);
    const sourceZoneRef = tryConsumeZoneReference(parser);

    if (sourceZoneRef !== null) {
      builder.emitOpcode(OpCode.PUSH_NUMBER);
      builder.emitNumber(totalMinutes);
      builder.emitOpcode(OpCode.PUSH_STRING);
      builder.emitString(sourceZoneRef.zoneRef);

      // `zoneConvertAt` reads the source label and then the date, and the
      // date's bytecode lands wherever it is parsed. A leading `on` commits
      // the line to that call at once, so both go out now; otherwise they wait
      // until the targets show whether the line is the plain three-argument
      // form, which carries neither.
      const leadingDate = nextIsOnClause(parser);
      if (leadingDate) {
        builder.emitOpcode(OpCode.PUSH_STRING);
        builder.emitString(sourceZoneRef.displayName);
        tryParseOnDate(parser, builder);
      }

      if (parser.peek()?.type !== "IN") {
        throw ErrorFactory.parsing(
          "TIME_ZONE_EXPECTED_IN",
          `Expected "in <city>" after the zone name (e.g. "6pm Sydney in Chicago") but got ${parser.peek() ? `"${parser.peek()!.value}"` : "end of input"}`,
        );
      }
      parser.consume(); // "in"
      const targets = consumeZoneList(parser);
      if (targets.length === 0) {
        throw ErrorFactory.parsing(
          "TIME_ZONE_EXPECTED_TARGET",
          `Expected a city or zone name after "in" (e.g. "6pm Sydney in Chicago")`,
        );
      }
      checkZoneCount(targets);

      if (leadingDate) {
        emitNamedZones(builder, targets);
        builder.emitPluginCall(ZONE_CONVERT_AT_FN, 4 + targets.length * 2);
        return;
      }

      if (!nextIsOnClause(parser) && targets.length === 1) {
        builder.emitOpcode(OpCode.PUSH_STRING);
        builder.emitString(targets[0].zoneRef);
        builder.emitPluginCall(ZONE_CONVERT_FN, 3);
        return;
      }

      builder.emitOpcode(OpCode.PUSH_STRING);
      builder.emitString(sourceZoneRef.displayName);
      if (!tryParseOnDate(parser, builder)) builder.emitOpcode(OpCode.DATE_NOW);
      emitNamedZones(builder, targets);
      builder.emitPluginCall(ZONE_CONVERT_AT_FN, 4 + targets.length * 2);
      return;
    }

    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(totalMinutes);
    builder.emitOpcode(OpCode.CLOCK_TIME_TODAY);
  }
}
