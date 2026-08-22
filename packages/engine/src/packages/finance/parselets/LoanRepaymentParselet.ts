import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { parseTermAndRate } from "./TermRateClauses";

/**
 * `[daily|monthly|annual|total] repayment on <principal> over <years> at
 * <rate>%` and the `interest` variants, the standard mortgage/loan
 * amortization formula (see VMBuiltins.ts indices 52/53's `amortizeLoan()`
 * for the math, verified against real worked numbers).
 *
 * Triggered on 8 distinct fused tokens (`DAILY_REPAYMENT_ON`,
 * `MONTHLY_REPAYMENT_ON`, `ANNUAL_REPAYMENT_ON`, `TOTAL_REPAYMENT_ON`,
 * `DAILY_LOAN_INTEREST_ON`, `MONTHLY_LOAN_INTEREST_ON`,
 * `ANNUAL_LOAN_INTEREST_ON`, `TOTAL_LOAN_INTEREST_ON`. See
 * FinancePackage.ts's `phrases` field), one instance of this class per
 * token, each parameterized by which builtin to call and which
 * `periodsPerYear` divisor to push (365/12/1/0). Same
 * one-class-many-registrations shape as MathPhrases'
 * `VariadicAggregateParselet`/`ClampParselet`.
 *
 * Not `definePhrasePattern`-based for the same structural reason as
 * `CompoundInterestParselet` (the value comes right after the fused
 * trigger, not a keyword).
 *
 * Emits `[principal, years, rate]` in parse order, `SWAP`s to
 * `[principal, rate, years]` (matching the shared builtins'
 * `(principal, rate, years, periodsPerYear)` signature. See
 * CompoundInterestParselet.ts's doc comment for why), then pushes the
 * literal `periodsPerYear` constant before the CALL_BUILTIN.
 */
export class LoanRepaymentParselet implements PrefixParselet {
  readonly category = "Finance";

  constructor(
    private readonly builtinIndex: number,
    private readonly periodsPerYear: number,
  ) {}

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    parser.parseExpression(BindingPower.Lowest, builder); // principal
    // The term (`over <years>`) and the rate (`at <rate>`) in either order, so
    // `monthly repayment on 200000 at 4% over 25 years` reads as well as
    // `... over 25 years at 4%` (#120).
    const { swap } = parseTermAndRate(parser, builder, ["OVER"]);

    // The builtins take `(principal, rate, years, periodsPerYear)`; the term-first
    // order reaches `[principal, rate, years]` only after a SWAP of the top two,
    // the rate-first order is already there.
    if (swap) builder.emitOpcode(OpCode.SWAP);

    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(this.periodsPerYear);

    builder.emitOpcode(OpCode.CALL_BUILTIN);
    builder.emitIndex(this.builtinIndex);
    builder.emitIndex(4);
  }
}
