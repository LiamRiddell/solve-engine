import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `midpoint between X and Y` -> (X + Y) / 2. Triggered on the fused
 * `MIDPOINT_BETWEEN` token (see MathPhrasesPackage.ts's `phrases` field).
 * Hand-written for the same reason as `LargerSmallerParselet`, once
 * "between" is fused into the trigger, X (an `expr`) comes next, not a
 * keyword, which `definePhrasePattern` can't start an alternative with.
 *
 * X is parsed at `BindingPower.Conjunction`, one step looser than `Sum`, so
 * that it stops at "and" without also stopping at "+". This used to be
 * `Product` for the same reason, back when the word "and" was the PLUS token
 * itself and nothing weaker could tell them apart; the cost was that
 * "midpoint between 100 + 50 and 300" could not be written, because the
 * operand slot gave up at the "+". See Token.ts's AND_CONJ comment.
 */
export const midpointParselet: PrefixParselet = {
  category: "MathPhrases",
  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    parser.parseExpression(BindingPower.Conjunction, builder); // X
    parser.consume("AND_CONJ"); // "and"
    parser.parseExpression(BindingPower.Lowest, builder); // Y
    builder.emitOpcode(OpCode.ADD);
    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(2);
    builder.emitOpcode(OpCode.DIV);
  },
};
