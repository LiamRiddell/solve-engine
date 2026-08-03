import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * The postfix `%`, dividing its operand by 100.
 *
 * Postfix rather than a remainder operator, which is why `17 % 5` is a parse
 * error rather than 2: `17 %` is already complete. Use `mod` for remainder.
 */
export class PercentParselet implements InfixParselet {
	readonly category = "Percentage";
	readonly bindingPower = BindingPower.Prefix;

  parse(parser: Parser, left: Token, token: Token, builder: BytecodeBuilder): void {
    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(100);
    builder.emitOpcode(OpCode.DIV);
  }
}
