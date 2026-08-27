import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * The function-call spelling of an encoding, `base64("Hello")`, alongside the
 * `"Hello" as base64` form (issue #188). The token it handles is minted by
 * {@link base64CallNormalizerRule} only when the word is immediately followed by
 * `(`, so `base64` stays an ordinary word in `as base64` and a usable variable
 * name elsewhere. It parses one argument and calls the same plugin the converter
 * does.
 */
export class EncodingCallParselet implements PrefixParselet {
	readonly category = "Encoding";
	constructor(private readonly fn: string) {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");
		builder.emitPluginCall(this.fn, 1);
	}
}
