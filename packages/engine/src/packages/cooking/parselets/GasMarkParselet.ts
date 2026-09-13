import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { OpCode } from "@solve-js/parser/OpCode";

/** A whole number written without a decimal point or an exponent, the shape a dial fraction is spelled in. */
function wholeNumberValue(token: Token | undefined): number | null {
	if (token?.type !== "NUMBER") return null;
	const value = Number(token.value ?? "");
	return Number.isInteger(value) ? value : null;
}

/**
 * `gas mark <n>` and `gas <n>`: the oven temperature a dial setting means.
 *
 * The setting is parsed at `Prefix`, so it takes the number beside it and
 * nothing further: `gas 6 + 10` is ten degrees above gas 6 rather than gas 16.
 *
 * The one thing that reaches past that number is a fraction written on it. The
 * slow-oven settings are the dial's fractions, `1/4` and `1/2`, so `gas 1/4` is
 * one setting, the quarter, and not `gas 1` divided by four (which read the `1`
 * as the mark and gave 140 / 4 = 35°C). A proper fraction beside the setting,
 * numerator below denominator, is folded into it and handed on as the single
 * value it draws, so the lookup sees 0.25 and answers 110°C. Whether that value
 * is a mark stays the table's decision: `gas 3/4` folds to 0.75 and is refused,
 * because 3/4 is not on this dial. An improper `gas 6/2` is no dial fraction and
 * keeps the ordinary division it reads as, the same boundary the mixed-number
 * rule draws for `2 3/2`.
 */
export class GasMarkParselet implements PrefixParselet {
	readonly category = "Cooking";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		const numerator = wholeNumberValue(parser.peek());
		const denominator = parser.peekAt(1)?.type === "SLASH" ? wholeNumberValue(parser.peekAt(2)) : null;
		const isDialFraction =
			numerator !== null && denominator !== null && numerator > 0 && denominator > 0 && numerator < denominator;

		parser.parseExpression(BindingPower.Prefix, builder);
		if (isDialFraction) {
			parser.consume(); // the slash
			parser.consume(); // the denominator, already read as a whole number above
			builder.emitOpcode(OpCode.PUSH_NUMBER);
			builder.emitNumber(denominator);
			builder.emitOpcode(OpCode.DIV);
		}
		builder.emitPluginCall("gasMarkToCelsius", 1);
	}
}
