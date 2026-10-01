import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { periodOf, WEEKDAY_TOKEN_DAY } from "@solve-js/packages/datetime/normalizer/SpokenDateRules";

/** The plugin function that finds a period's first or last day. See `SpokenDateFunctions.ts`. */
export const PERIOD_EDGE_FN = "periodEdge";
/** The plugin function that finds the coming weekday. See `SpokenDateFunctions.ts`. */
export const THIS_WEEKDAY_FN = "thisWeekday";

/** Emit the call for a period's first or last day, read from now. */
function emitPeriodEdge(builder: BytecodeBuilder, kind: string, offset: number, edge: "start" | "end"): void {
	builder.emitOpcode(OpCode.DATE_NOW);
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(kind);
	builder.emitOpcode(OpCode.PUSH_NUMBER);
	builder.emitNumber(offset);
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(edge);
	builder.emitPluginCall(PERIOD_EDGE_FN, 4);
}

/**
 * `next week`, `this year`, `last year` (#704): the first day of that period,
 * as `next month` is the first of that month. A week starts on Monday.
 */
export class PeriodAnchorParselet implements PrefixParselet {
	readonly category = "Date/Time";
	constructor(private readonly kind: "week" | "year", private readonly offset: number) {}

	parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		emitPeriodEdge(builder, this.kind, this.offset, "start");
	}
}

/**
 * `start of month`, `end of next year` (#704): the first or last day of the
 * period after `of`, which the normalizer rule has checked is one.
 */
export class PeriodEdgeParselet implements PrefixParselet {
	readonly category = "Date/Time";
	constructor(private readonly edge: "start" | "end") {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		const period = periodOf(parser.consume());
		if (period === null) {
			throw ErrorFactory.parsing("PERIOD_EXPECTED", `Expected a week, month or year after "of", as in "end of month" or "start of next year"`);
		}
		emitPeriodEdge(builder, period.kind, period.offset, this.edge);
	}
}

/**
 * `this friday` (#704), and a weekday name inside a date expression (`friday +
 * 2 days`, `days until friday`): the coming day of that name, today when today
 * is one, at the time of day now is, as `next friday` carries it.
 *
 * A weekday name alone on a line is left as text, so a note can head a day with
 * it: `Friday` on its own is a heading, not a date. `this friday` alone is a
 * date.
 */
export class ThisWeekdayParselet implements PrefixParselet {
	readonly category = "Date/Time";
	constructor(private readonly bare: boolean) {}

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const day = this.bare ? WEEKDAY_TOKEN_DAY[token.type] : Number(token.value);
		if (this.bare && parser.peek() === undefined && parser.peekAt(-2) === undefined) {
			throw ErrorFactory.parsing(
				"WEEKDAY_ALONE",
				`A day of the week on its own is read as text, so a note can head a day with it. For the date, write "this ${String(token.text).toLowerCase()}" or "next ${String(token.text).toLowerCase()}".`,
			);
		}
		builder.emitOpcode(OpCode.DATE_NOW);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(day);
		builder.emitPluginCall(THIS_WEEKDAY_FN, 2);
	}
}
