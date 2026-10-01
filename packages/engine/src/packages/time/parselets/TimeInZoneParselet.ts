import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { tryConsumeZoneReference } from "./shared/ZoneReference";
import { nextIsOnClause } from "./shared/OnDate";

/**
 * `time in <city>` -> that zone's current wall-clock time. `date in
 * <city>` -> that zone's current calendar date. One parameterized
 * parselet for both, triggered on the fused `TIME_IN`/`DATE_IN` token
 * (see `TimePackage.ts`'s `phrases` field), "time"/"date" are common
 * variable names, so the trigger is the full two-word phrase, not the
 * bare word (same reasoning as `MathPhrasesPackage.ts`'s "average of"
 * pattern: fusing the phrase means the bare word stays a plain,
 * still-usable `IDENT`).
 *
 * Both answer for now, and an `on <date>` after the zone is refused (#697):
 * the clock now carried to another day is not a question anyone asks. The
 * refusal names the two forms that answer what is meant, a time converted on
 * that day and the gap between two places on it.
 */
export function timeOrDateInZoneParselet(pluginFnName: string): PrefixParselet {
  return {
    category: "Time",
    parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
      const zone = tryConsumeZoneReference(parser);
      if (zone === null) {
        throw ErrorFactory.parsing(
          "TIME_ZONE_EXPECTED_CITY",
          `Expected a city or zone name after "${token.value}" (e.g. "time in Paris")`,
        );
      }
      if (nextIsOnClause(parser)) {
        throw ErrorFactory.parsing(
          "TIME_IN_ZONE_UNDATED",
          `"${token.value}" gives the ${token.value.split(" ")[0]} there now, not on another day. For a time on a given day, convert one: "2pm London in Tokyo on 1 March 2027". For the gap between two places that day: "time difference between London and Tokyo on 1 March 2027".`,
        );
      }
      builder.emitOpcode(OpCode.PUSH_STRING);
      builder.emitString(zone.zoneRef);
      builder.emitPluginCall(pluginFnName, 1);
    },
  };
}
