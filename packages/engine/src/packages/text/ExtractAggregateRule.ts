import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * The shipped aggregate each fused trigger stands for, by the builtin index its
 * math-phrase parselet calls.
 */
const AGGREGATE_INDEX: Readonly<Record<string, number>> = {
	AVERAGE_OF: 42,
	MEDIAN_OF: 43,
	TOTAL_OF: 44,
	COUNT_OF: 45,
	STANDARD_DEVIATION_OF: 101,
	SAMPLE_STANDARD_DEVIATION_OF: 102,
	VARIANCE_OF: 103,
	SAMPLE_VARIANCE_OF: 104,
	SPREAD_OF: 105,
	MODE_OF: 106,
};

/** Which values each extraction phrase reads. */
const SOURCE: Readonly<Record<string, string>> = {
	NUMBERS_IN: "numbers",
	AMOUNTS_IN: "amounts",
};

/** The index of `total of`, which `sum of` also means. */
const TOTAL_INDEX = 44;

/** The name both rules report a fusion under. */
const RULE_NAME = "text:extract-aggregate";

/** The lowercased written form of a token. */
function wordOf(token: Token | undefined): string {
	if (token === undefined) return "";
	return (token.text ?? token.value ?? "").toLowerCase();
}

/** The fusion of `consumed` tokens from `pos`, ending in an extraction phrase, or null when they do not. */
function fuse(tokens: Token[], pos: number, consumed: number, index: number): NormalizerMatch | null {
	const phrase = tokens[pos + consumed - 1];
	if (phrase === undefined || !Object.prototype.hasOwnProperty.call(SOURCE, phrase.type)) return null;
	return {
		consumed,
		replacement: [createFusedToken("TEXT_EXTRACT_AGGREGATE", `${index}:${SOURCE[phrase.type]}`, tokens.slice(pos, pos + consumed))],
		ruleName: RULE_NAME,
	};
}

/**
 * `total of numbers in X`, `average of amounts in X`, `sum of numbers in X`
 * and the rest: an aggregate directly followed by an extraction phrase.
 *
 * Without this, `numbers in X` would hand the aggregate one bracketed list,
 * which the aggregates refuse (a list is one value, not several). Fusing the
 * pair into one `TEXT_EXTRACT_AGGREGATE` token lets the aggregate read the
 * numbers themselves, and keep an amount's currency, which a list cannot hold.
 *
 * The math-phrase package fuses `total of` and its siblings into their own
 * trigger tokens, and the text package fuses `numbers in` and `amounts in`,
 * so by the pass these rules match in, both halves are single tokens. `sum of`
 * has no phrase of its own and arrives as the words `sum` and `of`, the shape
 * the category-tag aggregate rule reads it in, so it has a rule of its own with
 * a narrower shape than every identifier. Anything else after the trigger
 * (`total of 1, 2`) is left alone for the ordinary aggregate.
 */
export function extractAggregateRules(priority = 80): NormalizerRule[] {
	return [
		{
			name: RULE_NAME,
			priority,
			shape: [{ types: Object.keys(AGGREGATE_INDEX) }, { types: Object.keys(SOURCE) }],
			match(tokens, pos): NormalizerMatch | null {
				const head = tokens[pos];
				if (head === undefined || !Object.prototype.hasOwnProperty.call(AGGREGATE_INDEX, head.type)) return null;
				return fuse(tokens, pos, 2, AGGREGATE_INDEX[head.type]);
			},
		},
		{
			name: `${RULE_NAME}:sum`,
			priority,
			shape: [{ types: ["IDENT"], values: ["sum"] }, { values: ["of"] }, { types: Object.keys(SOURCE) }],
			match(tokens, pos): NormalizerMatch | null {
				const head = tokens[pos];
				if (head?.type !== "IDENT" || wordOf(head) !== "sum" || wordOf(tokens[pos + 1]) !== "of") return null;
				return fuse(tokens, pos, 3, TOTAL_INDEX);
			},
		},
	];
}
