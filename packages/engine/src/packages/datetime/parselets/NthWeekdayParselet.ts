import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `<ordinal> <weekday> of <month>` (wiki: Datetime, "2nd Tuesday of March
 * 2026", "last Friday of November 2026", "1st Monday of next month"), the
 * concrete date of the nth (or last) occurrence of a weekday in a month.
 *
 * The fused `NTH_WEEKDAY` token this handles is minted by
 * {@link nthWeekdayNormalizerRule}, which reads the ordinal in the text layer
 * (so `2nd`, lexed as a BigInt-plus-unit, needs no new lexer token) and carries
 * the ordinal and weekday as its value. That rule only fires when an `of`
 * follows the weekday, so the bare `last Friday`/`next Monday` occurrences stay
 * with {@link NextLastParselet}; this parselet consumes the `of` and parses the
 * month anchor.
 *
 * The anchor is parsed as an expression, not a fixed literal, so both the fixed
 * month (`March 2026`, a date literal at the first of the month) and the
 * relative ones (`next month`, {@link RelativeMonthParselet}) compose here.
 * Only the anchor's year and month are read by the `nthWeekdayOfMonth` handler.
 * A tight binding power keeps a trailing conversion (`... as weekday`) or offset
 * (`... + 1 week`) applying to the resulting date rather than being folded into
 * the anchor.
 */
export class NthWeekdayParselet implements PrefixParselet {
	readonly category = "Date/Time";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		parser.consume("OF"); // the `of` the normalizer rule left in place
		parser.parseExpression(BindingPower.Postfix, builder); // month anchor -> Datetime
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value); // "<n>:<dow>" or "last:<dow>"
		builder.emitPluginCall("nthWeekdayOfMonth", 2);
	}
}
