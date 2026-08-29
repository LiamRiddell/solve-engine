import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { HASH_CALL_FUNCTIONS } from "../HashPluginFunctions";

/**
 * The parenthesised call form of a hash: `sha256("hi")`, `crc32("hi")`.
 * Triggered on the `HASH_CALL` token, whose value is the lower-cased function
 * name; the name maps to a plugin function and the whole call lowers to one
 * `CALL_PLUGIN`.
 */
export class HashCallParselet implements PrefixParselet {
	readonly category = "Hash";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const pluginName = HASH_CALL_FUNCTIONS[token.value];
		if (pluginName === undefined) {
			throw ErrorFactory.execution("UNKNOWN_FUNCTION", `Unknown hash function: ${token.value}`, {
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
