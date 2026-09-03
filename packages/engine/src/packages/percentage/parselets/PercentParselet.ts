import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * The postfix `%`, producing a Percentage-typed value holding the fraction.
 *
 * Postfix rather than a remainder operator, which is why `17 % 5` is a parse
 * error rather than 2: `17 %` is already complete. Use `mod` for remainder.
 *
 * This used to emit a literal divide-by-100, which made `10%` an ordinary
 * number 0.1 and `200 + 10%` therefore 200.10. Nobody writing that line means
 * 200.10; they mean 220, which is what Soulver answers. A percentage is only
 * meaningful relative to something, so it has to stay distinguishable from the
 * bare fraction long enough for the operator to apply it. The relative
 * behaviour lives in the VM's ADD/SUB, where the other operand is known.
 */
export class PercentParselet implements InfixParselet {
	readonly category = "Percentage";
	readonly bindingPower = BindingPower.Postfix;

  parse(parser: Parser, left: Token, token: Token, builder: BytecodeBuilder): void {
    // The divide still happens: a Percentage stores its fraction (0.1 for
    // 10%), and TO_PERCENTAGE only re-types what is already on the stack,
    // because it also backs `as %`, where `0.35 as %` is 35% and dividing
    // would be wrong.
    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(100);
    builder.emitOpcode(OpCode.DIV);
    builder.emitOpcode(OpCode.TO_PERCENTAGE);
  }
}
