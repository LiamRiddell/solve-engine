import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `<rate> on <base>` and `<rate> off <base>`: a markup or a discount with the
 * rate stated first.
 *
 *   10% on 200    220
 *   10% off 200   180
 *
 * The same answers as `200 + 10%` and `200 - 10%`, said the other way round.
 * Both orders exist because both get written, and only one of them worked.
 *
 * Binds at `Conditional`, below arithmetic, so the base is the whole
 * expression after it.
 */
export class OnOffBaseParselet implements InfixParselet {
	readonly category = "Percentage";
	readonly bindingPower = BindingPower.Conditional;

	/** @param sign - `1` for a markup (`on`), `-1` for a discount (`off`). */
	constructor(private readonly sign: 1 | -1) {}

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Conditional, builder); // base

		// stack: rate, base. Result is base × (1 ± rate), and the rate is
		// underneath, so the 1 ± rate is built first and then multiplied.
		builder.emitOpcode(OpCode.SWAP); // base, rate
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(1);
		if (this.sign === 1) {
			builder.emitOpcode(OpCode.ADD);
		} else {
			// 1 - rate needs the 1 on the left of the subtraction.
			builder.emitOpcode(OpCode.SWAP);
			builder.emitOpcode(OpCode.SUB);
		}
		builder.emitOpcode(OpCode.MUL);
	}
}
