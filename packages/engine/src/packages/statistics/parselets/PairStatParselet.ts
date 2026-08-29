import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `<stat> of A and B`, the two-list phrase form: `correlation of A and B`,
 * `slope of A and B`, `intercept of A and B`. The trigger (`correlation of`
 * etc.) is already fused and consumed, so the first list is next.
 *
 * Each list is parsed at `Conjunction`, the level "and" itself binds at, so the
 * "and" between the two lists ends the first argument rather than being read as
 * the addition it also is, the same trick the variadic aggregate parselet uses.
 */
export function pairStatParselet(pluginName: string): PrefixParselet {
	return {
		category: "Statistics",
		parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			parser.parseExpression(BindingPower.Conjunction, builder); // first list
			parser.consume("AND_CONJ");
			parser.parseExpression(BindingPower.Conjunction, builder); // second list
			builder.emitPluginCall(pluginName, 2);
		},
	};
}
