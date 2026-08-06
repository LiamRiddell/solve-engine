import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * `<quantity> at <rate>`.
 *
 *   30 hours at $30/hour    $900
 *   $500 at $20/hour        25 hours
 *
 * The same word for opposite operations, told apart by which half of the rate
 * the left side matches. That needs the units, so the decision is made in the
 * builtin where both values are known rather than here.
 *
 * Triggered on `AT_RATE`, which a normalizer produces only when a rate really
 * follows. Registering on the plain `at` token broke the finance grammar,
 * which parses its own rate with the same word; see AtRateNormalizerRule.
 */
export class AtRateParselet implements InfixParselet {
	readonly category = "Uom";
	readonly bindingPower = BindingPower.Product;

	constructor(private readonly builtinIndex: number) {}

	parse(parser: Parser, _left: Token, _token: Token, builder: BytecodeBuilder): void {
		// Below Product, so the rate on the right is parsed whole. At Product
		// the PER_UNIT that carries the denominator binds at the same level and
		// is left behind, which produced a rate of nothing per hour.
		parser.parseExpression(BindingPower.Conditional, builder);
		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(this.builtinIndex);
		builder.emitIndex(2);
	}
}
