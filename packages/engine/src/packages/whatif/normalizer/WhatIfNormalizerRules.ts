import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/** The token a what-if opens with: `line N with`, carrying N. */
export const WHAT_IF_TOKEN = "WHAT_IF";
/** The token a sweep opens with: `line N for`, carrying N. */
export const SWEEP_TOKEN = "SWEEP";
/** The `step` of a sweep, once it is known to be one rather than a variable. */
export const SWEEP_STEP_TOKEN = "SWEEP_STEP";

const WHAT_IF_TYPE_ID = tokenTypeId(WHAT_IF_TOKEN);
const SWEEP_TYPE_ID = tokenTypeId(SWEEP_TOKEN);
const SWEEP_STEP_TYPE_ID = tokenTypeId(SWEEP_STEP_TOKEN);

/** Whether a token can be a variable's name: an identifier, or a unit symbol used as one (`m`, `s`). */
function isName(token: Token | undefined): boolean {
	return token !== undefined && (token.type === "IDENT" || token.type === "UNIT");
}

/**
 * The index just past a variable's name that starts at `i`, or -1 when none
 * does. The name is written bare (`price`) or with the colon a definition takes
 * (`:price`), which the lexer keeps as a separate COLON: a reader who defined
 * `:price = 100` writes `line 2 with :price = 300`, and without this the
 * colon kept the rule from firing, `with` stayed the word for `+`, and the
 * line added the assignment (`= 420`, and `:price` overwritten).
 */
function afterName(tokens: Token[], i: number): number {
	if (tokens[i]?.type === "COLON" && isName(tokens[i + 1])) return i + 2;
	return isName(tokens[i]) ? i + 1 : -1;
}

/** Whether a token is the word `with`, which the English keyword map reads as addition. */
function isWith(token: Token | undefined): boolean {
	return token !== undefined && (token.type === "PLUS" || token.type === "IDENT") && token.value.toLowerCase() === "with";
}

/** Whether a token is the word `for`: a keyword in the English locale, an identifier elsewhere. */
function isFor(token: Token | undefined): boolean {
	return (
		token !== undefined &&
		(token.type === "FOR_DURATION" || (token.type === "IDENT" && token.value.toLowerCase() === "for"))
	);
}

/** A token of `type` standing where `source` stood, carrying `value`. */
function tokenAt(type: string, typeId: number, value: string, source: Token): Token {
	return new LexerToken(type, typeId, value, source.text ?? source.value, source.offset, 0, source.line, source.col);
}

/**
 * Fuses `line N with` into a `WHAT_IF` token carrying N, but only where a
 * `<name> =` follows: `line 4 with deposit = 150000`.
 *
 * The English keyword map reads `with` as `+` (`5 with 3` is 8), so without
 * the lookahead to a name and an `=` this would take a sum away from anyone
 * who writes `line 4 with 10`. The `=` settles it: no sum has one there.
 *
 * Runs after `LineRefNormalizerRule` has minted the `LINE_REF`, the same
 * ordering goal seek's `solve` rule relies on: a fusion is visible to other
 * rules from the pass after it lands.
 *
 * @param priority - Rule ordering, below the line-reference rule's own band.
 * @returns The normalizer rule.
 */
export function whatIfNormalizerRule(priority = 75): NormalizerRule {
	const RULE = "whatif:line-with";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["LINE_REF"] }, { types: ["PLUS", "IDENT"], values: ["with"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const lineRef = tokens[pos];
			if (!lineRef || lineRef.type !== "LINE_REF") return null;
			// The second half of a `line 1 : line 4` range is not a what-if target.
			if (tokens[pos - 1]?.type === "COLON") return null;
			if (!isWith(tokens[pos + 1])) return null;
			const afterInput = afterName(tokens, pos + 2);
			if (afterInput < 0 || tokens[afterInput]?.type !== "EQUALS") return null;
			return {
				consumed: 2,
				replacement: [tokenAt(WHAT_IF_TOKEN, WHAT_IF_TYPE_ID, lineRef.value, lineRef)],
				ruleName: RULE,
			};
		},
	};
}

/**
 * Fuses `line N for <name> from` into a `SWEEP` token carrying N, and the
 * sweep's `step` word into a `SWEEP_STEP` token:
 * `line 4 for rate from 3% to 6% step 1%`.
 *
 * `step` is not a keyword anywhere else, and must not become one (it is a
 * natural variable name), so it is recognised only here, as the first `step`
 * after the sweep opens and outside any brackets. It is converted in the same
 * match that opens the sweep, because by the time a rule reached `step` on
 * its own, implicit multiplication would already have read `$300 step` as
 * `$300 * step`. That multiplication is inserted as a zero-width `*` at the
 * word's own offset, which is how it is told apart from a `*` the writer
 * typed, and it is dropped.
 *
 * Without a `step` the sweep still opens, and its parselet reports the
 * missing step by name rather than the line failing as an unrelated parse.
 *
 * @param priority - Rule ordering, below the line-reference rule's own band.
 * @returns The normalizer rule.
 */
export function sweepNormalizerRule(priority = 75): NormalizerRule {
	const RULE = "whatif:line-for";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["LINE_REF"] }, { types: ["FOR_DURATION", "IDENT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const lineRef = tokens[pos];
			if (!lineRef || lineRef.type !== "LINE_REF") return null;
			if (tokens[pos - 1]?.type === "COLON") return null;
			// `solve line 4 for rate = 900` is goal seek, which owns this shape.
			if (tokens[pos - 1]?.type === "GOAL_SEEK") return null;
			if (!isFor(tokens[pos + 1])) return null;
			const afterInput = afterName(tokens, pos + 2);
			if (afterInput < 0 || tokens[afterInput]?.type !== "FROM") return null;

			const opener = tokenAt(SWEEP_TOKEN, SWEEP_TYPE_ID, lineRef.value, lineRef);
			let depth = 0;
			for (let i = afterInput + 1; i < tokens.length; i++) {
				const t = tokens[i];
				if (t.type === "LPAREN" || t.type === "LBRACKET") depth++;
				else if (t.type === "RPAREN" || t.type === "RBRACKET") depth--;
				else if (depth === 0 && t.type === "IDENT" && t.value.toLowerCase() === "step") {
					const before = tokens[i - 1];
					const inserted = before.type === "STAR" && before.offset === t.offset;
					const middle = tokens.slice(pos + 2, inserted ? i - 1 : i);
					return {
						consumed: i - pos + 1,
						replacement: [opener, ...middle, tokenAt(SWEEP_STEP_TOKEN, SWEEP_STEP_TYPE_ID, t.value, t)],
						ruleName: RULE,
					};
				}
			}
			return { consumed: 2, replacement: [opener], ruleName: RULE };
		},
	};
}
