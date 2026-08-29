import type { InfixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `"MMXXIV" from roman`, the reverse of `as roman`: the quoted Roman numeral on
 * the left is already on the stack, and this reads it back to a number.
 *
 * Bound to the fused `FROM_ROMAN` token (the package's `phrases` mint it only
 * for the two words "from roman"), so the bare `from` used by `plot`/`clamp`
 * stays untouched, the same treatment the encoding package's `from base64` uses.
 * There is no right operand: "roman" is part of the fused phrase.
 */
export class FromRomanParselet implements InfixParselet {
	readonly category = "Numerals";
	readonly bindingPower = BindingPower.Conditional;

	parse(_parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		builder.emitPluginCall("romanFromString", 1);
	}
}
