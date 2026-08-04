import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { SYMBOLIC_BUILTIN_IM } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";

/**
 * `im(z)`, the imaginary part of a complex value.
 *
 * A dedicated parselet rather than a keywordMap entry, for the reason given in
 * `normalizer/SymbolicCallNormalizerRule.ts`: `re` and `im` are short words a
 * person may well use as variable names.
 */
export class ImParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_IM);
		builder.emitIndex(1);
	}
}
