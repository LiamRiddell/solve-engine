import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `ratio(a, b, ...)`: the parenthesised, comma-separated parts, reduced to
 * lowest whole-number terms. Triggered on the `RATIO_CALL` token; lowers to a
 * single `CALL_PLUGIN` over the parts.
 */
export const ratioCallParselet: PrefixParselet = {
	category: "Ratio",
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
		builder.emitPluginCall("ratioReduce", argCount);
	},
};
