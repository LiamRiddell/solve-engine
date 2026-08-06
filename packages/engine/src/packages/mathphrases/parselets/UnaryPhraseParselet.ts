import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `<phrase> of X`, a one-operand phrase front end for a builtin that already
 * exists.
 *
 * Backs `square root of` and `cube root of`, which are just `sqrt` and `cbrt`
 * spelled the way they are said. Soulver documents both spellings, and
 * `sqrt(81)` already worked while `square root of 81` did not.
 *
 * The operand is parsed at `Lowest`, so the phrase takes the whole expression
 * after it: `square root of 3 * 27` is the root of 81, which is how the words
 * read.
 */
export function unaryPhraseParselet(builtinIndex: number): PrefixParselet {
	return {
		category: "MathPhrases",
		parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			parser.parseExpression(BindingPower.Lowest, builder);
			builder.emitOpcode(OpCode.CALL_BUILTIN);
			builder.emitIndex(builtinIndex);
			builder.emitIndex(1);
		},
	};
}
