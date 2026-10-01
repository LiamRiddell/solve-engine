import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import type { Token } from "@solve-js/lexer/Token";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/** The two named times of day, as minutes after midnight. A Map, so a word such as `__proto__` misses. */
const NAMED_TIMES: ReadonlyMap<string, number> = new Map([["noon", 720], ["midnight", 0]]);

/**
 * `noon` and `midnight` (#704): the clock times 12:00 and 0:00, fused into the
 * same `CLOCK_TIME` token `12pm` and `12am` are, so each works wherever a
 * clock time does (`noon + 90 minutes`, `9am to noon`, `midnight in Tokyo`).
 * The token's text stays the word, so a message quotes what was written and
 * `clockTimeSumNormalizerRule` reads it as a time of day, not a stretch of time.
 *
 * The word is left alone where it is a name: before `=` (`noon = 12`) and
 * after `:` (a `:noon` reference). Anywhere else it is the clock time, as
 * `today` is the date.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function noonMidnightNormalizerRule(priority = 65): NormalizerRule {
	const RULE = "time:noon-midnight";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["IDENT"], values: ["noon", "midnight"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (token.type !== "IDENT") return null;
			const minutes = NAMED_TIMES.get((token.text ?? "").toLowerCase());
			if (minutes === undefined) return null;
			if (tokens[pos + 1]?.type === "EQUALS" || tokens[pos - 1]?.type === "COLON") return null;
			const fused = createFusedToken("CLOCK_TIME", String(minutes), [token]);
			fused.text = token.text;
			return { consumed: 1, replacement: [fused], ruleName: RULE };
		},
	};
}
