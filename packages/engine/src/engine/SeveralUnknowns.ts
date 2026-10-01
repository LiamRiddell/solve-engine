/**
 * The refusal for an equation on a line of its own with more than one unknown.
 *
 * An equation line (`2x + 1 = x + 4`, then `x =>`) is stored under its one
 * unknown, the one name in it with no value, and asking for that name solves
 * it. With two or more unknowns there is no telling which one a later `x =>`
 * means, so the line is not stored (see the solving-equations page). It used to
 * fall through to the ordinary parse, which stops at the `=`: Calca's
 * `(salary / 12) * rate / 100 = net` answered `Expected an operator or the end
 * of the line, but found "="`, which says nothing about why, and `rate =>` on
 * the next line then answered `rate`.
 *
 * The line is now refused by name, saying how the engine reads an equation
 * line and the two ways to write this one: give the other unknowns values on
 * the lines above, which leaves one, or name the unknown with `solve`.
 *
 * Supporting the line instead (storing it under every unknown) was weighed and
 * not done: every `a + b = c` line, a parse error today, would become a stored
 * equation. `solve(..., rate)` gives the Calca example's `1200*net/salary`.
 */

import type { Token } from "@solve-js/lexer/Token";
import { ErrorFactory, type EngineError } from "@solve-js/errors/UnifiedErrorFramework";

/** The most unknowns the message lists by name; a longer equation is summarised after these. */
const NAMED_UNKNOWNS = 6;

/** The tokens after which a unit word is that amount's unit (`5 km`, `(1 + 2) kg`) rather than a name. */
const AMOUNT_BEFORE_UNIT: ReadonlySet<string> = new Set(["NUMBER", "BIGINT", "RPAREN", "RBRACKET"]);

/**
 * Whether the token at `index` is a name: an identifier, or a unit word with no
 * amount before it (`b`, `h`), which the arrow and the solver read as a name.
 *
 * @param tokens - The line's tokens.
 * @param index - The token to ask about.
 */
export function namesSomething(tokens: readonly Token[], index: number): boolean {
	const token = tokens[index];
	if (token === undefined) return false;
	if (token.type === "IDENT") return true;
	return token.type === "UNIT" && !AMOUNT_BEFORE_UNIT.has(tokens[index - 1]?.type ?? "");
}

/** Whether the token at `index` sits outside every bracket the tokens before it opened. */
export function isTopLevel(tokens: readonly Token[], index: number): boolean {
	let depth = 0;
	for (let i = 0; i < index && i < tokens.length; i++) {
		const type = tokens[i].type;
		if (type === "LPAREN" || type === "LBRACKET" || type === "LBRACE") depth++;
		else if (type === "RPAREN" || type === "RBRACKET" || type === "RBRACE") depth--;
	}
	return depth === 0;
}

/**
 * The text of a run of tokens as the reader typed it, a space wherever the
 * source had one: `(salary / 12) * rate`, not `( salary / 12 ) * rate`.
 *
 * @param tokens - Tokens in source order.
 * @returns Their text, joined.
 */
export function typedText(tokens: readonly Token[]): string {
	let out = "";
	let end = -1;
	for (const token of tokens) {
		if (out !== "" && token.offset > end) out += " ";
		out += token.text;
		end = token.sourceEnd ?? token.offset + token.text.length;
	}
	return out;
}

/** A list of names in prose: `a`, `a and b`, `a, b and c`. */
export function nameList(names: readonly string[]): string {
	const shown = names.slice(0, NAMED_UNKNOWNS);
	const rest = names.length - shown.length;
	if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
	if (shown.length <= 1) return shown.join("");
	return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/**
 * The refusal for an equation line with more than one unknown.
 *
 * @param unknowns - The names with no value, in the order written; two or more.
 * @param tokens - The line's tokens, for the equation the message quotes.
 * @returns The error to throw.
 */
export function severalUnknownsRefusal(unknowns: readonly string[], tokens: readonly Token[]): EngineError {
	const equation = typedText(tokens);
	return ErrorFactory.parsing({
		code: "EQUATION_SEVERAL_UNKNOWNS",
		message: `This equation has ${unknowns.length} unknowns, ${nameList(unknowns)}, and an equation on a line of its own is solved for its one unknown. Give the others values on the lines above it, or name the one to solve for, as in solve(${equation}, ${unknowns[0]}).`,
		suggestion: `solve(${equation}, ${unknowns[0]})`,
		context: { unknowns: [...unknowns] },
	});
}

/**
 * The refusal for a stored product equation (`a*x = b`) asked for its last name
 * while a factor before it has no value.
 *
 * A product of names is stored as an equation on sight and solved by
 * multiplying out its factors' values, which is how a matrix system is solved;
 * a factor with no value leaves nothing to multiply. Solving for `x` in terms
 * of `a` is a different question, the one `solve` answers, so the refusal
 * names both ways forward: give the factor a value above, or ask `solve`.
 *
 * @param variable - The name asked for (`x`).
 * @param factor - The first factor with no value (`a`).
 * @param text - The equation as typed, when it was stored with it.
 * @returns The message, with `solve(<text>, <variable>)` when the text is known.
 */
export function undefinedFactorMessage(variable: string, factor: string, text: string | undefined): string {
	const asked = `Cannot solve for "${variable}": "${factor}" is not yet defined.`;
	if (text === undefined || text.trim() === "") return `${asked} Give "${factor}" a value on a line above.`;
	return `${asked} Give "${factor}" a value on a line above, or solve for "${variable}" in terms of it with solve(${text}, ${variable}).`;
}
