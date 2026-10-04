import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/** `float(x)` in VMBuiltins.ts. */
const FLOAT_BUILTIN = 115;

/**
 * `float(x)`, the number `x` is: `float(2.5)` is 2.5 and `float("2.5")` is 2.5.
 *
 * It used to build a one-by-one matrix, which printed as `[2.50]` and was
 * neither a number nor anything its name promised (#828). It is now the
 * builtin at index 115, which refuses by name what has no plain number to give
 * (text that is not a number, a quantity, a list).
 */
export class FloatParselet implements PrefixParselet {
	readonly category = "Float";
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(0, builder);
		parser.consume("RPAREN");
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(FLOAT_BUILTIN);
		builder.emitIndex(1);
	}
}
