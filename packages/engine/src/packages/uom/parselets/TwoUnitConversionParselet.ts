import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `12.5 minutes in minutes and seconds`, one quantity split across two units.
 *
 * Every other conversion produces a single number in a single unit, so this
 * could not be expressed at all: `in minutes` loses the seconds and
 * `in seconds` loses the readability. Splitting is what makes
 * `4.5 weeks in days and hours` say something a person can act on.
 *
 * Triggered on a fused `IN_TWO_UNITS` token rather than on `in` itself, so the
 * ordinary single-unit conversion is untouched and does not have to look ahead
 * for an `and` that is usually not there. The two unit names ride on the token,
 * separated by a space, since the normalizer has already read them.
 */
export class TwoUnitConversionParselet implements InfixParselet {
	readonly category = "Uom";
	readonly bindingPower = BindingPower.Conditional;

	constructor(private readonly builtinIndex: number) {}

	parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		const [major, minor] = String(token.value).split(" ");
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(major);
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(minor);
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(this.builtinIndex);
		builder.emitIndex(3);
	}
}
