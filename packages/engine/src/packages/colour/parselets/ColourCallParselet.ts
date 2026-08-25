import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { COLOUR_FUNCTION_HANDLERS } from "../ColourPluginFunctions";

/**
 * A colour function call with parenthesised arguments: `rgb(255, 0, 0)`,
 * `lighten(#3366cc, 20%)`, `mix(#f00, #00f, 0.25)`, `contrast(a, b)`.
 *
 * The `ColourCallNormalizerRule` has already fused a recognised `name(` into a
 * single `COLOUR_CALL` token carrying the function name, so this resolves that
 * name to its plugin index at parse time and emits the same comma-separated
 * argument loop `FunctionCallParselet` uses, dispatched through `CALL_PLUGIN`.
 * Argument arity and type are checked by the handler at run time, so a wrong
 * call surfaces a coded error Value rather than a parse failure.
 */
export class ColourCallParselet implements PrefixParselet {
	readonly category = "Colour";
	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const name = token.value.toLowerCase();
		if (COLOUR_FUNCTION_HANDLERS[name] === undefined) {
			// Unreachable in practice: the normalizer only mints COLOUR_CALL for a
			// name in COLOUR_FUNCTION_HANDLERS. Defensive, and a clear message if the
			// two ever drift apart.
			throw ErrorFactory.execution("UNKNOWN_COLOUR_FUNCTION", `Unknown colour function: ${name}`, {
				functionName: name,
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

		builder.emitPluginCall(name, argCount);
	}
}
