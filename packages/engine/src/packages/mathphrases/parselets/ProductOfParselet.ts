import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `product of 2, 3 and 4`, the values multiplied together (#703).
 *
 * The list is read as the other aggregates read theirs (see
 * `VariadicAggregateParselet`), each value at `Conjunction` so the list's own
 * `and` ends it, and each value after the first multiplied in as it is read.
 * Multiplying is what a product of measured values means, so units combine
 * as they do under `*`: `product of 2 m, 3 m` is six square metres.
 */
export class ProductOfParselet implements PrefixParselet {
	readonly category = "MathPhrases";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Conjunction, builder);
		while (parser.match("COMMA") || parser.match("AND_CONJ")) {
			parser.parseExpression(BindingPower.Conjunction, builder);
			builder.emitOpcode(OpCode.MUL);
		}
	}
}
