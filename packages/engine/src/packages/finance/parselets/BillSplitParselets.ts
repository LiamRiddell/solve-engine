import { PrefixParselet, InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `split <amount> between <N> [people]`, the per-person bill split written with
 * the verb first. Triggered on the `SPLIT` token that BillSplitNormalizerRule
 * retypes the ordinary word `split` to, only inside this shape, so `split` stays
 * an ordinary word and variable name everywhere else. Both `between` and a
 * trailing `people` are consumed here: `between` is the engine's pre-existing
 * bare keyword, and `people` is the `PEOPLE` token the normalizer retypes so the
 * count does not read as `N * people`.
 *
 * Not `definePhrasePattern`-based, for the same structural reason as
 * `SalesTaxParselet`: the value comes right after the trigger, not a keyword.
 * The amount and the count parse at `Lowest`, so each is a whole expression up
 * to the next keyword, and `split $120 + $5 between 3` splits the $125.
 */
export class SplitBetweenParselet implements PrefixParselet {
  readonly category = "Finance";

  constructor(private readonly builtinIndex: number) {}

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    parser.parseExpression(BindingPower.Lowest, builder); // amount
    parser.consume("BETWEEN");
    parser.parseExpression(BindingPower.Lowest, builder); // number of shares
    parser.match("PEOPLE"); // optional trailing "people"

    builder.emitOpcode(OpCode.CALL_BUILTIN);
    builder.emitIndex(this.builtinIndex);
    builder.emitIndex(2);
  }
}

/**
 * `<amount> split <N> ways`, the same split written with the amount first.
 *
 * Infix on the `SPLIT` token, so the amount is the left operand, with a binding
 * power of `Conditional` (below arithmetic) exactly like `InvestmentGrowthParselet`
 * and `ReturnOnInvestmentParselet`: in `$120 + 18% split 3 ways` the `+` and the
 * `%` bind first, so the whole `$120 + 18%` (an exact `$141.60`) is what gets
 * split, not the `18%` alone. The count parses at `Conditional` and stops at the
 * `WAYS` token the normalizer retyped `ways` to.
 */
export class SplitWaysParselet implements InfixParselet {
  readonly category = "Finance";
  readonly bindingPower = BindingPower.Conditional;

  constructor(private readonly builtinIndex: number) {}

  parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
    // The amount is already on the stack: this is an infix.
    parser.parseExpression(BindingPower.Conditional, builder); // number of shares
    parser.consume("WAYS");

    builder.emitOpcode(OpCode.CALL_BUILTIN);
    builder.emitIndex(this.builtinIndex);
    builder.emitIndex(2);
  }
}
