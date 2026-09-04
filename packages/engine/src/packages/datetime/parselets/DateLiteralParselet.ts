import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { iso8601Grain } from "@solve-js/packages/datetime/Iso8601";

/** The plugin function name the grained branch below compiles to. See `DatetimeTimestampPluginFunctions.ts`. */
export const DATETIME_GRAIN_FN = "datetimeLiteralGrain";

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
    builder.emitOpcode(OpCode.DATE_LITERAL);
    builder.emitNumber(Number(token.value));

    // Read from the literal's own text, never from the instant: under `TZ=UTC`
    // an explicit `T09:00:00+09:00` IS midnight, so the fields cannot say which
    // of the three shapes was written.
    const { grain, zone } = iso8601Grain(token.text);
    if (grain === "date") return;

    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(grain);
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(zone ?? "");
    builder.emitPluginCall(DATETIME_GRAIN_FN, 3);
  }
}
