import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `<quantity> per <unit>`, a rate.
 *
 * Triggered on the fused `PER_UNIT` token, which only exists where a
 * denominator was written with no number. The rate is built directly rather
 * than by dividing, because dividing makes same-measure units cancel and
 * `3 hours / day` would come out as 0.125.
 *
 * Binds at `Product`, the same level division binds at, so a rate sits where a
 * division would have and the surrounding arithmetic is unchanged.
 */
export class PerUnitParselet implements InfixParselet {
	readonly category = "Uom";
	readonly bindingPower = BindingPower.Product;

	constructor(private readonly builtinIndex: number) {}

	parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(String(token.value));
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(this.builtinIndex);
		builder.emitIndex(2);
	}
}
