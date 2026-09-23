import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/** The token types a check can compare with. */
const COMPARISONS = new Set(["EQUALITY", "NEQ", "LT", "GT", "LTE", "GTE", "APPROX"]);

/** Whether the token at `i` begins a comparison, the approximate spellings included. */
function startsComparison(tokens: readonly Token[], i: number): boolean {
	const t = tokens[i];
	if (t === undefined) return false;
	if (COMPARISONS.has(t.type)) return true;
	if (t.type === "IDENT" && (t.value ?? "") === "≈") return true;
	return t.type === "BIT_NOT" && tokens[i + 1]?.type === "EQUALS";
}

/**
 * `check` at the start of a line that compares two things: an assertion.
 *
 * The word is fused to a CHECK token only there, and only when a comparison
 * follows, because "check" is also an ordinary name (a restaurant bill, in
 * American English): `check = $80` and `15% of check` keep it as a variable.
 */
export function checkLineNormalizerRule(priority = 92): NormalizerRule {
	return {
		name: "conditionals:check",
		priority,
		shape: [{ types: ["IDENT"] }],
		match(tokens, pos): NormalizerMatch | null {
			if (pos !== 0) return null;
			const word = tokens[0];
			if (word?.type !== "IDENT" || (word.value ?? "").toLowerCase() !== "check") return null;
			let compares = false;
			for (let i = 1; i < tokens.length && !compares; i++) compares = startsComparison(tokens, i);
			if (!compares) return null;
			return {
				consumed: 1,
				replacement: [createFusedToken("CHECK", "check", [word])],
				ruleName: "conditionals:check",
			};
		},
	};
}

/** `~=`, the ASCII spelling of `≈`, fused to one APPROX token. */
export function approxOperatorNormalizerRule(priority = 92): NormalizerRule {
	return {
		name: "conditionals:approx",
		priority,
		shape: [{ types: ["BIT_NOT"] }, { types: ["EQUALS"] }],
		match(tokens, pos): NormalizerMatch | null {
			if (tokens[pos]?.type !== "BIT_NOT" || tokens[pos + 1]?.type !== "EQUALS") return null;
			return {
				consumed: 2,
				replacement: [createFusedToken("APPROX", "≈", [tokens[pos], tokens[pos + 1]])],
				ruleName: "conditionals:approx",
			};
		},
	};
}
