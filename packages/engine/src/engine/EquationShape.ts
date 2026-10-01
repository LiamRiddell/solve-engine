import type { Token } from "@solve-js/lexer/Token";

/**
 * Whether a line opens with a call: its second token is the `(` straight after
 * its first (`f(x) = x + 1`, `sqrt(x) = 3`).
 *
 * Such a line is never stored as an equation. Compiling leaves it to the
 * parser, which reads `f(x) = ...` as a function definition and anything else
 * as the expression it is, so the equation grammar declines it, and the
 * language service's reading of a line as a statement declines it the same
 * way: a definition the parser refused (`f(x) = x + prev`, whose body reads
 * other lines) is not code there either.
 *
 * @param tokens - A line's normalised tokens.
 */
export function opensWithCall(tokens: readonly Pick<Token, "type">[]): boolean {
	return tokens[1]?.type === "LPAREN";
}
