import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { SYMBOLIC_BUILTIN_APART } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";

/**
 * `apart(expr)`, splitting a rational function into partial fractions.
 *
 * The inverse of putting a sum of fractions over a common denominator, and the
 * step that makes a rational function integrable.
 */
export class ApartParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_APART);
		builder.emitIndex(1);
	}
}
