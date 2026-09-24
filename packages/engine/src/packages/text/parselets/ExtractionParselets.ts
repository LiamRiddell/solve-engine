import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * `numbers in X` and `amounts in X`: the list of numbers, or amounts of money,
 * written in the text X.
 *
 * The text is parsed at `Prefix`, so it takes just the next value (a quoted
 * string, a variable, a call such as `field(...)`) and stops: arithmetic after
 * it applies to the list, not to the text. The engine's locale code is pushed
 * after the text, because the number format the text is read in is the one the
 * engine was configured with, and that is known here, at parse time, rather
 * than to the plugin function.
 */
export function extractListParselet(pluginName: string): PrefixParselet {
	return {
		category: "Text",
		parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			parser.parseExpression(BindingPower.Prefix, builder);
			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(parser.getLocaleCode());
			builder.emitPluginCall(pluginName, 2);
		},
	};
}

/**
 * `total of numbers in X`, `average of amounts in X` and the other aggregates
 * over what a text holds, on the `TEXT_EXTRACT_AGGREGATE` token the
 * normaliser rule fuses. The token's value is the aggregate's builtin index and
 * which values to read, as `44:numbers`.
 *
 * The aggregate itself is the shipped one, called with the values read from
 * the text, so a total of amounts keeps its currency and an average refuses a
 * mix of currencies it has no rate for, exactly as `total of £3, $4` does.
 */
export const extractAggregateParselet: PrefixParselet = {
	category: "Text",
	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const [index, source] = (token.value ?? "").split(":");
		parser.parseExpression(BindingPower.Prefix, builder);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(Number(index));
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(source ?? "numbers");
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(parser.getLocaleCode());
		builder.emitPluginCall("textExtractAggregate", 4);
	},
};
