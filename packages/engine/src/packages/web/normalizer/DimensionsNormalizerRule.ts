import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const DIMENSIONS_ID = tokenTypeId("DIMENSIONS");
const RESIZE_ID = tokenTypeId("RESIZE");

/** `x1080`, the shape the lexer leaves when a number is written straight after the `x`. */
const JOINED = /^x(\d+)$/i;

/**
 * `1920x1080`: a width and a height, when the line goes on to ask something of
 * the pair.
 *
 * Only when it does, which is what keeps this narrow. On its own, `1920x1080`
 * is a multiplication by a variable named `x1080`, and it still is: the pair is
 * claimed only after `resize`, or before `as ratio`, the two forms that have
 * something to say about a width and a height together. A rule that claimed
 * every `<number>x<number>` would quietly change what `3x4` means for anyone
 * whose `x4` is a variable.
 *
 * Both spellings a person writes are read, `1920x1080` and `1920 x 1080`: the
 * lexer leaves the first as one identifier (`x1080`) and the second as a bare
 * `x` between two numbers.
 *
 * @module DimensionsNormalizerRule
 */

/** Whether the token is the word `resize`, before or after its own rule has claimed it. */
function isResize(token: Token | undefined): boolean {
	if (token === undefined) return false;
	if (token.type === "RESIZE") return true;
	return token.type === "IDENT" && (token.value ?? "").toLowerCase() === "resize";
}

/** Whether `as ratio` follows, the other shape that asks something of the pair. */
function asksForRatio(tokens: Token[], at: number): boolean {
	const as = tokens[at];
	if (as?.type !== "AS" && as?.type !== "IN") return false;
	const name = tokens[at + 1];
	if (name === undefined) return false;
	if (name.type !== "IDENT" && name.type !== "CONVERTER_NAME") return false;
	return (name.value ?? "").toLowerCase() === "ratio";
}

/** The rule: see the module comment for why the surrounding shape is required. */
export function dimensionsNormalizerRule(priority = 76): NormalizerRule {
	const RULE = "web:dimensions";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["NUMBER"] }, { types: ["IDENT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const head = tokens[pos];
			if (head?.type !== "NUMBER") return null;
			const marker = tokens[pos + 1];
			if (marker?.type !== "IDENT") return null;

			const word = (marker.value ?? "").toLowerCase();
			const joined = JOINED.exec(word);
			let height: string;
			let consumed: number;
			if (joined !== null) {
				height = joined[1];
				consumed = 2;
			} else if (word === "x") {
				const second = tokens[pos + 2];
				if (second?.type !== "NUMBER") return null;
				height = second.value ?? "";
				consumed = 3;
			} else {
				return null;
			}

			const width = head.value ?? "";
			if (!isResize(tokens[pos - 1]) && !asksForRatio(tokens, pos + consumed)) return null;

			const value = `${width}x${height}`;
			const text = tokens
				.slice(pos, pos + consumed)
				.map((t) => t.text ?? "")
				.join("");
			const fused = new LexerToken("DIMENSIONS", DIMENSIONS_ID, value, text, head.offset, 0, head.line, head.col);
			return { consumed, replacement: [fused], ruleName: RULE };
		},
	};
}

/**
 * `resize`, when a width and a height follow it.
 *
 * The same discipline the pair itself is under, and for the same reason:
 * `resize` is an ordinary word, and a keyword would claim it in `:resize = 2`
 * and in a note that merely mentions resizing. Requiring the dimensions is what
 * makes the claim narrow enough to be safe.
 */
export function resizeNormalizerRule(priority = 76): NormalizerRule {
	const RULE = "web:resize";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["IDENT"], values: ["resize"] }, { types: ["NUMBER"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const head = tokens[pos];
			if (head?.type !== "IDENT" || (head.value ?? "").toLowerCase() !== "resize") return null;
			const width = tokens[pos + 1];
			if (width?.type !== "NUMBER") return null;
			const marker = tokens[pos + 2];
			if (marker?.type !== "IDENT") return null;
			const word = (marker.value ?? "").toLowerCase();
			if (!JOINED.test(word) && word !== "x") return null;

			const fused = new LexerToken("RESIZE", RESIZE_ID, "resize", head.text ?? "resize", head.offset, 0, head.line, head.col);
			return { consumed: 1, replacement: [fused], ruleName: RULE };
		},
	};
}
