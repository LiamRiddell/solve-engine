import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { SYMBOLIC_LIMIT_FN } from "@solve-js/packages/symbolic/LimitPluginFunction";
import { readVariableName, emitVariableName, parseBoundExpression, emitBoundExpression } from "@solve-js/packages/symbolic/parselets/VariableArgument";

/**
 * `limit(expr, variable, point)`, the value `expr` settles towards as
 * `variable` approaches `point`.
 *
 * Shaped like the other calculus verbs: `expr` is held until the variable is
 * read so the named unknown shadows any document value of the same name (see
 * {@link emitBoundExpression}), and the point is an ordinary value expression,
 * not shadowed, since it is a number and not the unknown.
 *
 * Unlike them it emits a plugin call rather than a `CALL_BUILTIN`. The work is
 * in `LimitPluginFunction.ts`, registered by the package, so the verb claims no
 * index in the builtin table's shared number space.
 */
export class LimitParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		const expression = parseBoundExpression(parser, builder, "limit");
		parser.consume("COMMA");
		const variable = readVariableName(parser, "limit");
		emitBoundExpression(builder, expression, variable);
		emitVariableName(builder, variable);
		if (!parser.match("COMMA")) {
			throw ErrorFactory.parsing(
				"SYMBOLIC_REQUIRES_LIMIT_POINT",
				`limit needs the point the unknown approaches, as in limit(sin(x)/x, x, 0).`,
				{ found: parser.peek()?.type ?? "end of input" },
			);
		}
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");

		builder.emitPluginCall(SYMBOLIC_LIMIT_FN, 3);
	}
}
