import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "./NormalizerRule";

/** The single rule's name, used for fusion diagnostics and for unregistering. */
export const CALL_FUSION_RULE_NAME = "engine:call-fusion";

/**
 * One rule for every package's `name(` call word.
 *
 * The call-fusion rules (`base64(`, `sha256(`, `length(`, `percentile(`, ...) are
 * byte-identical in shape: an `IDENT` whose lower-cased value is a known function
 * name, immediately followed by `(` and not preceded by `:`, fuses to a
 * package-specific call token. Rather than register one such rule per package,
 * each of which the normalizer would try at every identifier, the engine merges
 * every package's {@link IEnginePackage.callFusions} into one map and runs THIS
 * single rule, an O(1) name lookup, for all of them.
 *
 * `callFusions` is a live map the engine mutates as packages register and
 * unregister; this rule reads it on each match, the same way the user-unit rule
 * reads the engine's live unit table. The fused token reproduces exactly what the
 * hand-written rules minted: the lower-cased name as its value (the call parselet
 * reads it), the original text as its raw value, and the first token's position.
 */
export function callFusionRule(callFusions: ReadonlyMap<string, string>, priority = 80): NormalizerRule {
	return {
		name: CALL_FUSION_RULE_NAME,
		priority,
		// The word itself cannot be declared, since the map is live, but the
		// opening parenthesis after it is fixed, and that alone rules out
		// almost every identifier in prose.
		shape: [{ types: ["IDENT"] }, { types: ["LPAREN"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const token = tokens[pos];
			if (!token || token.type !== "IDENT") return null;
			// Cheap type guards before the lower-case + map lookup: most identifiers
			// are not a function call, so this short-circuits without allocating.
			if (tokens[pos + 1]?.type !== "LPAREN") return null;
			if (tokens[pos - 1]?.type === "COLON") return null; // `:name = ...` stays a variable
			const name = (token.value ?? "").toLowerCase();
			const fusedType = callFusions.get(name);
			if (fusedType === undefined) return null;

			const fused = new LexerToken(
				fusedType,
				tokenTypeId(fusedType),
				name,
				token.value,
				token.offset,
				0,
				token.line,
				token.col,
			);
			return { consumed: 1, replacement: [fused], ruleName: CALL_FUSION_RULE_NAME };
		},
	};
}
