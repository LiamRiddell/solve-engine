import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { COLOUR_FUNCTION_HANDLERS } from "../ColourPluginFunctions";

/**
 * The recognised call-names, derived once from the handler map's keys. Kept as a
 * `Set` so the per-token {@link colourCallNormalizerRule} membership test stays
 * O(1) rather than scanning the map on every identifier.
 */
const COLOUR_FUNCTION_NAMES = new Set(Object.keys(COLOUR_FUNCTION_HANDLERS));

/**
 * Fuse a colour function name into a single `COLOUR_CALL` token, but ONLY when
 * the bare word is immediately followed by `LPAREN` (mirrors
 * `mapreduce`/`lines`' conditional-on-`LPAREN` fusion). This keeps `mix`,
 * `rotate`, `alpha`, `fade` and the rest usable as ordinary variable names when
 * they are not being called: `:mix = 5` stays a variable, `mix(a, b)` becomes a
 * call. The recognised names come from {@link COLOUR_FUNCTION_HANDLERS}, so the
 * grammar and the runtime dispatch can never drift apart.
 */
export function colourCallNormalizerRule(priority = 80): NormalizerRule {
	return {
		name: "colour:call",
		priority,
		startTokenTypes: ["IDENT"],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			const word = token.value.toLowerCase();
			if (!COLOUR_FUNCTION_NAMES.has(word)) return null;
			if (tokens[pos + 1]?.type !== "LPAREN") return null;

			return {
				consumed: 1,
				replacement: [
					new LexerToken(
						"COLOUR_CALL",
						tokenTypeId("COLOUR_CALL"),
						token.value,
						token.value,
						token.offset,
						0,
						token.line,
						token.col,
					),
				],
				ruleName: "colour:call",
			};
		},
	};
}
