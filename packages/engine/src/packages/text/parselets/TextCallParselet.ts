import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { TEXT_CALL_FUNCTIONS } from "../TextFunctionNames";

/**
 * The parenthesised call form of a text function: `length("hi")`,
 * `replace("banana", "a", "@")`, `upper("hi")`. Triggered on the `TEXT_CALL`
 * token the normaliser mints, whose value is the lower-cased function name. The
 * name maps to a plugin function; the argument list is the ordinary
 * comma-separated form, and the whole call lowers to one `CALL_PLUGIN`.
 */
export class TextCallParselet implements PrefixParselet {
	readonly category = "Text";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const pluginName = TEXT_CALL_FUNCTIONS[token.value];
		if (pluginName === undefined) {
			throw ErrorFactory.execution("UNKNOWN_FUNCTION", `Unknown text function: ${token.value}`, {
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
