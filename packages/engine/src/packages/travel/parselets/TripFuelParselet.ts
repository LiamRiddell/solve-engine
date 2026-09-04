import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * `fuel for <distance> at <economy>` and `cost to drive <distance> at
 * <economy> at <price>`.
 *
 * Each part is parsed at `Product`, which is what stops before the `at` that
 * separates them: `at` is the rate operator elsewhere in the engine
 * (`30 hours at $30/hour`), and letting it bind here would take the economy
 * into the distance and leave nothing for the second part.
 *
 * The parts are read positionally rather than by keyword, because that is how
 * a driver says it: how far, how thirsty, how much a litre.
 */
export class TripFuelParselet implements PrefixParselet {
	readonly category = "Travel";

	/**
	 * @param fn - The plugin function to call with the parsed parts.
	 * @param withPrice - Whether a third part, the price at the pump, is read.
	 */
	constructor(
		private readonly fn: string,
		private readonly withPrice: boolean,
	) {}

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		parser.parseExpression(BindingPower.Product, builder);
		this.consumeAt(parser, token, "an economy");
		// The last part is parsed at `Lowest`, so whatever binds it to a unit
		// binds: a price is `£1.50/litre`, and `/` and `per` are both at `Product`,
		// the power the earlier parts have to stop at. Nothing follows the last
		// part, so letting it take everything is safe.
		if (!this.withPrice) {
			parser.parseExpression(BindingPower.Lowest, builder);
			builder.emitPluginCall(this.fn, 2);
			return;
		}
		parser.parseExpression(BindingPower.Product, builder);
		this.consumeAt(parser, token, "a fuel price");
		parser.parseExpression(BindingPower.Lowest, builder);
		builder.emitPluginCall(this.fn, 3);
	}

	/** Consume the `at` before a part, naming what was expected when it is missing. */
	private consumeAt(parser: Parser, token: Token, expected: string): void {
		const next = parser.peek();
		// `RATE_AT` is the bare word. `AT_RATE` is what the units package's own
		// rule leaves when the price after it is a rate (`at £1.50/litre`), and
		// it has already claimed the `at` by the time this runs.
		if (next?.type !== "RATE_AT" && next?.type !== "AT_RATE" && next?.type !== "AT") {
			throw ErrorFactory.parsing({
				code: "TRIP_EXPECTED_AT",
				message: `"${token.value}" expects "at" and then ${expected}, as in "cost to drive 300 miles at 35 mpg at £1.50/litre"`,
				span: next ? { start: next.offset, end: next.offset + next.text.length, line: next.line, col: next.col } : undefined,
			});
		}
		parser.consume();
	}
}
