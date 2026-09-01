import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * `crypto("BTC")`: the coin symbol, read as a literal inside the parentheses and
 * emitted as the string the async resolver queries on. The parentheses keep it
 * unambiguous, so a bare `crypto` stays usable as a variable name.
 */
export class CryptoCallParselet implements PrefixParselet {
	readonly category = "Crypto";
	constructor(private readonly fn: string) {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		const arg = parser.consume();
		const coin = String(arg.value ?? "").trim().toUpperCase();
		parser.consume("RPAREN");
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(coin);
		builder.emitPluginCall(this.fn, 1);
	}
}
