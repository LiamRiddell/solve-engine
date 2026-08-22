import { Parser } from "@solve-js/parser/Parser";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";

/**
 * Parse the two trailing clauses an interest or repayment phrase carries, the
 * TERM (`over|after|for <years>`) and the RATE (`at|@ <rate>`), in EITHER order.
 *
 * A calculator that reads like a sentence should accept both `... over 3 years
 * at 5%` and `... at 5% over 3 years`, since the two clauses are independent and
 * a person has no way to know which order the grammar wants (#120). Each caller
 * keeps its own term words (`termWords`) so the fix is purely about order, not
 * about admitting new spellings.
 *
 * The value expression for each clause is emitted onto the stack as it is parsed,
 * so term-first leaves `[years, rate]` on top and rate-first leaves `[rate,
 * years]`. The shared finance builtins take the operands `[..., rate, years]`,
 * so this returns whether the caller must `SWAP` the top two to get there: a swap
 * for the term-first order, none for the rate-first order.
 */
export function parseTermAndRate(parser: Parser, builder: BytecodeBuilder, termWords: readonly string[]): { swap: boolean } {
	if (matchTerm(parser, termWords)) {
		parser.parseExpression(BindingPower.Lowest, builder); // years
		consumeRate(parser);
		parser.parseExpression(BindingPower.Lowest, builder); // rate
		return { swap: true };
	}
	consumeRate(parser);
	parser.parseExpression(BindingPower.Lowest, builder); // rate
	consumeTerm(parser, termWords);
	parser.parseExpression(BindingPower.Lowest, builder); // years
	return { swap: false };
}

/** True if the next token is one of the accepted term words, consuming it. */
function matchTerm(parser: Parser, termWords: readonly string[]): boolean {
	for (const word of termWords) {
		if (parser.match(word)) return true;
	}
	return false;
}

/** Require a term word, throwing the same `Expected OVER` a caller used to. */
function consumeTerm(parser: Parser, termWords: readonly string[]): void {
	if (matchTerm(parser, termWords)) return;
	parser.consume(termWords[0]);
}

/** Require the rate word: the fused `@` (`RATE_AT`) or the bare `at`. */
function consumeRate(parser: Parser): void {
	if (!parser.match("RATE_AT")) parser.consume("AT");
}
