import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { readGeoAngle } from "@solve-js/lexer/GeoAngleLiteral";

/** Whether a token is an angle literal carrying a compass letter. */
function hasCompassLetter(token: Token | undefined): boolean {
	return token?.type === "GEO_ANGLE" && readGeoAngle(token.value)?.hemisphere !== undefined;
}

/** Whether a token names what a `(` after it is called on: a function, a vector constructor, a fused call. */
function isCallTarget(token: Token | undefined): boolean {
	if (token === undefined) return false;
	const type = token.type;
	return type === "IDENT" || type === "FUNC" || type.startsWith("VEC") || type.endsWith("CALL") || type.endsWith("_FN");
}

/**
 * Whether the literal just consumed sits where two angles may be joined into a
 * place: at the top level of the line, or directly inside a pair of grouping
 * brackets. Not inside a `[...]` list or a call's arguments, where a comma
 * separates elements and each angle has to stay its own element: joining them
 * there turned `[51.5°N, 0.12°W]` into a one-element list holding a place,
 * which a list cannot hold, and it answered `[0]`.
 *
 * Found by walking back over the tokens already read to the innermost bracket
 * that is still open.
 */
function mayJoinIntoPlace(parser: Parser): boolean {
	let depth = 0;
	// -1 is the literal itself; the walk starts at the token before it.
	for (let offset = -2; ; offset--) {
		const token = parser.peekAt(offset);
		if (token === undefined) return true;
		if (token.type === "RPAREN" || token.type === "RBRACKET") {
			depth++;
		} else if (token.type === "LPAREN" || token.type === "LBRACKET") {
			if (depth > 0) {
				depth--;
				continue;
			}
			return token.type === "LPAREN" && !isCallTarget(parser.peekAt(offset - 1));
		}
	}
}

/**
 * An angle as a map writes one (`51°30'27"`, `51.5074°N`), and two of them
 * side by side as a place (`51°30'26"N 0°07'40"W`).
 *
 * The lexer has already cut the literal into one `GEO_ANGLE` token (see
 * `lexer/GeoAngleLiteral.ts`). On its own it is an angle, in degrees. When it
 * carries a compass letter and the next token is another lettered angle,
 * directly or after a comma, the two are one place, a latitude and a longitude,
 * whichever order they were written in: the letters say which is which. The
 * comma is accepted because it is how a search engine prints a place
 * (`51.5072° N, 0.1276° W`); see {@link mayJoinIntoPlace} for where it is not.
 *
 * The literal's text is passed to the plugin function rather than its value
 * worked out here, so that a malformed one (75 minutes, a latitude past a pole)
 * is answered with a refusal that names the part, as a value on the line,
 * instead of stopping the parse.
 */
export class GeoAngleParselet implements PrefixParselet {
	readonly category = "Geo";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		if (hasCompassLetter(token)) {
			const afterComma = parser.peek()?.type === "COMMA";
			const partner = parser.peekAt(afterComma ? 1 : 0);
			if (partner !== undefined && hasCompassLetter(partner) && mayJoinIntoPlace(parser)) {
				if (afterComma) parser.consume();
				parser.consume();
				builder.emitOpcode(OpCode.PUSH_STRING);
				builder.emitString(token.value);
				builder.emitOpcode(OpCode.PUSH_STRING);
				builder.emitString(partner.value);
				builder.emitPluginCall("geoPlaceFromAngles", 2);
				return;
			}
		}
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value);
		builder.emitPluginCall("geoAngle", 1);
	}
}
