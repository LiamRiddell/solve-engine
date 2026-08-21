import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * The uncertainty operator, `a ± b` (or the ASCII `a +/- b`), which builds a
 * measurement carrying a one-sigma tolerance.
 *
 * A Tier-2 infix parselet: the center is already on the stack as `left`, so this
 * parses the spread and emits MAKE_UNCERTAIN to pair them. It binds at
 * {@link BindingPower.Uncertainty}, tighter than `+ - * /` and looser than `^`,
 * so the tolerance attaches to the values either side of it (see that level's
 * own comment for the worked cases). Left-associative: the right operand is
 * parsed at this same power, so a rare chain like `1 ± 0.1 ± 0.2` groups left.
 */
export class UncertaintyParselet implements InfixParselet {
  readonly category = "operator";
  readonly bindingPower = BindingPower.Uncertainty;

  parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
    // Parse the spread at this operator's own power, so the chain groups left
    // rather than swallowing a following `±`.
    parser.parseExpression(this.bindingPower, builder);
    builder.emitOpcode(OpCode.MAKE_UNCERTAIN);
  }
}
