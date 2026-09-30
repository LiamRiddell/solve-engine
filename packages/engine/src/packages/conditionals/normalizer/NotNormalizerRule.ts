import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * The tokens after which a value is expected, so a `not` there opens one.
 *
 * The start of the line is the other such place. After anything else (a value,
 * a closing bracket, a unit) the word is not a negation: `x not` is two names.
 */
const EXPECTS_VALUE: ReadonlySet<string> = new Set([
	"IF", "THEN", "ELSE", "CHECK", "LPAREN", "COMMA",
	"AND_CONJ", "OR", "LOGICAL_AND", "LOGICAL_OR",
	"EQUALITY", "NEQ", "LT", "GT", "LTE", "GTE", "APPROX", "EQUALS",
	"BANG", "NOT",
]);

/**
 * The tokens that can open the condition a `not` negates: a bracket, a
 * boolean, a name, a number, a quoted text, another negation. A currency
 * symbol opens one too (see {@link opensCondition}), so `not $5` is refused by
 * name rather than left a parse error. Anything else after the word
 * (an `=`, an operator, the end of the line, a date word such as `now`) leaves
 * it an ordinary word, so `not = 3` still defines a variable called `not` and
 * `not + 1` still reads it.
 */
const OPENS_CONDITION: ReadonlySet<string> = new Set([
	"LPAREN", "TRUE", "FALSE", "IDENT", "NUMBER", "STRING", "BANG", "NOT",
]);

/** A currency symbol (`$`, `£`, `€`), which opens an amount of money. */
const CURRENCY_SYMBOL = /^\p{Sc}$/u;

/** Whether a token can open the condition a `not` negates. */
function opensCondition(token: Token): boolean {
	return OPENS_CONDITION.has(token.type) || CURRENCY_SYMBOL.test(token.text);
}

/** Whether a token is the word `not`, in any case. */
export function isNotWord(token: Token | undefined): boolean {
	return token !== undefined && token.type === "IDENT" && (token.value ?? "").toLowerCase() === "not";
}

/**
 * Whether the `not` at `pos` negates what follows it: it stands where a value
 * is expected and a condition follows it.
 *
 * @param tokens - The line's tokens.
 * @param pos - The index of a `not` word.
 * @returns `true` when the word is to be read as negation.
 */
export function negates(tokens: readonly Token[], pos: number): boolean {
	if (!isNotWord(tokens[pos])) return false;
	const previous = tokens[pos - 1];
	if (previous !== undefined && !EXPECTS_VALUE.has(previous.type) && !isNotWord(previous)) return false;
	const next = tokens[pos + 1];
	if (next === undefined) return false;
	return opensCondition(next) && !(next.type === "IDENT" && tokens[pos + 2]?.type === "EQUALS");
}

/**
 * `not` before a condition: logical negation (#751).
 *
 * The word is fused to a NOT token only where it stands in front of a value,
 * because "not" is ordinary English and was a free name: `not = 3` defines a
 * variable, `not + 1` reads it, and a sentence such as `not now` stays the
 * non-answer it was. A line that reads `not x = 5` is left as it was too, so
 * the word is never taken as the first half of a definition.
 */
export function notWordNormalizerRule(priority = 92): NormalizerRule {
	return {
		name: "conditionals:not",
		priority,
		shape: [{ types: ["IDENT"], values: ["not"] }],
		match(tokens, pos): NormalizerMatch | null {
			if (!negates(tokens, pos)) return null;
			return {
				consumed: 1,
				replacement: [createFusedToken("NOT", tokens[pos].text, [tokens[pos]])],
				ruleName: "conditionals:not",
			};
		},
	};
}
