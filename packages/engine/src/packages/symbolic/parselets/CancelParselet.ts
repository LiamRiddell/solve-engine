import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { SYMBOLIC_BUILTIN_CANCEL } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";

/**
 * `cancel(expr)`, reducing a quotient of polynomials to lowest terms.
 *
 * The simplifier already cancels a common factor automatically; this is the
 * explicit form, for when the intent is to reduce a fraction rather than to
 * evaluate something that happens to contain one.
 */
export class CancelParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_CANCEL);
		builder.emitIndex(1);
	}
}
