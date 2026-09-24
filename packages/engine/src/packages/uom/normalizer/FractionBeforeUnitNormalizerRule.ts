import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { expectsValueAt } from "@solve-js/normalizer/ValuePosition";

const LPAREN_ID = tokenTypeId("LPAREN");
const RPAREN_ID = tokenTypeId("RPAREN");

/**
 * Operators after which a fraction is not the start of an amount: the number
 * belongs to the division or power before it. `6 / 3 / 2 h` divides by three
 * and then by two hours, and `2 ^ 1 / 2 h` is a power first.
 */
const TIGHTER_BEFORE: ReadonlySet<string> = new Set(["SLASH", "CARET"]);

/**
 * `1/2 hour` and `3 / 4 cup`, a fraction written in front of a unit, as the
 * amount it is: half an hour, three quarters of a cup.
 *
 * A unit binds to the number beside it before any operator does, so the parser
 * read `1 / 2 hour` as one divided by two hours. That used to answer half an
 * hour only because a number divided by a quantity kept the quantity's unit,
 * which also made `1 / (2 m)` half a metre when it is half of one per metre
 * (#570). Now that a number over a quantity is its reciprocal, the fraction is
 * bracketed here, where the source still shows it was written as one amount:
 * `1 / 2 hour` becomes `(1 / 2) hour`.
 *
 * Only a fraction that starts an amount qualifies: at the start of a line or
 * after an operator, a bracket or `=`, and not straight after a division or a
 * power, whose right-hand side it would otherwise steal. A value before the
 * slash that is not a bare number (`100 km / 2 h`, `x / 2 h`, `$10 / 2 h`) is a
 * division and is left alone, and so is a written bracket, `1 / (2 h)`, which
 * says the reciprocal is what was meant.
 *
 * The brackets are synthetic, placed at the fraction's own position, the same
 * way the implicit-multiplication rule places the `*` it inserts.
 */
export function fractionBeforeUnitNormalizerRule(priority = 76): NormalizerRule {
	const RULE = "uom:fraction-before-unit";
	return {
		name: RULE,
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["NUMBER"] }, { types: ["SLASH"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const numerator = tokens[pos];
			const slash = tokens[pos + 1];
			const denominator = tokens[pos + 2];
			const unit = tokens[pos + 3];
			if (numerator?.type !== "NUMBER" || slash?.type !== "SLASH") return null;
			if (denominator?.type !== "NUMBER" || unit?.type !== "UNIT") return null;
			if (!expectsValueAt(tokens, pos)) return null;
			const before = tokens[pos - 1];
			if (before !== undefined && TIGHTER_BEFORE.has(before.type)) return null;

			const open = new LexerToken("LPAREN", LPAREN_ID, "(", "(", numerator.offset, 0, numerator.line, numerator.col);
			const close = new LexerToken("RPAREN", RPAREN_ID, ")", ")", unit.offset, 0, unit.line, unit.col);
			return {
				consumed: 3,
				replacement: [open, numerator, slash, denominator, close],
				ruleName: RULE,
			};
		},
	};
}
