import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const PIXEL_DENSITY_ID = tokenTypeId("PIXEL_DENSITY");

/** The words a density is written in, dots or pixels per inch, in either case. */
const DENSITY_WORDS: ReadonlySet<string> = new Set(["dpi", "ppi"]);

/** The three types `at` arrives as, depending on which rule has retyped it. */
const AT_TYPES: ReadonlySet<string> = new Set(["RATE_AT", "AT_RATE", "AT"]);

/**
 * Whether `token` is the word a density ends in, `dpi` or `ppi` (any case).
 *
 * @param token - The token after the density's number, or undefined at the end of the line.
 * @returns True for `dpi`, `ppi`, `DPI` or `PPI`.
 */
export function isDensityWord(token: Token | undefined): boolean {
	if (token === undefined || token.type !== "IDENT") return false;
	return DENSITY_WORDS.has((token.value ?? "").toLowerCase());
}

/** A density phrase found at a position: how many tokens it spans, and the density it states. */
export interface DensityPhrase {
	/** Tokens from `at` to the density word, inclusive. */
	readonly length: number;
	/** The density as written (`300`, `-300`), or `""` when a name stands in the number's place. */
	readonly density: string;
}

/**
 * The `at <n> dpi` phrase starting at `pos`, or null when there is none.
 *
 * The number may carry a minus sign, so `at -300 dpi` is read as the density it
 * states and refused as one, rather than leaving `at` unexplained. A name in the
 * number's place (`at d dpi`) is read too, with an empty density, for the same
 * reason.
 *
 * @param tokens - The line's tokens.
 * @param pos - Where `at` might be.
 * @returns The phrase, or null.
 */
export function densityPhraseAt(tokens: readonly Token[], pos: number): DensityPhrase | null {
	const head = tokens[pos];
	if (head === undefined || !AT_TYPES.has(head.type)) return null;
	const first = tokens[pos + 1];
	if (first === undefined) return null;
	if (first.type === "MINUS") {
		const number = tokens[pos + 2];
		if (number?.type !== "NUMBER" || !isDensityWord(tokens[pos + 3])) return null;
		return { length: 4, density: `-${number.value ?? ""}` };
	}
	if (first.type !== "NUMBER" && first.type !== "IDENT" && first.type !== "UNIT") return null;
	if (!isDensityWord(tokens[pos + 2])) return null;
	return { length: 3, density: first.type === "NUMBER" ? first.value ?? "" : "" };
}

/**
 * `at 300 dpi`: the density a size on this line is measured against (#749).
 *
 * The whole phrase is required, down to the word `dpi` or `ppi`. `at` is the rate
 * operator elsewhere (`30 hours at $30/hour`, `01:02:03:04 at 30 fps`), so it is
 * claimed only when a number and a density word follow it, and `dpi` stays an
 * ordinary name everywhere else (`dpi = 300` is a variable).
 *
 * The density is folded into the fused token, as `at 20px base` folds its root
 * size, because it is one number and there is nothing to work out about it.
 * See {@link densityPhraseAt} for the shapes read.
 */
export function pixelDensityNormalizerRule(priority = 76): NormalizerRule {
	const RULE = "web:pixel-density";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["RATE_AT", "AT_RATE", "AT"] }, { types: ["NUMBER", "IDENT", "UNIT", "MINUS"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const phrase = densityPhraseAt(tokens, pos);
			if (phrase === null) return null;
			const head = tokens[pos];
			const fused = new LexerToken(
				"PIXEL_DENSITY",
				PIXEL_DENSITY_ID,
				phrase.density,
				head.text ?? "at",
				head.offset,
				0,
				head.line,
				head.col,
			);
			return { consumed: phrase.length, replacement: [fused], ruleName: RULE };
		},
	};
}
