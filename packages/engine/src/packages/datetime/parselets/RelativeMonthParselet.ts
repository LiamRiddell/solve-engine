import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * `next month` / `this month` / `last month`, the first of the month that many
 * months either side of now, as a Datetime.
 *
 * Resolves to the first of the month, the same anchor `March 2026` resolves to,
 * so the two are interchangeable wherever a month is wanted, in particular as
 * the anchor of `1st Monday of next month` ({@link NthWeekdayParselet}). The
 * offset is fixed at parse time (+1/0/-1); the month itself is computed at
 * evaluation from `now`, because now can only be read when the bytecode runs.
 *
 * The three phrases fuse to distinct token types in the package (a phrase
 * carries no payload), each bound to one instance of this parselet.
 */
export class RelativeMonthParselet implements PrefixParselet {
	readonly category = "Date/Time";
	constructor(private readonly offsetMonths: number) {}

	parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.DATE_NOW);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(this.offsetMonths);
		builder.emitPluginCall("monthAnchorShift", 2);
	}
}
