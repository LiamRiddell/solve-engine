import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * A nullary keyword that produces a value on its own: `uuid`, `coin`. It parses
 * no operand and lowers to a zero-argument plugin call.
 */
export function nullaryRandomParselet(pluginName: string): PrefixParselet {
	return {
		category: "Random",
		parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			builder.emitPluginCall(pluginName, 0);
		},
	};
}

/**
 * A one-operand keyword: `shuffle X`, `random hex N`. The operand is parsed at
 * `Prefix`, so it takes just the next value (`random hex 8` reads the 8, not an
 * expression around it).
 */
export function unaryRandomParselet(pluginName: string): PrefixParselet {
	return {
		category: "Random",
		parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			parser.parseExpression(BindingPower.Prefix, builder);
			builder.emitPluginCall(pluginName, 1);
		},
	};
}

/**
 * `pick(a, b, c)`: the parenthesised, comma-separated options, one returned at
 * random. Triggered on the `PICK_CALL` token the normaliser mints.
 */
export const pickCallParselet: PrefixParselet = {
	category: "Random",
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		let argCount = 0;
		if (parser.peek()?.type !== "RPAREN") {
			parser.parseExpression(BindingPower.Lowest, builder);
			argCount++;
			while (parser.match("COMMA")) {
				parser.parseExpression(BindingPower.Lowest, builder);
				argCount++;
			}
		}
		parser.consume("RPAREN");
		builder.emitPluginCall("randomPick", argCount);
	},
};
