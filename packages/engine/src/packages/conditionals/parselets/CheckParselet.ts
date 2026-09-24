import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/** The comparison each token stands for, as the check function reads it. */
const OPERATORS: Readonly<Record<string, string>> = {
	EQUALITY: "==",
	NEQ: "!=",
	LT: "<",
	GT: ">",
	LTE: "<=",
	GTE: ">=",
	APPROX: "≈",
};

/**
 * `check <a> <comparison> <b> [within <tolerance>]`: a statement that must
 * hold (#506).
 *
 * The two sides are compiled separately rather than as one comparison, so the
 * check can name both of them when it fails: "check failed: $2,010.00 is more
 * than $1,950.00", where a bare comparison could only say false. The work is
 * the `checkComparison` plugin function (see CheckFunctions.ts).
 */
export const checkParselet: PrefixParselet = {
	category: "Conditionals",
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Conditional, builder);
		const comparison = parser.peek();
		const op = comparison === undefined ? undefined : OPERATORS[comparison.type];
		if (op === undefined) {
			throw ErrorFactory.parsing(
				"CHECK_EXPECTED_COMPARISON",
				`a check compares two things, as in "check :spent <= :budget" or "check 22/7 ≈ pi within 0.1%"`,
			);
		}
		parser.consume();
		parser.parseExpression(BindingPower.Conditional, builder);
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(op);
		let argCount = 3;
		if (parser.peek()?.type === "WITHIN") {
			parser.consume();
			parser.parseExpression(BindingPower.Conditional, builder);
			argCount = 4;
		}
		builder.emitPluginCall("checkComparison", argCount);
	},
};
