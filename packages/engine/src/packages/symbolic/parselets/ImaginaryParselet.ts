import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { SYMBOLIC_BUILTIN_IMAGINARY } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";

/**
 * An imaginary literal, `3i`, fused by
 * `normalizer/ImaginaryLiteralNormalizerRule.ts`.
 *
 * The token carries the numeric part as its value; this pushes that number and
 * lets the builtin turn it into an exact imaginary value. Going through a
 * builtin rather than a dedicated opcode keeps the VM dispatch table untouched,
 * the same choice every other algebra verb made.
 */
export class ImaginaryParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(Number(token.value));
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_IMAGINARY);
		builder.emitIndex(1);
	}
}
