import type { PrefixParselet, InfixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `<trigger> X`, a one-operand text phrase that calls a plugin function.
 *
 * Backs `length of X` (the trigger is the fused `length of` token, so only X
 * remains) and the bare `trim X` / `reverse X`. The operand binding power is a
 * parameter: `length of` takes the whole following expression, at `Lowest`,
 * the way `square root of` does; the bare unaries take just the next value, at
 * `Prefix`, so `reverse "abc" contains "x"` reverses "abc" and then tests it,
 * rather than reversing the whole comparison.
 */
export function unaryTextParselet(pluginName: string, operandPower: number): PrefixParselet {
	return {
		category: "Text",
		parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			parser.parseExpression(operandPower, builder);
			builder.emitPluginCall(pluginName, 1);
		},
	};
}

/**
 * `X <op> Y` for the membership tests: `contains`, `starts with`, `ends with`.
 * Left is already on the stack; the right operand is parsed at the operator's
 * own power (comparison level), so it does not reach across a looser operator.
 * Each answers a boolean.
 */
export function booleanTextInfixParselet(pluginName: string): InfixParselet {
	return {
		category: "Text",
		bindingPower: BindingPower.Conditional,
		parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
			parser.parseExpression(BindingPower.Conditional, builder);
			builder.emitPluginCall(pluginName, 2);
		},
	};
}

/**
 * `X repeated N times` (the trailing "times" is optional: `X repeated N` also
 * works). Left, the text, is already on the stack.
 *
 * The count is parsed at `Prefix`, tighter than a multiply, so it takes just
 * the number and stops. That matters because "times" itself lexes as the
 * multiply token (`8 times 9` is 72): the count parse must not run into it. We
 * then look for that STAR carrying the source text "times" and consume it, the
 * same recognise-by-its-text trick the percentage `UpDownParselet` uses, so the
 * word reads naturally here while still meaning multiplication everywhere else.
 */
export const repeatTextParselet: InfixParselet = {
	category: "Text",
	bindingPower: BindingPower.Conditional,
	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Prefix, builder); // the count
		const next = parser.peek();
		if (next?.type === "STAR" && (next.value ?? "").toLowerCase() === "times") {
			parser.consume();
		}
		builder.emitPluginCall("textRepeat", 2);
	},
};
