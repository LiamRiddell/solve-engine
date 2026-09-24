import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * The cash-flow appraisal forms: `npv of <flows> at <rate>`, `irr of <flows>`
 * and `payback of <flows>`. Triggered on the fused `NPV_OF` / `IRR_OF` /
 * `PAYBACK_OF` phrase tokens, so `npv`, `irr` and `payback` alone stay ordinary
 * names (and `IRR` stays free to be the Iranian rial's currency code, which is
 * why the bare word is never claimed).
 *
 * The flows are the same comma list the aggregates read (`average of 1, 2, 3`),
 * or one bracketed list or a variable holding one. Each flow is parsed at
 * `Conjunction`, the level "and" binds at, so an English list's closing
 * "and" (`-1000, 300 and 400`) separates flows rather than adding them, and
 * the `at` that introduces the rate ends the last flow. The rate is parsed at
 * `Conditional`, the level the other finance phrases read a rate at.
 *
 * The call lowers to one `CALL_PLUGIN` whose arguments are the flows in order,
 * then the rate for `npv`; the plugin function validates the shapes.
 */
export class CashFlowParselet implements PrefixParselet {
	readonly category = "Finance";

	/**
	 * @param pluginName - The plugin function the call lowers to.
	 * @param form - The form as the reader writes it, for the parse errors.
	 * @param takesRate - Whether an `at <rate>` clause follows the flows.
	 */
	constructor(
		private readonly pluginName: string,
		private readonly form: string,
		private readonly takesRate: boolean,
	) {}

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		let argCount = 0;
		do {
			parser.parseExpression(BindingPower.Conjunction, builder);
			argCount++;
		} while (parser.match("COMMA") || parser.match("AND_CONJ"));

		if (this.takesRate) {
			// `at` lexes to RATE_AT (the word) or AT (a fused @).
			if (!parser.match("RATE_AT") && !parser.match("AT")) {
				const next = parser.peek();
				throw ErrorFactory.parsing(
					"CASH_FLOW_MISSING_RATE",
					`${this.form} needs a discount rate after the flows, as in "${this.form} of -1000, 300, 400, 500 at 10%"`,
					{ actualType: next?.type, actualValue: next?.value },
				);
			}
			parser.parseExpression(BindingPower.Conditional, builder);
			argCount++;
		}

		builder.emitPluginCall(this.pluginName, argCount);
	}
}
