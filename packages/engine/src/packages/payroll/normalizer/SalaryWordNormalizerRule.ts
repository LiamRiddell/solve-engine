import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/**
 * `£50,000 salary after tax`: the word `salary` between an amount and a
 * take-home form is a flourish, and is dropped.
 *
 * It used to be part of the fused phrases themselves (`salary after tax`,
 * `salary per month after tax`), which claimed the word wherever it stood. A
 * reader who named a variable `salary` (`salary = £50,000`) and then asked for
 * `salary after tax` had the name swallowed into the phrase, leaving the form
 * with nothing before it: "Expected a value". The phrases are now `after tax`
 * and `per month after tax` alone, and this rule drops `salary` only where it
 * follows an amount, so the name before a form is the variable it is.
 *
 * "Follows an amount" means the token before the word ends a value: a number,
 * a closing bracket, a percentage sign or a word, or the multiplication the
 * normaliser inserts between an amount and a word (which is dropped with it).
 * A typed operator, an `=`, a `:` or the start of the line is not, so
 * `salary after tax`, `:net = salary after tax` and `2 * salary after tax`
 * all read `salary` as a name.
 *
 * @module SalaryWordNormalizerRule
 */

/** The take-home forms the flourish may stand before. */
const TAKE_HOME_FORMS: ReadonlySet<string> = new Set(["AFTER_TAX", "AFTER_TAX_MONTHLY"]);

/** Tokens that end a value, so a word after one is not a name being read. */
const VALUE_ENDS: ReadonlySet<string> = new Set(["NUMBER", "RPAREN", "RBRACKET", "PERCENT", "IDENT", "UNIT"]);

/** Whether `token` is the word `salary`, in any case. */
function isSalaryWord(token: Token | undefined): boolean {
	return token !== undefined && (token.type === "IDENT" || token.type === "UNIT") && (token.text ?? token.value ?? "").toLowerCase() === "salary";
}

/**
 * Whether a token is a multiplication the normaliser inserted rather than one
 * the reader typed: it is built at the offset of the token it precedes.
 */
function isInsertedStar(token: Token | undefined, next: Token | undefined): boolean {
	return token?.type === "STAR" && next !== undefined && token.offset === next.offset;
}

/**
 * What to do at `pos`: `"star"` when an inserted `*` and the word stand
 * before a take-home form (both are dropped), `"after"` when a token ending a
 * value does (the word after it is dropped), and null otherwise.
 *
 * The word is dropped from the token before it rather than at the word
 * itself, because the normaliser inserts its `*` from that same token in the
 * same pass: matched there, first, the flourish goes before the `*` is made.
 *
 * @param tokens - The line's tokens, part-way through normalising.
 * @param pos - The position being tried.
 * @returns The kind of match, or null.
 */
export function salaryFlourishAt(tokens: readonly Token[], pos: number): "star" | "after" | null {
	const here = tokens[pos];
	if (here === undefined || !isSalaryWord(tokens[pos + 1]) || !TAKE_HOME_FORMS.has(tokens[pos + 2]?.type ?? "")) return null;
	if (isInsertedStar(here, tokens[pos + 1])) return pos > 0 ? "star" : null;
	return VALUE_ENDS.has(here.type) ? "after" : null;
}

/** The rule: see the module comment for where the word counts as a flourish. */
export function salaryWordNormalizerRule(priority = 73): NormalizerRule {
	const RULE = "payroll:salary-word";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["STAR", ...VALUE_ENDS] }, { types: ["IDENT", "UNIT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const kind = salaryFlourishAt(tokens, pos);
			if (kind === null) return null;
			return { consumed: 2, replacement: kind === "star" ? [] : [tokens[pos]], ruleName: RULE };
		},
	};
}
