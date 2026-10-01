import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { isKnownUnit } from "@solve-js/lexer/units";

/**
 * Whether the token after `to` names a conversion target (a unit, `in` for
 * inches, or `%`) rather than a value to add. The same test the percentage
 * change parselet makes before it reads `to` as a change.
 *
 * @param token - The token after `to`, or undefined at the end of the line.
 */
export function namesConversionTarget(token: Token | undefined): boolean {
	if (token === undefined) return false;
	if (token.type === "PERCENT" || token.type === "IN") return true;
	return (token.type === "UNIT" || token.type === "IDENT") && isKnownUnit(token.value);
}

/**
 * The prefix `+`, and `add A to B`, the word form of `A + B` (#829).
 *
 * `add` is the `+` keyword, so `add 3 to 10` was read as `+3 to 10`, a
 * percentage change, and answered 233.33%. When the word is `add` and a `to`
 * follows its operand, the two are added: `add 3 to 10` is 13. Without a `to`
 * the word keeps its old reading (`add 3 and 4` is 7, `add 3` is 3), and a
 * `to` followed by a unit is still a conversion (`add 5 km to m`). The symbol
 * `+` is a unary plus and nothing else.
 */
export class AddToParselet implements PrefixParselet {
	readonly category = "Arithmetic";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const word = (token.text ?? token.value ?? "").toLowerCase() === "add";
		if (!word) {
			parser.parseExpression(BindingPower.Prefix, builder);
			builder.emitOpcode(OpCode.POS);
			return;
		}
		// Parsed at the level `to` binds at, so the operand stops before it.
		parser.parseExpression(BindingPower.Conditional, builder);
		const next = parser.peek();
		const isTo = next?.type === "TO" && (next.text ?? next.value ?? "").toLowerCase() === "to";
		if (!isTo || namesConversionTarget(parser.peekAt(1))) {
			builder.emitOpcode(OpCode.POS);
			return;
		}
		parser.consume();
		parser.parseExpression(BindingPower.Conditional, builder);
		builder.emitOpcode(OpCode.ADD);
	}
}

/** The words that are the `-` keyword and read `A from B` as `B - A`. */
const SUBTRACT_WORDS: ReadonlySet<string> = new Set(["subtract", "take", "remove"]);

/**
 * Whether a `from` follows at the top level of the line, outside any bracket:
 * the sign that `subtract 3 from 10` is the word form rather than `-3`. A pure
 * look ahead, bounded by the line's tokens.
 *
 * @param parser - The parser, positioned just after the word.
 * @returns `true` when an unbracketed `from` is still to come.
 */
export function fromFollows(parser: Pick<Parser, "peekAt">): boolean {
	let depth = 0;
	for (let offset = 0, token = parser.peekAt(0); token !== undefined; token = parser.peekAt(++offset)) {
		if (token.type === "LPAREN" || token.type === "LBRACKET") depth++;
		else if (token.type === "RPAREN" || token.type === "RBRACKET") depth--;
		else if (depth === 0 && token.type === "FROM" && (token.text || token.value).toLowerCase() === "from") return true;
	}
	return false;
}

/**
 * The prefix `-`, and `subtract A from B`, the word form of `B - A`.
 *
 * `subtract` (and `take`, `remove`) is the `-` keyword, so `subtract 3 from 10`
 * was read as `-3` with a stray `from 10` after it, and refused. When the word
 * is one of those and a `from` follows its operand, the first is taken from the
 * second: `subtract 3 from 10` is 7, the order the sentence says. Without a
 * `from` the word keeps its old reading (`subtract 3` is -3), and the symbol
 * `-` is a unary minus and nothing else.
 */
export class SubtractFromParselet implements PrefixParselet {
	readonly category = "Arithmetic";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const word = SUBTRACT_WORDS.has((token.text || token.value || "").toLowerCase());
		if (!word || !fromFollows(parser)) {
			parser.parseExpression(BindingPower.Prefix, builder);
			builder.emitOpcode(OpCode.NEG);
			return;
		}
		// The amount taken away is compiled first, where it is written, so the
		// sum is `-A + B`: the same answer as `B - A`, in the reader's order.
		parser.parseExpression(BindingPower.Conditional, builder);
		const next = parser.peek();
		if (next?.type !== "FROM") {
			// The `from` belonged to something inside the operand after all.
			builder.emitOpcode(OpCode.NEG);
			return;
		}
		parser.consume();
		builder.emitOpcode(OpCode.NEG);
		parser.parseExpression(BindingPower.Conditional, builder);
		builder.emitOpcode(OpCode.ADD);
	}
}
