import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { Value, errorValue } from "@solve-js/vm/Value";
import { TimeFormErrorCodes } from "../TimeFormErrorCodes";
import { emitBuiltinPluginCall } from "@solve-js/packages/SynchronousPluginFunctions";

/** The plugin function a refused ISO 8601 duration compiles to. */
export const ISO_DURATION_FAULT_FN = "isoDurationFault";

/**
 * One part of an ISO 8601 duration (#760), pushed as the quantity it is: the
 * `ISO_DURATION` token `30 minutes` pushes thirty minutes.
 *
 * The amount is read with `Number`, not through the locale's number reading,
 * because it was written in the duration's own grammar, where the decimal mark
 * is a point or a comma whatever the engine's locale (the normaliser has
 * already turned a comma into a point). A German engine reads `PT0,5S` and
 * `PT0.5S` alike, as the standard says it must.
 */
export class IsoDurationParselet implements PrefixParselet {
	readonly category = "Time";

	parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const space = token.value.indexOf(" ");
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(Number(token.value.slice(0, space)));
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value.slice(space + 1));
		builder.emitOpcode(OpCode.UOM_CONVERT);
	}
}

/**
 * A duration-shaped identifier that breaks the grammar (`P1H`, `PT1D`), compiled
 * to the Error value that says why, the way `UnreadableDateParselet` compiles
 * a date that names no day: a value rather than a throw, so the line shows the
 * refusal and the document carries on, and no new opcode.
 */
export class UnreadableIsoDurationParselet implements PrefixParselet {
	readonly category = "Time";

	parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const fault = token.fault ?? { code: TimeFormErrorCodes.ISO_DURATION_MALFORMED, message: `${token.value} is not an ISO 8601 duration.` };
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(fault.code);
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(fault.message);
		emitBuiltinPluginCall(builder, ISO_DURATION_FAULT_FN, 2);
	}
}

/**
 * The `isoDurationFault` plugin: the code and the reason the normaliser hung
 * on a refused duration, as an Error value. Nothing is decided here.
 *
 * @param args - The code, then the message.
 */
export function isoDurationFaultHandler(args: Value[]): Value {
	return errorValue(String(args[0]?.value ?? TimeFormErrorCodes.ISO_DURATION_MALFORMED), String(args[1]?.value ?? ""));
}
