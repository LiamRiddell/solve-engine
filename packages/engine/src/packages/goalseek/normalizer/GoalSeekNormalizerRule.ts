import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const GOAL_SEEK_TYPE_ID = tokenTypeId("GOAL_SEEK");

/**
 * Fuses the bare word `solve` into a `GOAL_SEEK` token, but ONLY when it is
 * immediately followed by a `LINE_REF` (`solve line 4 for rate = 900`).
 *
 * The lookahead is what keeps this from touching anything that already worked.
 * `solve(x^2-4=0, x)` puts an `LPAREN` after `solve`, which
 * `SymbolicCallNormalizerRule` fuses into `SOLVE_FN` instead; a `LINE_REF`
 * there is a different shape entirely, so the two never compete. And `:solve =
 * 2` keeps `solve` usable as an ordinary variable name, since `solve` is never
 * a bare lexer keyword and the colon guard below refuses the one case where a
 * definition's name could sit directly before a line reference.
 *
 * Depends on `LineRefNormalizerRule` having already fused `line 4` into a
 * `LINE_REF` in an earlier pass. The normalizer's multi-pass loop guarantees
 * that: the line-ref rule runs at priority 80, this one lower, and a fusion
 * only becomes visible to other rules on the pass after it lands, so by the
 * time this rule sees `solve` the `LINE_REF` beside it already exists.
 *
 * @param priority - Rule ordering within the normalizer, below the line-ref
 * rule's own band so this reads a `LINE_REF` the earlier rule minted.
 * @returns The normalizer rule.
 */
export function goalSeekNormalizerRule(priority = 75): NormalizerRule {
	return {
		name: "goalseek:solve-line",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["IDENT"], values: ["solve"] }, { types: ["LINE_REF"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			// A definition's own name (`:solve = ...`) is never this trigger, so a
			// COLON immediately before the word rules it out, the same guard every
			// other trigger-word rule in this codebase uses.
			if (pos > 0 && tokens[pos - 1].type === "COLON") return null;

			const token = tokens[pos];
			if (!token || token.type !== "IDENT" || token.value.toLowerCase() !== "solve") return null;
			if (tokens[pos + 1]?.type !== "LINE_REF") return null;

			// consumed = 1: only the word "solve" becomes GOAL_SEEK; the LINE_REF
			// stays for GoalSeekParselet to read as the target line.
			return {
				consumed: 1,
				replacement: [
					new LexerToken("GOAL_SEEK", GOAL_SEEK_TYPE_ID, token.value, token.value, token.offset, 0, token.line, token.col),
				],
				ruleName: "goalseek:solve-line",
			};
		},
	};
}
