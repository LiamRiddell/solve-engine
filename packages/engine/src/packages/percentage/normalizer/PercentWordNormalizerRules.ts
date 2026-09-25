/**
 * Percentages written in words (#705): `15 percent of 60`, `20 is what percent
 * of 80`, and `reduce 50 by 20%`.
 */

import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const PERCENT_ID = tokenTypeId("PERCENT");
const DECREASE_ID = tokenTypeId("DECREASE");

/** The words that mean the `%` sign after an amount. */
const PERCENT_WORDS: ReadonlySet<string> = new Set(["percent", "percentage"]);

/** What a percentage is written after: an amount, a bracket, or a name (`rate percent`, `what percent`). */
const RATE_BEFORE: ReadonlySet<string> = new Set(["NUMBER", "RPAREN", "IDENT"]);

/**
 * `percent` or `percentage` after an amount is the `%` sign: `15 percent of 60`
 * is `15% of 60`, and `20 is what percent of 80` is `20 is what % of 80`.
 *
 * Both words stay the converter's name after `as`, `in` or `to` (`0.25 as
 * percent`), since there the token before them is the conversion keyword, not
 * an amount.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function percentWordNormalizerRule(priority = 60): NormalizerRule {
	return {
		name: "percentage:percent-word",
		priority,
		shape: [{ types: [...RATE_BEFORE] }, { types: ["CONVERTER_NAME"] }],
		match(tokens, pos): NormalizerMatch | null {
			const before = tokens[pos];
			const word = tokens[pos + 1];
			if (!RATE_BEFORE.has(before.type) || word?.type !== "CONVERTER_NAME") return null;
			if (!PERCENT_WORDS.has((word.text ?? "").toLowerCase())) return null;
			const sign = new LexerToken("PERCENT", PERCENT_ID, "%", word.text, word.offset, 0, word.line, word.col, word.sourceEnd ?? word.offset + word.text.length);
			return { consumed: 2, replacement: [before, sign], ruleName: "percentage:percent-word" };
		},
	};
}

/** Whether a `by` further along is followed by a percentage: `by 20%`, `by 20 percent`. */
function reducesByPercentage(tokens: readonly Token[], from: number): boolean {
	for (let i = from; i < tokens.length; i++) {
		if (tokens[i].type !== "BY") continue;
		const amount = tokens[i + 1]?.type === "MINUS" ? i + 2 : i + 1;
		if (tokens[amount]?.type !== "NUMBER") return false;
		const after = tokens[amount + 1];
		return after?.type === "PERCENT" || (after?.type === "CONVERTER_NAME" && PERCENT_WORDS.has((after.text ?? "").toLowerCase()));
	}
	return false;
}

/**
 * `reduce 50 by 20%` is `decrease 50 by 20%`, which is 40.
 *
 * `reduce` is also map-reduce's call (`reduce(...)`), so the word is read this
 * way only when no bracket follows it and the amount after its `by` is a
 * percentage. A bare amount (`reduce 50 by 20`) is left alone: the decrease
 * form reads it as a factor, and a word that answered -950 for that would be a
 * worse answer than none.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function reduceByNormalizerRule(priority = 60): NormalizerRule {
	return {
		name: "percentage:reduce-by",
		priority,
		shape: [{ types: ["IDENT"], values: ["reduce"] }],
		match(tokens, pos): NormalizerMatch | null {
			const word = tokens[pos];
			if (word.type !== "IDENT" || (word.text ?? "").toLowerCase() !== "reduce") return null;
			const next = tokens[pos + 1];
			if (next === undefined || next.type === "LPAREN" || next.type === "EQUALS") return null;
			if (!reducesByPercentage(tokens, pos + 1)) return null;
			const decrease = new LexerToken("DECREASE", DECREASE_ID, "decrease", word.text, word.offset, 0, word.line, word.col, word.sourceEnd ?? word.offset + word.text.length);
			return { consumed: 1, replacement: [decrease], ruleName: "percentage:reduce-by" };
		},
	};
}
