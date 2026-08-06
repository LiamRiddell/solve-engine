import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `<phrase> of X and Y`, a two-operand phrase front end for a builtin that
 * already exists. Backs `larger of`/`greater of` and `smaller of`/`lesser of`
 * (min/max, indices 9/10) and `gcd of`/`lcm of` (indices 38/39), reusing those
 * implementations rather than duplicating them.
 *
 * Triggered on a fused `LARGER_OF`/`SMALLER_OF` token (see
 * MathPhrasesPackage.ts's `phrases` field). NOT built on
 * {@link definePhrasePattern}: once "of" is fused into the trigger, the
 * next thing is X (an `expr`), not a keyword, the same structural
 * mismatch as `ClampParselet`/`IfThenElseParselet` (see their doc
 * comments), so this is hand-written too.
 *
 * X is parsed at `BindingPower.Conjunction` so it stops at "and" without also
 * stopping at "+", which is what lets "larger of 1 + 1 and 3" be written. See
 * Token.ts's AND_CONJ comment.
 */
export function largerSmallerParselet(builtinIndex: number): PrefixParselet {
  return {
    category: "MathPhrases",
    parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
      parser.parseExpression(BindingPower.Conjunction, builder); // X
      parser.consume("AND_CONJ"); // "and"
      parser.parseExpression(BindingPower.Lowest, builder); // Y
      builder.emitOpcode(OpCode.CALL_BUILTIN);
      builder.emitIndex(builtinIndex);
      builder.emitIndex(2);
    },
  };
}
