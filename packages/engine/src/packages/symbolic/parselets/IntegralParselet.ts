import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { SYMBOLIC_BUILTIN_INTEGRAL } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";
import { consumeVariableName } from "@solve-js/packages/symbolic/parselets/VariableArgument";

/** `integral(expr, variable)`, the indefinite integral, without a constant of integration. */
export class IntegralParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("COMMA");
		consumeVariableName(parser, builder, "integral");
		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_INTEGRAL);
		builder.emitIndex(2);
	}
}
