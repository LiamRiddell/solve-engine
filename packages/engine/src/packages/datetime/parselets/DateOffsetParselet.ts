import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { DATE_OFFSET_PART_TYPE } from "../normalizer/DateOffsetNormalizerRule";

/**
 * `<duration> from | after | before <date>`, the everyday spelling of a date
 * offset.
 *
 * INFIX, not prefix, for the reason {@link WorkdayOffsetParselet} is: the count
 * comes first, so by the time this runs the Pratt loop has already compiled it
 * as the left operand. The unit went into the fused token
 * ({@link dateOffsetNormalizerRule}), so the count arrives as a bare number and
 * is given its unit back here, through the same conversion that reads
 * `12 in ft`.
 *
 * The arithmetic is the engine's own date arithmetic, unchanged: `after` and
 * `from` are `<date> + <duration>` and `before` is `<date> - <duration>`, so the
 * month clamping and the holiday-free calendar walk are whatever
 * `3 March 2026 + 30 days` already does. Only the spelling is new.
 *
 * Addition takes its operands either way round, so the forward direction needs
 * no reordering. Subtraction does, which is what the swap is for: a date minus
 * a duration is a date, and a duration minus a date is not a question.
 */
export class DateOffsetParselet implements InfixParselet {
	readonly category = "Date/Time";
	readonly bindingPower = BindingPower.Conditional;

	/** @param direction "forward" for after/from, "backward" for before. */
	constructor(private readonly direction: "forward" | "backward") {}

	parse(parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		// The bare count is on the stack; put its unit back on it.
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value);
		builder.emitOpcode(OpCode.UOM_CONVERT_IN);

		// The further parts of `1 month 1 day after`, applied after the first.
		const parts: Token[] = [];
		while (parser.peek()?.type === DATE_OFFSET_PART_TYPE) parts.push(parser.consume());

		// The anchor date, parsed at `Sum` so a bare date term binds as the
		// anchor and a trailing `+ <duration>` applies to the result, matching
		// the working-day spelling.
		parser.parseExpression(BindingPower.Sum, builder);

		const step = this.direction === "backward" ? OpCode.SUB : OpCode.ADD;
		if (this.direction === "backward") {
			// [duration, date] becomes [date, duration], so SUB reads as the date
			// minus the duration rather than the other way about.
			builder.emitOpcode(OpCode.SWAP);
		}
		builder.emitOpcode(step);
		// Each further part moves the date the same way, largest first, so
		// `1 month 1 day after` is the date plus a month, then plus a day.
		for (const part of parts) {
			const space = part.value.indexOf(" ");
			builder.emitOpcode(OpCode.PUSH_NUMBER);
			builder.emitNumber(Number(part.value.slice(0, space)));
			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(part.value.slice(space + 1));
			builder.emitOpcode(OpCode.UOM_CONVERT);
			builder.emitOpcode(step);
		}
	}
}
