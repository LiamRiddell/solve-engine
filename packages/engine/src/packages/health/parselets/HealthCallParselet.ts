import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { HEALTH_CALL_FUNCTIONS } from "../normalizer/HealthCallNormalizerRule";

/**
 * The parenthesised call form of a health function: `bmi(70, 1.75)`,
 * `pace(10, 50)`, `speed(10, 50)`. Triggered on the `HEALTH_CALL` token; the
 * name maps to a plugin function and the call lowers to one `CALL_PLUGIN`.
 */
export class HealthCallParselet implements PrefixParselet {
	readonly category = "Health";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const pluginName = HEALTH_CALL_FUNCTIONS[token.value];
		if (pluginName === undefined) {
			throw ErrorFactory.execution("UNKNOWN_FUNCTION", `Unknown health function: ${token.value}`, {
				functionName: token.value,
			});
		}

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

		builder.emitPluginCall(pluginName, argCount);
	}
}
