import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/** The builtin index of `sqrt` (see FunctionCallParselet's name table). */
const SQRT_BUILTIN_INDEX = 0;

/**
 * `√x`, the square root written as the symbol a formula uses (#669).
 *
 * A prefix, binding as tightly as a unary minus, so `√16 + 9` is 13, not 5, and
 * `√(9 + 16)` is 5. It calls the same builtin `sqrt` does, so a quantity, a
 * negative number and an exact square answer exactly as `sqrt(...)` answers.
 */
export class SquareRootSignParselet implements PrefixParselet {
	readonly category = "Function";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Prefix, builder);
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SQRT_BUILTIN_INDEX);
		builder.emitIndex(1);
	}
}

/**
 * `∞`, infinity (#669). The value `1/0` already answers, reached directly. The
 * word `infinity` is not read, since it is ordinary English in prose.
 */
export class InfinitySignParselet implements PrefixParselet {
	readonly category = "Constant";

	parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(Number.POSITIVE_INFINITY);
	}
}
