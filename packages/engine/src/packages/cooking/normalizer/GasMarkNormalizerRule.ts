import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

const GAS_MARK_ID = tokenTypeId("GAS_MARK");

/**
 * `gas mark <n>` and `gas <n>`: the dial setting, when a number follows it.
 *
 * Only when a number follows, which is what keeps the two readings apart. On
 * its own, `gas mark` is the name of a conversion (`180C in gas mark`), and the
 * package registers it as one; with a number beside it, it is a setting that
 * stands for a temperature. Both spellings a recipe uses are read: the phrase
 * has already been fused into one converter-name token by the time this runs,
 * and the bare `gas` arrives as an ordinary word.
 *
 * `gas` is deliberately not a lexer keyword. It is an everyday word, and a
 * keyword claims it everywhere: `gas bill`, `gas 25% of the budget` and
 * `:gas = 5` would all stop meaning what they say. Requiring the number is what
 * makes the claim narrow enough to be safe.
 *
 * @module GasMarkNormalizerRule
 */

/** The rule: see the module comment for why the number is required. */
export function gasMarkNormalizerRule(priority = 72): NormalizerRule {
	const RULE = "cooking:gas-mark";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["CONVERTER_NAME", "IDENT"], values: ["gas mark", "gas"] }, { types: ["NUMBER", "BIGINT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const head = tokens[pos];
			if (head === undefined) return null;
			const word = (head.value ?? "").toLowerCase();
			if (word !== "gas mark" && word !== "gas") return null;
			if (head.type !== "CONVERTER_NAME" && head.type !== "IDENT") return null;
			const setting = tokens[pos + 1];
			if (setting?.type !== "NUMBER" && setting?.type !== "BIGINT") return null;

			const fused = new LexerToken("GAS_MARK", GAS_MARK_ID, word, head.text ?? word, head.offset, 0, head.line, head.col);
			return { consumed: 1, replacement: [fused], ruleName: RULE };
		},
	};
}
