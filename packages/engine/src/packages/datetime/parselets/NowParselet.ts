import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * `now` / `today` (dayOffset 0), `tomorrow` (+1 day), `yesterday` (-1 day).
 *
 * `now` reads the clock (DATE_NOW). `today` and the two days either side of it
 * start from DATE_TODAY, which is the same instant by default and the start of
 * the day under `date.relativeDays: 'midnight'`, so a host that plans by the
 * day sees `tomorrow` as a date. See `calendar/RelativeDays.ts`.
 *
 * Previously all four keywords shared one zero-offset implementation
 * "tomorrow"/"yesterday" silently evaluated to the exact same instant as
 * "now" (a real bug: `evaluate("tomorrow") - evaluate("now")` was 0, not
 * ~86400000ms). Existing tests never caught this because they only
 * checked internal consistency (e.g. `"yesterday + 1 day" - "yesterday"
 * === 1 day`), which holds regardless of what "yesterday" itself resolves
 * to. dayOffset must stay applied at evaluation time (ADD on top of
 * DATE_NOW or DATE_TODAY), not baked in at parse time, so "now"/"tomorrow"/"yesterday"
 * stay relative to whenever the bytecode actually runs.
 *
 * The offset is emitted as a duration IN DAYS rather than as its length in
 * milliseconds. It used to be `dayOffset * 24 * 60 * 60 * 1000`, which is only
 * a day long when no daylight-saving transition falls inside it: on the day a
 * zone springs forward "tomorrow" was really 23 hours away and on the day it
 * falls back 25, so the answer was an hour out and could name the wrong
 * calendar day outright. Tagging the number with "days" hands the decision to
 * the ADD opcode, which steps the calendar day field instead (see
 * `vm/VM.ts`'s shiftDatetime()). The same `PUSH_NUMBER; PUSH_STRING;
 * UOM_CONVERT` trio any unit literal compiles to (see UomLiteralParselet).
 */
export class NowParselet implements PrefixParselet {
	readonly category = "Date/Time";
	private readonly dayOffset: number;
	private readonly anchor: OpCode.DATE_NOW | OpCode.DATE_TODAY;

	/**
	 * @param dayOffset - Whole days from the anchor: 1 for `tomorrow`.
	 * @param anchor - `"now"` for the keyword `now`, `"today"` for the days counted from today.
	 */
	constructor(dayOffset: number = 0, anchor: "now" | "today" = "today") {
		this.dayOffset = dayOffset;
		this.anchor = anchor === "now" ? OpCode.DATE_NOW : OpCode.DATE_TODAY;
	}

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    builder.emitOpcode(this.anchor);
    if (this.dayOffset !== 0) {
      builder.emitOpcode(OpCode.PUSH_NUMBER);
      builder.emitNumber(this.dayOffset);
      builder.emitOpcode(OpCode.PUSH_STRING);
      builder.emitString("days");
      builder.emitOpcode(OpCode.UOM_CONVERT);
      builder.emitOpcode(OpCode.ADD);
    }
  }
}
