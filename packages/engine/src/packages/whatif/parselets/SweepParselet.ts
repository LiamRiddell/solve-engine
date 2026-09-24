import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { SWEEP_FN_NAME } from "../WhatIfPluginFunctions";
import { SWEEP_STEP_TOKEN } from "../normalizer/WhatIfNormalizerRules";

/**
 * `line N for <name> from <start> to <end> step <step>`, a sweep.
 *
 * Reads as "line N's answer for each value of <name> from <start> to <end>, in
 * steps of <step>". The words `line N for` are already one `SWEEP` token
 * carrying N, and `step` is already a `SWEEP_STEP` token (see
 * `sweepNormalizerRule`); this reads the rest.
 *
 * The bounds are parsed just above `to`'s own binding power, the way `plot
 * <expr> from <a> to <b>` reads its bounds, because `to` is also the unit
 * conversion operator: parsed any lower, `3% to 6%` would be read as a
 * conversion. The step is parsed at the same level, so a conversion or an `as`
 * written after the sweep applies to the whole list (`... step 1% as
 * sparkline`) rather than to the step.
 *
 * Emits the target line, the swept name (a String), and the three bounds, for
 * the sweep plugin function.
 */
export class SweepParselet implements PrefixParselet {
	readonly category = "WhatIf";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const targetLine = parseInt(token.value, 10);
		const nameToken = parser.peek();
		if (!nameToken || (nameToken.type !== "IDENT" && nameToken.type !== "UNIT")) {
			throw ErrorFactory.parsing(
				"SWEEP_REQUIRES_VARIABLE_NAME",
				`A sweep names the input to step through, as in "line ${targetLine} for rate from 3% to 6% step 1%".`,
				{ found: nameToken?.type ?? "end of input" },
			);
		}
		parser.consume();

		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(targetLine);
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(nameToken.value);

		parser.consume("FROM");
		parser.parseExpression(BindingPower.Conditional, builder);
		parser.consume("TO");
		parser.parseExpression(BindingPower.Conditional, builder);
		if (parser.peek()?.type !== SWEEP_STEP_TOKEN) {
			throw ErrorFactory.parsing(
				"SWEEP_REQUIRES_STEP",
				`A sweep needs a step after its range, as in "line ${targetLine} for ${nameToken.value} from 1 to 10 step 1".`,
				{ found: parser.peek()?.type ?? "end of input" },
			);
		}
		parser.consume();
		parser.parseExpression(BindingPower.Conditional, builder);

		builder.emitPluginCall(SWEEP_FN_NAME, 5);
	}
}
