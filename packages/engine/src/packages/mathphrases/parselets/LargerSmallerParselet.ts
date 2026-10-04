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
 * Each value is parsed at `BindingPower.Conjunction` so it stops at "and"
 * without also stopping at "+", which is what lets "larger of 1 + 1 and 3" be
 * written. See Token.ts's AND_CONJ comment.
 *
 * The phrase takes a list: `larger of 10 and 4 and 12` is 12. It used to read
 * two values and parse the second at the lowest power, so a third `and` became
 * the addition it also is, and the answer was 16 (#835). Every further `and`
 * now brings in another value, folded pairwise through the same builtin, which
 * is right for all four: the largest of three is the larger of the first two
 * and the third, and a greatest common divisor of three likewise.
 */
export function largerSmallerParselet(builtinIndex: number): PrefixParselet {
  return {
    category: "MathPhrases",
    parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
      parser.parseExpression(BindingPower.Conjunction, builder); // X
      parser.consume("AND_CONJ"); // "and"
      do {
        parser.parseExpression(BindingPower.Conjunction, builder); // Y, Z, ...
        builder.emitOpcode(OpCode.CALL_BUILTIN);
        builder.emitIndex(builtinIndex);
        builder.emitIndex(2);
      } while (parser.match("AND_CONJ"));
    },
  };
}
