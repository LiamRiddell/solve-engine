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
