import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/**
 * Fuses `3i` into a single imaginary literal, but only when the `i` is written
 * flush against the number.
 *
 * `i` is not claimed as a keyword, and deliberately so. It is one of the most
 * common variable names there is, and this engine's whole trigger-word policy
 * exists to avoid taking words a person would reasonably assign to. `:i = 5`
 * has to keep working, and after this rule it does: the rule only fires on a
 * number immediately followed by the letter, which is the same shape the
 * magnitude suffixes use, and `2.5k` set that precedent.
 *
 * Adjacency is checked by source offset rather than by token order, so `3i` is
 * an imaginary literal while `3 i` and `3 * i` are a number multiplied by a
 * variable named `i`. That is the distinction that keeps both readings
 * available, and it is the reason a bare `i` on its own is still a variable.
 * Write `1i` for the imaginary unit alone.
 */
export function imaginaryLiteralNormalizerRule(priority = 75): NormalizerRule {
	return {
		name: "symbolic:imaginary-literal",
		priority,
		startTokenTypes: ["NUMBER"],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const number = tokens[pos];
			if (!number || number.type !== "NUMBER") return null;

			const suffix = tokens[pos + 1];
			if (!suffix || suffix.type !== "IDENT" || suffix.value !== "i") return null;

			// Flush against the number, with no space between them.
			if (suffix.offset !== number.offset + number.value.length) return null;

			// A following `(` would make this a call, as in `3i(x)`, which is not a
			// shape this claims.
			if (tokens[pos + 2]?.type === "LPAREN") return null;

			return {
				consumed: 2,
				replacement: [
					new LexerToken(
						"IMAGINARY",
						tokenTypeId("IMAGINARY"),
						number.value,
						number.value,
						number.offset,
						0,
						number.line,
						number.col,
					),
				],
				ruleName: "symbolic:imaginary-literal",
			};
		},
	};
}
