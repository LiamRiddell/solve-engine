import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * Logical negation (#751), in its two spellings.
 *
 * `not` binds loosely, as a word operator does in Python and SQL: its operand
 * is parsed at `Conjunction`, so a comparison belongs to it (`not a > b` is
 * `not (a > b)`) while `and`, `&&`, `or` and `||` end it (`not a and b` is
 * `(not a) and b`).
 *
 * A prefix `!` binds tightly, as it does in C and JavaScript: its operand is
 * parsed at `Prefix`, so `!(a > b)` needs its brackets and `!a > b` compares
 * the negation. After a value, `!` is still the factorial (`5!`); that is the
 * infix reading, which the parser takes before it ever looks for a prefix.
 *
 * The work is the `logicalNot` plugin function (see NotFunctions.ts), which
 * negates a boolean and refuses anything else by name.
 */
export class NotParselet implements PrefixParselet {
	readonly category = "Conditionals";

	/**
	 * @param spelling - `not` or `!`, quoted by the refusal.
	 * @param bindingPower - The level the operand is parsed at.
	 */
	constructor(
		private readonly spelling: string,
		private readonly bindingPower: number,
	) {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(this.bindingPower, builder);
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(this.spelling);
		builder.emitPluginCall("logicalNot", 2);
	}
}

/** `not <condition>`: the operand runs to the next `and` or `or`. */
export const notWordParselet = new NotParselet("not", BindingPower.Conjunction);

/** `!<value>`: the operand is the one value after it. */
export const bangParselet = new NotParselet("!", BindingPower.Prefix);
