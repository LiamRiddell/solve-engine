import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * The binding power a place is parsed at: that of the `in` unit conversion
 * (the currency package's `InParselet`, 35, between `Sum` and `Product`).
 *
 * A place is one value, a pair in brackets, a lettered pair or a variable, so
 * nothing looser than multiplication belongs inside it. Parsing at `Conditional`
 * was the first attempt and it read `... to (0, 90) in miles` as the second
 * place converted to miles, which is not a place at all.
 */
const PLACE_BINDING_POWER = 35;

/**
 * `distance from <place> to <place>`, `distance between <place> and <place>`
 * and `bearing from <place> to <place>`.
 *
 * A place is whatever evaluates to one: a pair in brackets (`(51.5074,
 * -0.1278)`), a pair of compass-lettered angles (`51.5074°N 0.1278°W`), or a
 * variable holding either. It may also be two numbers separated by a comma with
 * no brackets, `51.5074, -0.1278`, because that is exactly what a map copies to
 * the clipboard; the two are joined into a place before the call.
 *
 * Every place is parsed at {@link PLACE_BINDING_POWER}, the level of the `in`
 * unit conversion, so it stops at each word that could otherwise swallow it:
 * `to` (also a conversion, at `Conditional`) ends the first place of the `from`
 * form, `and` (also addition, at `Conjunction`) the first of the `between`
 * form, and a trailing `in miles` or `as dms` is left for the whole answer
 * rather than being read as part of the second place.
 */
export class GeoQueryParselet implements PrefixParselet {
	readonly category = "Geo";

	/**
	 * @param fn - The plugin function to call with the two places.
	 * @param separator - The word between the places: `to` after `from`, `and` after `between`.
	 */
	constructor(
		private readonly fn: string,
		private readonly separator: "TO" | "AND_CONJ",
	) {}

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		this.parsePlace(parser, builder);

		const next = parser.peek();
		if (next?.type !== this.separator) {
			const word = this.separator === "TO" ? "to" : "and";
			const example = this.separator === "TO"
				? `${token.value} (51.5074, -0.1278) to (48.8566, 2.3522)`
				: `${token.value} (51.5074, -0.1278) and (48.8566, 2.3522)`;
			throw ErrorFactory.parsing({
				code: "GEO_EXPECTED_SECOND_PLACE",
				message: `"${token.value}" expects a place, then "${word}" and a second place, as in "${example}"`,
				span: next ? { start: next.offset, end: next.offset + next.text.length, line: next.line, col: next.col } : undefined,
			});
		}
		parser.consume();

		this.parsePlace(parser, builder);
		builder.emitPluginCall(this.fn, 2);
	}

	/** One place: an expression, or two joined by a bare comma into a latitude and longitude. */
	private parsePlace(parser: Parser, builder: BytecodeBuilder): void {
		parser.parseExpression(PLACE_BINDING_POWER, builder);
		if (parser.peek()?.type === "COMMA") {
			parser.consume();
			parser.parseExpression(PLACE_BINDING_POWER, builder);
			builder.emitPluginCall("geoPlace", 2);
		}
	}
}
