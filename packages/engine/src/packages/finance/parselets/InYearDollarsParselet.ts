import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * Infix parselet for the fused `IN_YEAR_DOLLARS` token (see
 * `normalizer/InYearDollarsNormalizerRule.ts`, fuses "in <year> dollars"
 * into one token carrying the year as its value). Backs `$X in <year>
 * dollars`, express a present-day amount in a specific historical year's
 * dollars. Mathematically identical to `what was $X worth in <year>`
 * (`InflationQueryParselet`'s "what-was" variant), but it calls its own
 * `inflationToYearDollars` plugin function, since the phrase names dollars:
 * an amount in pounds or euros is refused with the form that reads its own
 * index rather than answered in its currency (#756).
 *
 * Binding power 35, matching the currency/UoM package's `InParselet` tier
 *. This parselet only ever fires on the ALREADY-FUSED `IN_YEAR_DOLLARS`
 * token (the bare `IN` token from the original "in <year> dollars" text
 * no longer exists in the stream by the time the parser runs), so there
 * is no runtime collision with `InParselet` to guard against here.
 */
export class InYearDollarsParselet implements InfixParselet {
  readonly category = "Finance";
  readonly bindingPower = 35;

  parse(parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
    const year = Number(token.value);
    builder.emitOpcode(OpCode.PUSH_NUMBER);
    builder.emitNumber(year);
    builder.emitPluginCall("inflationToYearDollars", 2);
  }
}
