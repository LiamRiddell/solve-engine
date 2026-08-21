import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * The retyped operator token for a `up`/`down` at position `i`, or `null` when
 * that position does not begin a percentage step.
 *
 * A step is the bare word `up`/`down` immediately before a percentage: an IDENT
 * then a NUMBER then a `%`. Requiring the `%` is what keeps the words safe to
 * use in prose, the same guard the `on`/`off` markup rule relies on.
 */
function stepTokenAt(tokens: Token[], i: number): Token | null {
	const word = tokens[i];
	if (word?.type !== "IDENT") return null;
	const text = (word.text ?? word.value ?? "").toLowerCase();
	if (text !== "up" && text !== "down") return null;
	if (tokens[i + 1]?.type !== "NUMBER") return null;
	if (tokens[i + 2]?.type !== "PERCENT") return null;
	return createFusedToken(text === "up" ? "PCT_UP" : "PCT_DOWN", text, [word]);
}

/**
 * Retypes a bare `up`/`down` into the successive-change operator, but only
 * where a percentage immediately follows.
 *
 *   120 up 10% then down 10%   118.80
 *   50 up 20%                  60
 *   80 down 15%                68
 *
 * `up` and `down` are ordinary English words, far too common to claim as bare
 * keywords: "prices are up", "scroll down", a variable named `up`. So the same
 * approach as the `on`/`off` markup rule is used (see
 * PercentOnOffNormalizerRule): the word is recognised only when it sits
 * directly before a percentage (a NUMBER then a `%`), the one place
 * `up 10%`/`down 10%` can only mean a percentage change. Anywhere else the word
 * passes through as an IDENT and stays a name.
 *
 * Two positions can match, at a higher priority than the implicit-multiply
 * rule (50):
 *
 *   1. A NUMBER or a `)` directly before a step. The implicit-multiply rule
 *      would otherwise insert a `*` here (`120 up` read as `120 * up`), which
 *      strands the operator with no left operand. Winning at this position with
 *      a higher priority both retypes the word and suppresses that `*`.
 *   2. The `up`/`down` itself, for every other left operand (a unit like
 *      `$300`, a `then` connective, the start of the line), where no implicit
 *      `*` is at stake.
 *
 * The arithmetic and the `then`/`N times` chaining live in
 * {@link UpDownParselet}; this rule only marks where a step begins.
 */
export function percentUpDownNormalizerRule(priority = 68): NormalizerRule {
	return {
		name: "percentage:up-down",
		priority,
		match(tokens, pos): NormalizerMatch | null {
			// Position 1: a value the implicit-multiply rule would glue to the
			// word. Consume both, keep the value, retype the word, no `*`.
			const here = tokens[pos];
			if (here && (here.type === "NUMBER" || here.type === "RPAREN")) {
				const step = stepTokenAt(tokens, pos + 1);
				if (step) {
					return {
						consumed: 2,
						replacement: [here, step],
						ruleName: "percentage:up-down",
					};
				}
			}

			// Position 2: the word itself, anywhere the value before it does not
			// trigger an implicit `*`.
			const step = stepTokenAt(tokens, pos);
			if (step) {
				return {
					consumed: 1,
					replacement: [step],
					ruleName: "percentage:up-down",
				};
			}

			return null;
		},
	};
}
