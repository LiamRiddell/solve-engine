import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/** The plugin function the three spellings all land on. */
export const WEEKDAY_COUNT_FN = "weekdaysBetween";

/**
 * `fridays between A and B`, `mondays until <date>`, `sundays since <date>`:
 * how many times a weekday falls in a range.
 *
 * Handles the fused `WEEKDAY_BETWEEN`/`WEEKDAY_UNTIL`/`WEEKDAY_SINCE` tokens
 * from {@link weekdayCountNormalizerRule}, whose value is the weekday index.
 *
 * The three spellings differ only in where the second endpoint comes from, so
 * they share one plugin function and one counting rule. `until` and `since`
 * measure against now, exactly as {@link UntilSinceParselet} does, and the count
 * has no direction: a weekday falls in a range the same number of times
 * whichever end you start from, so neither needs the operand order the signed
 * span forms are careful about.
 *
 * `and` lexes to PLUS, the word form of addition, so the first endpoint is
 * parsed at a binding power that stops before it, the same care
 * {@link DurationBetweenParselet} takes.
 */
export class WeekdayCountParselet implements PrefixParselet {
	readonly category = "Date/Time";

	constructor(private readonly form: "between" | "now") {}

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		if (this.form === "between") {
			parser.parseExpression(BindingPower.Product, builder); // first endpoint
			parser.consume("AND_CONJ"); // "and"
			parser.parseExpression(BindingPower.Lowest, builder); // second endpoint
		} else {
			builder.emitOpcode(OpCode.DATE_NOW);
			parser.parseExpression(BindingPower.Lowest, builder); // the target date
		}

		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(Number(token.value));
		builder.emitPluginCall(WEEKDAY_COUNT_FN, 3);
	}
}
