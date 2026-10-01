import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { emitBuiltinPluginCall } from "@solve-js/packages/SynchronousPluginFunctions";

/** The currencies `in <year> <currency>` names, by ISO code. */
export type InYearCurrency = "USD" | "GBP" | "EUR";

/**
 * Infix parselet for the fused `IN_YEAR_DOLLARS`, `IN_YEAR_POUNDS` and
 * `IN_YEAR_EUROS` tokens (see `normalizer/InYearMoneyNormalizerRule.ts`, which
 * fuses "in <year> dollars" and its pound and euro spellings into one token
 * carrying the year as its value). Backs `$X in <year> dollars`, `£X in <year>
 * pounds` and `€X in <year> euros`: a present-day amount expressed in a past
 * year's money. Mathematically identical to `what was $X worth in <year>`
 * (`InflationQueryParselet`'s "what-was" variant), but the phrase names its
 * currency, so the handler (`inflationToYearInCurrency`) refuses an amount in
 * another one rather than answering in it (#756).
 *
 * Binding power 35, matching the currency/UoM package's `InParselet` tier.
 * This parselet only ever fires on an ALREADY-FUSED token (the bare `IN`
 * token from the original text no longer exists in the stream by the time
 * the parser runs), so there is no runtime collision with `InParselet` to
 * guard against here.
 */
export class InYearMoneyParselet implements InfixParselet {
  readonly category = "Finance";
  readonly bindingPower = 35;

  /** @param currency - The currency the phrase names, which the amount must be in. */
  constructor(private readonly currency: InYearCurrency) {}

  parse(_parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
    const year = Number(token.value);
    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(year);
    builder.emitOpcode(OpCode.PUSH_STRING);
    builder.emitString(this.currency);
    emitBuiltinPluginCall(builder, "inflationToYearInCurrency", 3);
  }
}
