import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { SYMBOLIC_BUILTIN_DER } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";
import { consumeVariableName } from "@solve-js/packages/symbolic/parselets/VariableArgument";

/**
 * `der(expr, variable)` and `der(expr, variable, order)`, the symbolic
 * derivative. `derivative` is accepted as the same thing.
 *
 * The variable is emitted as a string rather than compiled as a variable read,
 * for the reason given in {@link consumeVariableName}.
 */
export class DerParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("COMMA");
		consumeVariableName(parser, builder, "der");

		// The order is optional and defaults to a first derivative.
		if (parser.match("COMMA")) {
			parser.parseExpression(BindingPower.Lowest, builder);
		} else {
			builder.emitOpcode(OpCode.PUSH_NUMBER);
			builder.emitNumber(1);
		}
		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_DER);
		builder.emitIndex(3);
	}
}
