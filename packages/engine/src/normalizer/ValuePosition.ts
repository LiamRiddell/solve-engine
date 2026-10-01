import type { Token } from "@solve-js/lexer/Token";

/**
 * The token types after which an expression expects a value to begin: an
 * operator, an opening bracket, a separator or an assignment, and the word of
 * a form that is followed by its amount (`split <amount> between <N>`, the
 * `SPLIT` token the bill-split rule retypes the word to), so `split 1/2 KWD
 * between 3` splits half a dinar as `1/2 KWD` on its own line is one.
 */
const VALUE_STARTS_AFTER: ReadonlySet<string> = new Set([
	"PLUS", "MINUS", "STAR", "SLASH", "CARET", "PERCENT", "MOD", "PLUS_MINUS",
	"LPAREN", "LBRACKET", "LBRACE", "COMMA", "EQUALS", "PLUS_EQUALS", "MINUS_EQUALS", "STAR_EQUALS", "SLASH_EQUALS",
	"COLON", "SEMICOLON", "AND_CONJ", "OF", "BIT_AND", "BIT_OR", "BIT_NOT", "LSHIFT", "RSHIFT", "URSHIFT",
	"SPLIT",
]);

/**
 * Whether the token at `pos` sits where the expression expects a value to
 * start: the first token of the line, or one following an operator, bracket,
 * separator or `=`.
 *
 * The lexer reads every word the unit table knows as a UNIT token, including
 * the ones a reader uses as variable names: `m`, `s`, `h`, `g`. A unit is
 * written after a value (`9.81 m/s^2`, `100 km/h`, `in km/h`), so a rule that
 * fuses unit spellings together checks this first and leaves a word in a value
 * position alone. With `m = 3` and `s = 2`, the line `m/s^2` is then the
 * reader's own division, 0.75, rather than a unit that names nothing.
 *
 * @param tokens - The line's tokens.
 * @param pos - The index of the token in question.
 */
export function expectsValueAt(tokens: readonly Token[], pos: number): boolean {
	const before = tokens[pos - 1];
	return before === undefined || VALUE_STARTS_AFTER.has(before.type);
}

/**
 * The tokens that end a value, so a `+` or `-` after one is binary. A unary
 * minus (`-P1DT1H`, `2 * -1 month 1 day`) has an operator or nothing before it.
 */
const VALUE_ENDS: ReadonlySet<string> = new Set([
	"NUMBER", "BIGINT", "IDENT", "UNIT", "RPAREN", "RBRACKET", "STRING",
	"DATETIME_LITERAL", "NOW", "TODAY", "TOMORROW", "YESTERDAY", "CLOCK_TIME", "ISO_DURATION",
]);

/**
 * The tokens that may follow a length spread through a sum: the end of the
 * line, or an operator that binds no tighter than `+`, so `a + 1 month 1 day`
 * read as `a + 1 month + 1 day` means what `a + (1 month 1 day)` would mean.
 * Anything tighter (`* 2`, `in days`) leaves the length whole.
 */
const LOOSE_AFTER: ReadonlySet<string> = new Set([
	"PLUS", "MINUS", "RPAREN", "RBRACKET", "COMMA", "SEMICOLON", "NEWLINE", "EOF",
	"GT", "LT", "GTE", "LTE", "EQUALITY", "NEQ",
]);

/**
 * Whether a length of several parts, spanning `consumed` tokens from `pos`, is
 * the right side of an addition or subtraction that its parts can be spread
 * through: a binary `+` or `-` before it, and nothing that binds tighter after
 * it. When it is, `d + 1 month 1 day` can be read `d + 1 month + 1 day`, each
 * part in turn, which is what a date needs: the month moves the month field
 * (clamped to the month's last day) before the day moves the day field.
 *
 * @param tokens - The line's tokens.
 * @param pos - The index of the length's first token.
 * @param consumed - How many tokens the length spans.
 * @returns The operator token to repeat between the parts, or null when the
 *   length is to stay one quantity.
 */
export function spreadOperatorBefore(tokens: readonly Token[], pos: number, consumed: number): Token | null {
	const before = tokens[pos - 1];
	if (before === undefined || (before.type !== "PLUS" && before.type !== "MINUS")) return null;
	const operand = tokens[pos - 2];
	if (operand === undefined || !VALUE_ENDS.has(operand.type)) return null;
	const after = tokens[pos + consumed];
	return after === undefined || LOOSE_AFTER.has(after.type) ? before : null;
}
