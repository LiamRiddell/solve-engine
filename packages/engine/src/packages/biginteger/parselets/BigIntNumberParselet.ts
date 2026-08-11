import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { bigIntLiteralDigits } from "@solve-js/parser/BigIntLiteral";

/**
 * Arbitrary-precision integer literal, with or without the trailing `n`.
 *
 * The digits are emitted as a string rather than a number, because the whole
 * point of the type is holding values a double cannot represent exactly.
 */
export class BigIntNumberParselet implements PrefixParselet {
	readonly category = "BigInt";
	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
    // Store as string to preserve arbitrary precision (exceeds Float64).
    // The digits come from the same helper the Tier-1 switch in
    // parser/PrecedenceParser.ts uses, so the two tiers cannot read a literal
    // differently, which is what makes `1.000n` behave the same either way.
    builder.emitOpcode(OpCode.PUSH_BIGINT);
    builder.emitString(bigIntLiteralDigits(token.value, parser.getLocaleCode()));
  }
}
