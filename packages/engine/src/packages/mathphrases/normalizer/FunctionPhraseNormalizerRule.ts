import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * Retypes `root` and `log` when they are written as phrases rather than calls.
 *
 *   root 5 of 100     100 ^ (1/5)
 *   log 20 base 4     ln(20) / ln(4)
 *
 * Both words are already `FUNC` tokens, so the ordinary call parselet claims
 * them and demands a `(`. A phrase parselet can only be reached if the token
 * type differs, which is what this does, and only when the next token is not
 * a `(`, so `log(20)` and `root(8, 3)` are untouched.
 *
 * The trailing `base` is retyped at the same time. Doing it here rather than
 * claiming the bare word keeps `base` usable everywhere else, including as
 * `as base 8` in the converters package.
 */
export function functionPhraseNormalizerRule(priority = 69): NormalizerRule {
	return {
		name: "mathphrases:function-phrase",
		priority,
		startTokenTypes: ["FUNC"],
		match(tokens, pos): NormalizerMatch | null {
			const head = tokens[pos];
			if (head?.type !== "FUNC") return null;

			const word = (head.value ?? "").toLowerCase();
			if (word !== "root" && word !== "log") return null;

			// A real call. Leave it entirely alone.
			if (tokens[pos + 1]?.type === "LPAREN") return null;

			if (word === "root") {
				return {
					consumed: 1,
					replacement: [createFusedToken("NTH_ROOT", "root", [head])],
					ruleName: "mathphrases:function-phrase",
				};
			}

			// `log <x> base <n>`: only a phrase when the "base" is actually
			// there. Without it, "log 20" is left as it was so it still fails
			// the way it always did rather than in some new way.
			const baseAt = findBase(tokens, pos + 1);
			if (baseAt === -1) return null;

			const replacement = tokens.slice(pos, baseAt + 1).map((token, index) => {
				if (index === 0) return createFusedToken("LOG_PHRASE", "log", [token]);
				if (index === baseAt - pos) return createFusedToken("LOG_BASE", "base", [token]);
				return token;
			});
			return {
				consumed: baseAt - pos + 1,
				replacement,
				ruleName: "mathphrases:function-phrase",
			};
		},
	};
}

/**
 * Index of the `base` keyword belonging to this `log`, or -1.
 *
 * Scans a short way rather than assuming it sits immediately after a single
 * number, so `log 2 * 10 base 4` works. Stops at anything that ends a phrase.
 */
function findBase(tokens: readonly { type: string; text?: string; value?: string }[], from: number): number {
	for (let i = from; i < tokens.length && i < from + 8; i++) {
		const token = tokens[i];
		if (token.type === "EOF" || token.type === "COMMA" || token.type === "RPAREN") return -1;
		if ((token.text ?? token.value ?? "").toLowerCase() === "base") return i;
	}
	return -1;
}
