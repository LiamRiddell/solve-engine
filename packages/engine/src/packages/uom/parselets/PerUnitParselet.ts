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
 *
 * A denominator after a slash with nothing measured before it may be a
 * variable's name as well (`100 / t`, #642). Whether it is depends on the lines
 * above, which the parse cannot see, so it compiles to RATE_OR_DIVIDE and then
 * an ordinary DIV: at run time a defined variable of that name is divided by,
 * exactly as `100 / (t)` is, and otherwise the rate is built and the DIV is
 * stepped over.
 */
export class PerUnitParselet implements InfixParselet {
	readonly category = "Uom";
	readonly bindingPower = BindingPower.Product;

	constructor(private readonly builtinIndex: number) {}

	parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		if (token.mayNameVariable === true) {
			builder.emitOpcode(OpCode.RATE_OR_DIVIDE);
			builder.emitString(String(token.value));
			builder.emitIndex(this.builtinIndex);
			builder.emitOpcode(OpCode.DIV);
			return;
		}
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(String(token.value));
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(this.builtinIndex);
		builder.emitIndex(2);
	}
}
