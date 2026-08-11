import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `average of X, Y, Z` / `median of X, Y, Z` / `total of X, Y, Z` /
 * `count of X, Y, Z`, a comma-separated argument list, same shape as a
 * function call but without parens.
 *
 * Triggered on a fused `AVERAGE_OF`/`MEDIAN_OF`/`TOTAL_OF`/`COUNT_OF`
 * token (the literal phrase "average of" etc., fused by
 * `MathPhrasesPackage.ts`'s `phrases` field) rather than a bare
 * "average"/"total"/... keyword. See MathPhrasesPackage.ts's doc comment
 * for why: those are common variable names, and this codebase has a
 * tested policy against claiming common words as bare keywords when a
 * phrase-fused alternative is available. By the time `parse()` runs here,
 * "average of" is already fully consumed, only the comma-list remains.
 *
 * Not built on {@link definePhrasePattern}: that builder's slots are a
 * fixed sequence, with no support for a variable-length repeated slot
 * "X, Y, Z, ..." is open-ended, exactly like `FunctionCallParselet`'s own
 * comma loop (reused here rather than reinvented).
 */
export class VariadicAggregateParselet implements PrefixParselet {
  readonly category = "MathPhrases";

  constructor(private readonly builtinIndex: number) {}

  parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    let argCount = 0;
    // Arguments are parsed at `Conjunction`, the level "and" itself binds at,
    // rather than at `Lowest`, so that the trailing "and" of an English list
    // ("36, 42, 19 and 81") ends an argument instead of being consumed as the
    // addition it also is. `+` binds tighter (`Sum`), so "average of 1 + 2, 3"
    // still gets 1 + 2 as one argument.
    //
    // Parsing at `Lowest` is what made "average of 36, 42, 19 and 81" return
    // 59.33: it read three arguments, the last being 19 + 81, and divided 178
    // by 3. Soulver returns 44.5.
    parser.parseExpression(BindingPower.Conjunction, builder);
    argCount++;
    while (parser.match("COMMA") || parser.match("AND_CONJ")) {
      parser.parseExpression(BindingPower.Conjunction, builder);
      argCount++;
    }

    builder.emitOpcode(OpCode.CALL_BUILTIN);
    builder.emitIndex(this.builtinIndex);
    builder.emitIndex(argCount);
  }
}
