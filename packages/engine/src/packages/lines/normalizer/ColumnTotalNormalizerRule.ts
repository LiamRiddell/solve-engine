import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/** The words a line on its own may say to total the block above it (#742). */
export const COLUMN_TOTAL_WORDS: readonly string[] = ["sum", "total"];

/** Whether a token is a label word, the kind a `Subtotal:` is written with. */
function isLabelWord(token: Token | undefined): boolean {
	return token !== undefined && (token.type === "IDENT" || token.type === "UNIT");
}

/**
 * Whether the token at `pos` is a bare `sum` or `total` that is the whole of
 * its line's expression: the only token, or the only one after a label
 * (`Subtotal: total`).
 *
 * @param tokens - The line's tokens.
 * @param pos - The index to test.
 * @returns `true` for a column total.
 */
export function isColumnTotal(tokens: readonly Token[], pos: number): boolean {
	const token = tokens[pos];
	if (token === undefined || token.type !== "IDENT") return false;
	if (pos !== tokens.length - 1) return false;
	if (!COLUMN_TOTAL_WORDS.includes((token.value ?? "").toLowerCase())) return false;
	if (pos === 0) return true;
	// After a label: a word, then its colon. `:total` on its own is the colon
	// variable syntax, whose colon has no word before it.
	return pos >= 2 && tokens[pos - 1].type === "COLON" && isLabelWord(tokens[pos - 2]);
}

/**
 * A line that is only `sum` or `total`: the total of the block above it, as
 * `total above` gives (#742).
 *
 * Other calculators read the bare word this way, and a note typed their way
 * put `sum` under a column and got "Undefined variable". The word is fused to
 * a COLUMN_TOTAL token only when it is the whole line, so `total * 2`, `total
 * of 1, 2, 3` and `total = 5` keep their meanings. The token is marked as one
 * that may name a variable: a note that defines `total` reads that value, and
 * the line is recorded as reading the name, so editing the definition reaches
 * it. The handler decides which applies when the line runs (see
 * `columnTotalHandler`).
 */
export function columnTotalNormalizerRule(priority = 70): NormalizerRule {
	return {
		name: "lines:column-total",
		priority,
		shape: [{ types: ["IDENT"], values: COLUMN_TOTAL_WORDS }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			if (!isColumnTotal(tokens, pos)) return null;
			const word = tokens[pos];
			const fused = createFusedToken("COLUMN_TOTAL", word.text, [word]);
			// The value is the name a definition would give it, as typed.
			fused.value = word.value;
			fused.mayNameVariable = true;
			return { consumed: 1, replacement: [fused], ruleName: "lines:column-total" };
		},
	};
}
