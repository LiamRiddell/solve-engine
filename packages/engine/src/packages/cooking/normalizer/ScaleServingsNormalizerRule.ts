import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const SCALE_ID = tokenTypeId("SCALE_SERVINGS");

/** The words a reader puts between the two counts, none of which the arithmetic needs. */
const SERVING_WORDS = new Set(["servings", "serving", "serves", "people", "portions", "portion"]);

/**
 * `scale <n> [servings] to <n>`: the whole shape, or nothing.
 *
 * `scale` is deliberately not a lexer keyword. It is an ordinary word and a
 * common variable name, and claiming it everywhere broke lines that were
 * already written: `:scale = :desired / :original` stopped defining a variable
 * and became a parse error, which the playground's own recipe example does.
 *
 * So the word is only claimed when the rest of the shape is there to claim it:
 * a count, an optional word for what the count counts, then `to`. Anything
 * else leaves `scale` an ordinary identifier.
 *
 * @module ScaleServingsNormalizerRule
 */

/** The rule: see the module comment for why the whole shape is required. */
export function scaleServingsNormalizerRule(priority = 85): NormalizerRule {
	const RULE = "cooking:scale-servings";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["IDENT"], values: ["scale"] }, { types: ["NUMBER", "BIGINT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const head = tokens[pos];
			if (head?.type !== "IDENT" || (head.value ?? "").toLowerCase() !== "scale") return null;
			const count = tokens[pos + 1];
			if (count?.type !== "NUMBER" && count?.type !== "BIGINT") return null;

			// The noun is optional, so `to` is either two or three tokens along.
			let at = pos + 2;
			const noun = tokens[at];
			if (noun?.type === "IDENT" && SERVING_WORDS.has((noun.value ?? "").toLowerCase())) at += 1;
			if (tokens[at]?.type !== "TO") return null;

			const fused = new LexerToken("SCALE_SERVINGS", SCALE_ID, "scale", head.text ?? "scale", head.offset, 0, head.line, head.col);
			return { consumed: 1, replacement: [fused], ruleName: RULE };
		},
	};
}
