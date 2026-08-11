import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { SYMBOLIC_BUILTIN_TAYLOR } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";
import { readVariableName, emitVariableName, parseBoundExpression, emitBoundExpression } from "@solve-js/packages/symbolic/parselets/VariableArgument";

/**
 * `taylor(expr, variable = point, degree)`, matching Calca's own spelling.
 *
 * The `variable = point` argument is why this needs a hand-written parselet:
 * `EQUALS` has no infix parselet, so an ordinary argument list cannot parse it.
 * Reading the name and the point separately also means the name never has to
 * exist as a variable, and `expr` is held until the name is known so that the
 * name shadows any document value it shares (see {@link emitBoundExpression}).
 * The expansion point is an ordinary value expression and is not shadowed: it
 * is a number, not the unknown.
 */
export class TaylorParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		const expression = parseBoundExpression(parser, builder, "taylor");
		parser.consume("COMMA");
		const variable = readVariableName(parser, "taylor");
		emitBoundExpression(builder, expression, variable);
		emitVariableName(builder, variable);
		parser.consume("EQUALS");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("COMMA");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_TAYLOR);
		builder.emitIndex(4);
	}
}
