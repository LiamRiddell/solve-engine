import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * The `of` in `15% of 2400`.
 *
 * A plain multiply once the left side is already a fraction, which is what
 * {@link PercentParselet} leaves on the stack. Product binding power keeps
 * `10% of 200 + 5` reading as `(10% of 200) + 5`.
 */
export class OfParselet implements InfixParselet {
	readonly category = "Percentage";
	readonly bindingPower = BindingPower.Product;

  parse(parser: Parser, left: Token, token: Token, builder: BytecodeBuilder): void {
    parser.parseExpression(this.bindingPower, builder);
    builder.emitOpcode(OpCode.MUL);
  }
}
