import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * Compiles a date-shaped run that no configured order can read into the
 * structured Error value that reports it.
 *
 * The sibling of {@link DateLiteralParselet}: where that one pushes the
 * instant the normaliser computed, this one pushes the code and the message
 * the normaliser composed and calls a plugin function that turns them into an
 * `Error` Value. `12/25/2026` on a day-first engine therefore answers "there
 * is no month 25" instead of 0.00, and `31/02/2026 + 1 day` reports the fault
 * rather than "1.01 day", because an Error operand propagates through the DAG
 * the way `faultedOperand` already makes it.
 *
 * Deliberately a plugin call rather than a new opcode. The refusal rides
 * `PUSH_STRING`, `PUSH_STRING`, `CALL_PLUGIN`, three things the bytecode
 * format already has, so `SerializedBytecode` keeps its shape and
 * `SNAPSHOT_VERSION` does not move for a behaviour change in the normaliser.
 * It is also a VALUE rather than a throw, which is what the non-throwing
 * evaluation paths require: a line that cannot be answered shows an error, it
 * does not take the document down.
 */
export class UnreadableDateParselet implements PrefixParselet {
  readonly category = "Date/Time";

  parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
    // The normaliser packed both halves into the token's one payload field.
    const fault = JSON.parse(token.value) as { code: string; message: string };
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(fault.code);
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(fault.message);
    builder.emitPluginCall("dateLiteralFault", 2);
  }
}
