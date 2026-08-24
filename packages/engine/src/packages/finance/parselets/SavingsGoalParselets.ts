import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/** A savings contribution period: how many fall in a year, and the unit the answer reads in. */
interface SavingsPeriod {
  readonly perYear: number;
  readonly unit: string;
}

/**
 * The contribution periods a savings goal accepts. `annually` reads as `yearly`.
 * The answer's unit is the period's own, so "how long to save ... weekly" is
 * counted and reported in weeks.
 */
const SAVINGS_PERIODS: Record<string, SavingsPeriod> = {
  daily: { perYear: 365, unit: "days" },
  weekly: { perYear: 52, unit: "weeks" },
  monthly: { perYear: 12, unit: "months" },
  yearly: { perYear: 1, unit: "years" },
  annually: { perYear: 1, unit: "years" },
};

/** Reads and consumes the contribution period word, naming the accepted set on a typo. */
function readSavingsPeriod(parser: Parser): SavingsPeriod {
  const token = parser.peek();
  const word = (token?.text ?? token?.value ?? "").toLowerCase();
  const period = SAVINGS_PERIODS[word];
  if (period === undefined) {
    throw ErrorFactory.parsing(
      "UNKNOWN_SAVINGS_PERIOD",
      `savings goal: expected a contribution period, one of ${Object.keys(SAVINGS_PERIODS).join(", ")}, not "${word || "?"}".`,
    );
  }
  parser.consume();
  return period;
}

/**
 * `how long to save <target> at <amount> <period> [at <rate>]`, answering the
 * number of whole periods to reach the target, in the contribution's own unit.
 *
 * The contribution parses at Product (the implicit-multiply level), so a `*`
 * inserted before a period word that is not a phrase-starter (`weekly`, `daily`,
 * `yearly`) is left unconsumed and then skipped, while `monthly` (which starts
 * `monthly repayment on`, so no `*` is inserted) reads with the skip a no-op.
 * Hand-written for the same reason as LoanRepaymentParselet: the value follows
 * the trigger, not a keyword.
 */
export class SavingsDurationParselet implements PrefixParselet {
  readonly category = "Finance";

  constructor(private readonly builtinIndex: number) {}

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    parser.parseExpression(BindingPower.Conditional, builder); // target
    if (!parser.match("RATE_AT")) parser.consume("AT"); // "at" before the contribution
    parser.parseExpression(BindingPower.Product, builder); // contribution amount
    parser.match("STAR"); // skip an implicit-multiply STAR before weekly/daily/...
    const period = readSavingsPeriod(parser);

    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(period.perYear);
    // An optional trailing "at <rate>", else a zero rate.
    if (parser.match("RATE_AT") || parser.match("AT")) {
      parser.parseExpression(BindingPower.Conditional, builder); // rate
    } else {
      builder.emitOpcode(OpCode.PUSH_NUMBER);
      builder.emitNumber(0);
    }
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(period.unit);

    // savingsGoalPeriods(target, contribution, periodsPerYear, annualRate, periodUnit)
    builder.emitOpcode(OpCode.CALL_BUILTIN);
    builder.emitIndex(this.builtinIndex);
    builder.emitIndex(5);
  }
}

/**
 * `how much per month to save|reach <target> in <duration> [at <rate>]`,
 * answering the level monthly contribution. The target parses at Conditional and
 * `in` is consumed here, so the currency-conversion `in` infix never fires, the
 * same guard PresentValueParselet uses.
 */
export class SavingsContributionParselet implements PrefixParselet {
  readonly category = "Finance";

  constructor(private readonly builtinIndex: number) {}

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    // Product, not Conditional: the bare `in` right after the target would
    // otherwise be swallowed by the currency package's conversion parselet, the
    // same guard InflationFutureValueParselet draws.
    parser.parseExpression(BindingPower.Product, builder); // target
    parser.consume("IN");
    parser.parseExpression(BindingPower.Conditional, builder); // duration (months/years)
    // An optional trailing "at <rate>", else a zero rate.
    if (parser.match("RATE_AT") || parser.match("AT")) {
      parser.parseExpression(BindingPower.Conditional, builder); // rate
    } else {
      builder.emitOpcode(OpCode.PUSH_NUMBER);
      builder.emitNumber(0);
    }

    // savingsGoalPayment(target, duration, annualRate)
    builder.emitOpcode(OpCode.CALL_BUILTIN);
    builder.emitIndex(this.builtinIndex);
    builder.emitIndex(3);
  }
}
