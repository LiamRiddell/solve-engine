import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const NUMBER_ID = tokenTypeId("NUMBER");
const SLASH_ID = tokenTypeId("SLASH");

/**
 * The vulgar fractions, as numerator over denominator.
 *
 * The whole of the Unicode block that spells a fraction people write by hand.
 * Each is unambiguous: the character means that fraction and nothing else, so
 * there is no context in which reading it is claiming something already spoken
 * for.
 */
const VULGAR: ReadonlyMap<string, readonly [number, number]> = new Map([
	["\u00bd", [1, 2]], ["\u2153", [1, 3]], ["\u2154", [2, 3]],
	["\u00bc", [1, 4]], ["\u00be", [3, 4]],
	["\u2155", [1, 5]], ["\u2156", [2, 5]], ["\u2157", [3, 5]], ["\u2158", [4, 5]],
	["\u2159", [1, 6]], ["\u215a", [5, 6]],
	["\u2150", [1, 7]],
	["\u215b", [1, 8]], ["\u215c", [3, 8]], ["\u215d", [5, 8]], ["\u215e", [7, 8]],
	["\u2151", [1, 9]], ["\u2152", [1, 10]],
]);

/** A whole number written without a decimal point or an exponent. */
const WHOLE = /^\d+$/;

/** Whether the three parts spell a mixed number rather than two separate sums. */
function isMixed(whole: string, numerator: string, denominator: string): boolean {
	if (!WHOLE.test(whole) || !WHOLE.test(numerator) || !WHOLE.test(denominator)) return false;
	const n = Number(numerator);
	const d = Number(denominator);
	// A mixed number's fraction is proper. `2 3/2` is not one, so it keeps
	// whatever it meant, and neither is anything over zero.
	return d > 0 && n > 0 && n < d;
}

/**
 * `1 1/2 cups`, and the vulgar fractions, as the single quantity each one is.
 *
 * A recipe is written in mixed numbers, and the engine ships a cooking package
 * aimed squarely at that reader, but `1 1/2 cups in ml` was a parse error and
 * `½ tsp` was an undefined variable. The spelling with the word in it was
 * worse than either, because it answered: `1 and 1/2 cups in ml` computed
 * `1 + (1/2 cups)` and said `119.29 ml`, where the quantity a person meant is
 * `354.88 ml`.
 *
 * Three shapes, one reading. A whole number and a proper fraction beside it are
 * that mixed number; a whole number and a vulgar fraction beside it are the
 * same thing written shorter; and a vulgar fraction on its own is the fraction
 * it draws, handed on as a numerator over a denominator so it keeps the exact
 * behaviour typing `1/2` has.
 *
 * The `and` spelling is claimed only in front of a unit, and only for the word:
 * `1 + 1/2 cups` lexes as PLUS and is a sum somebody wrote as a sum. `1 and 1/2`
 * on its own already answers one and a half by ordinary arithmetic and needs
 * nothing from this rule, while `1 and 1/2 * 4` is a sum whose answer would
 * change if the shape were claimed there. What the unit adds is the reason to
 * read the three parts as one quantity, which is exactly the case that was
 * answering wrongly.
 *
 * The boundary is the hyphen. `1-1/2` is ambiguous against subtraction and is
 * left as the subtraction it reads as today. Nothing here changes how a
 * fraction prints either: `1.5 as fraction` is still `3/2`.
 *
 * @module MixedNumberNormalizerRule
 */

/** The rule: see the module comment for the three shapes and what claims each. */
export function mixedNumberNormalizerRule(priority = 79): NormalizerRule {
	const RULE = "arithmetic:mixed-number";
	return {
		name: RULE,
		priority,
		// A mixed number starts on its whole part, a bare vulgar fraction on the
		// character itself. See RuleSlot on why an over-broad slot is safe.
		shape: [{ types: ["NUMBER", "IDENT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const head = tokens[pos];
			if (head === undefined) return null;

			const number = (value: number, consumed: number): NormalizerMatch => ({
				consumed,
				replacement: [
					new LexerToken("NUMBER", NUMBER_ID, String(value), String(value), head.offset, 0, head.line, head.col),
				],
				ruleName: RULE,
			});

			if (head.type === "IDENT") {
				// A vulgar fraction standing alone, emitted as the division it
				// draws so it behaves exactly as typing `1/2` does.
				const parts = VULGAR.get(head.value ?? "");
				if (parts === undefined) return null;
				const [n, d] = parts;
				return {
					consumed: 1,
					replacement: [
						new LexerToken("NUMBER", NUMBER_ID, String(n), String(n), head.offset, 0, head.line, head.col),
						new LexerToken("SLASH", SLASH_ID, "/", "/", head.offset, 0, head.line, head.col),
						new LexerToken("NUMBER", NUMBER_ID, String(d), String(d), head.offset, 0, head.line, head.col),
					],
					ruleName: RULE,
				};
			}

			if (head.type !== "NUMBER") return null;
			const whole = head.value ?? "";
			if (!WHOLE.test(whole)) return null;

			// `2 ½`, the shorter spelling of the same mixed number.
			const vulgar = tokens[pos + 1];
			if (vulgar?.type === "IDENT") {
				const parts = VULGAR.get(vulgar.value ?? "");
				if (parts === undefined) return null;
				return number(Number(whole) + parts[0] / parts[1], 2);
			}

			// `1 1/2`, and `1 and 1/2 <unit>`.
			let at = pos + 1;
			let wordy = false;
			const connector = tokens[at];
			if (connector?.type === "AND_CONJ") {
				// The word only. `1 + 1/2` is a sum somebody wrote as a sum, and it
				// lexes as PLUS, so its answer is not this rule's to change.
				wordy = true;
				at += 1;
			}

			const numerator = tokens[at];
			const slash = tokens[at + 1];
			const denominator = tokens[at + 2];
			if (numerator?.type !== "NUMBER" || slash?.type !== "SLASH" || denominator?.type !== "NUMBER") return null;
			if (!isMixed(whole, numerator.value ?? "", denominator.value ?? "")) return null;

			// The word spelling needs the unit to be a quantity rather than a sum.
			if (wordy && tokens[at + 3]?.type !== "UNIT") return null;

			const value = Number(whole) + Number(numerator.value) / Number(denominator.value);
			return number(value, at + 3 - pos);
		},
	};
}
