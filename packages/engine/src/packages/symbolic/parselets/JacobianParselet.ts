import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { SYMBOLIC_BUILTIN_JACOBIAN } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";

/**
 * `jacobian(f1, f2, ...)`, the matrix of partial derivatives.
 *
 * Variadic, and the variables are not named: they are taken from the union of
 * the functions' own unknowns, sorted, which is what Calca does. Row `i` is the
 * gradient of the `i`-th function.
 */
export class JacobianParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		let count = 0;
		do {
			parser.parseExpression(BindingPower.Lowest, builder);
			count++;
		} while (parser.match("COMMA"));
		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_JACOBIAN);
		builder.emitIndex(count);
	}
}
