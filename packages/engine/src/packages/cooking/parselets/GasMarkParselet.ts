import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `gas mark <n>` and `gas <n>`: the oven temperature a dial setting means.
 *
 * The setting is parsed at `Prefix`, so it takes the number beside it and
 * nothing further: `gas 6 + 10` is ten degrees above gas 6 rather than gas 16.
 */
export class GasMarkParselet implements PrefixParselet {
	readonly category = "Cooking";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Prefix, builder);
		builder.emitPluginCall("gasMarkToCelsius", 1);
	}
}
