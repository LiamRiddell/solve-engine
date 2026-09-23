import type { Token } from "@solve-js/lexer/Token";

/**
 * The token types after which an expression expects a value to begin: an
 * operator, an opening bracket, a separator or an assignment.
 */
const VALUE_STARTS_AFTER: ReadonlySet<string> = new Set([
	"PLUS", "MINUS", "STAR", "SLASH", "CARET", "PERCENT", "MOD", "PLUS_MINUS",
	"LPAREN", "LBRACKET", "LBRACE", "COMMA", "EQUALS", "PLUS_EQUALS", "MINUS_EQUALS",
	"COLON", "SEMICOLON", "AND_CONJ", "OF", "BIT_AND", "BIT_OR", "BIT_NOT", "LSHIFT", "RSHIFT", "URSHIFT",
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
