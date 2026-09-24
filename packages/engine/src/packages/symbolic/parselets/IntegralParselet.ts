import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { SYMBOLIC_BUILTIN_INTEGRAL } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";
import {
	readVariableName,
	emitVariableName,
	parseBoundExpression,
	emitBoundExpression,
	parseOptionalBounds,
} from "@solve-js/packages/symbolic/parselets/VariableArgument";

/**
 * `integral(expr, variable)`, the indefinite integral, without a constant of
 * integration, and `integral(expr, variable, lower, upper)`, the definite
 * integral between two bounds. `expr` is held until the variable is read so
 * that the named unknown shadows any document value of the same name, see
 * {@link emitBoundExpression}. The bounds are ordinary numbers and are not
 * shadowed.
 */
export class IntegralParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		const expression = parseBoundExpression(parser, builder, "integral");
		parser.consume("COMMA");
		const variable = readVariableName(parser, "integral");
		emitBoundExpression(builder, expression, variable);
		emitVariableName(builder, variable);
		const definite = parseOptionalBounds(parser, builder, "integral", "integral(x^2, x, 0, 3)");
		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_INTEGRAL);
		builder.emitIndex(definite ? 4 : 2);
	}
}
