import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const INPUTS_OF_TYPE_ID = tokenTypeId("INPUTS_OF");

/**
 * Fuses `inputs of` into one `INPUTS_OF` token, but ONLY when a line reference
 * follows it (`inputs of line 5`).
 *
 * "inputs" is an ordinary word and a plausible variable name, so it is never a
 * bare keyword: `:inputs = 3` and `20% of inputs` stay untouched, and the
 * words fuse only in the one shape that names a line. The same lookahead
 * discipline as goal seek's `solve line N`, and for the same reason.
 *
 * Depends on the line-ref rule having fused `line 5` into a `LINE_REF` in an
 * earlier pass, which the normalizer's multi-pass loop guarantees: that rule
 * runs at priority 80, this one below it.
 *
 * @param priority - Rule ordering within the normalizer, below the line-ref rule.
 * @returns The normalizer rule.
 */
export function inputsOfNormalizerRule(priority = 75): NormalizerRule {
	return {
		name: "lines:inputs-of",
		priority,
		shape: [{ types: ["IDENT"], values: ["inputs"] }, { types: ["OF"] }, { types: ["LINE_REF"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			// A definition's own name is never this trigger.
			if (pos > 0 && tokens[pos - 1].type === "COLON") return null;
			const token = tokens[pos];
			if (!token || token.type !== "IDENT" || token.value.toLowerCase() !== "inputs") return null;
			if (tokens[pos + 1]?.type !== "OF" || tokens[pos + 2]?.type !== "LINE_REF") return null;
			// consumed = 2: "inputs of" becomes INPUTS_OF; the LINE_REF stays for
			// the parselet to read as the line to trace.
			return {
				consumed: 2,
				replacement: [
					new LexerToken("INPUTS_OF", INPUTS_OF_TYPE_ID, "inputs of", "inputs of", token.offset, 0, token.line, token.col),
				],
				ruleName: "lines:inputs-of",
			};
		},
	};
}
