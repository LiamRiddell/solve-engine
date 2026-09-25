import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * `percent change from 50 to 75`, the change as a percentage of where it
 * started (#705): the question `50 to 75 as %` already answers, in the words it
 * is asked in, and the same answer, a change from zero included.
 *
 * The starting value is read up to the `to`, which is the percentage-change
 * operator in its own right, so it cannot be taken into the first operand.
 */
export class PercentChangeFromParselet implements PrefixParselet {
	readonly category = "Percentage";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Conditional, builder);
		if (!parser.match("TO")) {
			throw ErrorFactory.parsing(
				"PERCENT_CHANGE_EXPECTED_TO",
				'Expected "to" and the new value, as in "percent change from 50 to 75"',
			);
		}
		parser.parseExpression(BindingPower.Conditional, builder);
		builder.emitOpcode(OpCode.PERCENT_CHANGE);
		builder.emitOpcode(OpCode.TO_PERCENTAGE);
	}
}
