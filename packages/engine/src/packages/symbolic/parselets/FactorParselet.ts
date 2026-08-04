import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { SYMBOLIC_BUILTIN_FACTOR } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";

/**
 * `factor(expr)`, writing a polynomial as a product of irreducible factors over the rationals.
 *
 * A dedicated parselet rather than a `builtinNameToIndex` entry reached through
 * the ordinary `FunctionCallParselet`, because that route needs the lexer to
 * emit `FUNC` for the word, which means a `keywordMap` entry, which would stop
 * `expand` working as an ordinary variable name. See
 * `normalizer/SymbolicCallNormalizerRule.ts`.
 *
 * The emitted bytecode is an ordinary `CALL_BUILTIN`, so no new opcode and no
 * new VM dispatch arm is involved.
 */
export class FactorParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_FACTOR);
		builder.emitIndex(1);
	}
}
