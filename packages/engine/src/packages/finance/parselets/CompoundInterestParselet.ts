import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { readCompoundingInterval } from "./InvestmentParselets";
import { parseTermAndRate } from "./TermRateClauses";

/**
 * `compound interest on <principal> over <years> at <rate>%` -> future
 * value, and `interest on <principal> over <years> at <rate>%` -> interest
 * earned only. Triggered on the fused `COMPOUND_INTEREST_ON`/`INTEREST_ON`
 * tokens (see FinancePackage.ts's `phrases` field) rather than a bare
 * "interest"/"compound" keyword, "interest" is a very plausible variable
 * name (see FinancePackage.ts's doc comment), so it's phrase-fused instead
 * of claimed as a bare keyword, matching MathPhrasesPackage.ts's
 * established pattern.
 *
 * NOT built on {@link definePhrasePattern}: that builder requires every
 * alternative's first slot to be a `keyword`, but here the value
 * (`principal`) comes immediately after the fused trigger token, there's
 * no keyword to peek at until AFTER `principal` is already parsed. Same
 * structural reason `ClampParselet` is hand-written (see its doc comment).
 *
 * `over`/`at` are ordinary bare keywords here (not phrase-fused). See
 * Token.ts's OVER/RATE_AT doc comment for why that's safe. No "and"
 * (PLUS-collision) guard is needed anywhere in this grammar since neither
 * connector word is "and".
 *
 * The grammar parses in `principal, years, rate` order (forced by the
 * word order "on P over Y at R%"), but this package's shared
 * `compoundFutureValue`/`compoundInterestEarned` builtins (VMBuiltins.ts
 * indices 48/49) take `(principal, rate, years)`, matching the
 * function-call form `compoundInterest(principal, rate, years)` the task
 * asked for. The `SWAP` below reorders the top two stack values
 * (`[principal, years, rate]` -> `[principal, rate, years]`) right before
 * the builtin call so both call styles share one implementation.
 *
 * This parselet used to be the only way to reach compound interest, using
 * "over" where Soulver documents "after"/"for", and requiring the leading
 * "compound interest on"/"interest on" verb where Soulver has none. That was
 * recorded here as a deliberate deviation, and it meant that every expression
 * on Soulver's investments page threw.
 *
 * It is closed. `InvestmentParselets.ts` adds the bare `$1,000 after 3 years
 * at 7%` form, the `for ... compounding monthly` interval variant, present
 * value and return on investment. This parselet keeps its "compound interest
 * on X over Y at Z%" spelling so nothing that already parsed stops, and now
 * also accepts "after"/"for" and the "@" rate separator.
 */
export class CompoundInterestParselet implements PrefixParselet {
  readonly category = "Finance";

  /**
   * @param builtinIndex - Annual-compounding builtin.
   * @param intervalIndex - Builtin taking an explicit periods-per-year, used
   * when the expression ends in "compounding monthly" or similar.
   */
  constructor(
    private readonly builtinIndex: number,
    private readonly intervalIndex: number,
  ) {}

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    // Above `Conditional`, which is where InvestmentGrowthParselet registers
    // "after"/"for". Parsed at `Lowest` the principal would swallow the whole
    // "after 3 years at 7%" tail as its own investment expression, and this
    // parselet would then run out of input looking for the connective.
    parser.parseExpression(BindingPower.Conditional, builder); // principal
    // The term (`over`/`after`/`for <years>`) and the rate (`at <rate>`) in
    // either order, so `interest on 1000 at 5% over 3 years` reads as naturally
    // as `... over 3 years at 5%` (#120). "over" was this package's own
    // substitution for Soulver's "after"/"for" (see the DEVIATION note above);
    // all three are accepted.
    const { swap } = parseTermAndRate(parser, builder, ["AFTER", "FOR_DURATION", "OVER"]);
    const periods = readCompoundingInterval(parser);

    // The builtins take `(principal, rate, years)`, which the term-first order
    // reaches only after a SWAP of the top two; the rate-first order is already
    // in that order.
    if (swap) builder.emitOpcode(OpCode.SWAP);

    if (periods === 1) {
      builder.emitOpcode(OpCode.CALL_BUILTIN);
      builder.emitIndex(this.builtinIndex);
      builder.emitIndex(3);
      return;
    }
    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(periods);
    builder.emitOpcode(OpCode.CALL_BUILTIN);
    builder.emitIndex(this.intervalIndex);
    builder.emitIndex(4);
  }
}
