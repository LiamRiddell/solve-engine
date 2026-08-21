import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `working/business days between <date> and <date>`, the count of working days
 * in that window ("working days between 1 Jan and 31 Jan").
 *
 * The working-day sibling of {@link DurationBetweenParselet}: same two-endpoint
 * shape, same "and" handling (see that file's note on why "and" lexes to
 * `AND_CONJ` and why the first endpoint is parsed at `Product` so it stops
 * before the conjunction), but the result is a plain count of working days
 * rather than a calendar-day span. Handles the fused `WORKDAYS_BETWEEN` token
 * from the package's `phrases` field, which consumes the whole "working days
 * between" so the bare `days between` rule never claims the "days".
 *
 * Emits `DATE_WORKDAYS_BETWEEN` (see vm/VM.ts), which counts inclusively of
 * both endpoints, order-independently, and skips weekends plus any host-
 * configured holidays. Count, not duration: a working-day total is a whole
 * number that no `Uom` span can carry without re-introducing the weekends it
 * excludes.
 */
export class WorkdaysBetweenParselet implements PrefixParselet {
  readonly category = "Date/Time";

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    parser.parseExpression(BindingPower.Product, builder); // first endpoint, stops before "and"
    parser.consume("AND_CONJ"); // "and"
    parser.parseExpression(BindingPower.Lowest, builder); // second endpoint
    builder.emitOpcode(OpCode.DATE_WORKDAYS_BETWEEN);
  }
}
