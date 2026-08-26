import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/** The three units a years/months/days breakdown is written in. */
const YMD_UNITS = new Set(["year", "years", "month", "months", "day", "days"]);

/**
 * `age of <date>` / `age of <date> on <date>` / `age of <date> in years,
 * months and days` (wiki: Datetime), a person's age as whole calendar years,
 * or the full years/months/days breakdown.
 *
 * The `age of` phrase fuses to the `AGE_OF` token this handles; the birth date
 * follows. An optional `on <date>` gives the date to reckon the age at (the
 * default is now), and an optional `in years, months and days` asks for the
 * three-part breakdown instead of a single year count.
 *
 * The birth and reference dates are parsed at a tight binding power on purpose:
 * it stops the parse at the bare `on` and `in` that follow, so this reads them
 * itself rather than letting the `in` unit-conversion operator or implicit
 * multiplication claim the words first. The `ageBetween` handler walks the
 * calendar (see `DateArithmetic.ts`), so the leap cases are right where a
 * fixed-length division would drift.
 */
export class AgeParselet implements PrefixParselet {
	readonly category = "Date/Time";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		// The birth date. Postfix binding leaves `on`/`in` for the reads below.
		parser.parseExpression(BindingPower.Postfix, builder);

		// `on <date>`: the date to reckon age at. Default is now.
		if (this.wordIs(parser.peek(), "on")) {
			parser.consume();
			parser.parseExpression(BindingPower.Postfix, builder);
		} else {
			builder.emitOpcode(OpCode.DATE_NOW);
		}

		// `in years, months and days`: the three-part breakdown.
		const mode = this.consumeBreakdown(parser) ? "ymd" : "years";

		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(mode);
		builder.emitPluginCall("ageBetween", 3);
	}

	/** Whether a token is the given bare word (case-insensitively). */
	private wordIs(token: Token | undefined, word: string): boolean {
		if (!token) return false;
		return String(token.value ?? token.text ?? "").toLowerCase() === word;
	}

	/**
	 * Consumes a trailing `in years, months and days` (in any comma/`and`
	 * arrangement, and any subset of the three units), returning whether one was
	 * there. Reads the raw tokens rather than an expression, so the `in` never
	 * reaches the unit-conversion operator.
	 */
	private consumeBreakdown(parser: Parser): boolean {
		if (parser.peek()?.type !== "IN") return false;
		// Look past the `in` for at least one of the breakdown units before
		// committing, so a genuine `in <unit>` conversion is left alone.
		parser.consume(); // the `in`
		let sawUnit = false;
		for (;;) {
			const next = parser.peek();
			if (!next) break;
			const word = String(next.value ?? next.text ?? "").toLowerCase();
			if (next.type === "UNIT" && YMD_UNITS.has(word)) {
				sawUnit = true;
				parser.consume();
			} else if (next.type === "COMMA" || next.type === "AND_CONJ" || word === "and") {
				parser.consume();
			} else {
				break;
			}
		}
		return sawUnit;
	}
}
