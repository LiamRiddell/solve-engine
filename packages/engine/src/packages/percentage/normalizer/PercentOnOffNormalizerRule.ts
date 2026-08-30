import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * Turns the `on`/`off` immediately after a `%` into a markup/discount operator.
 *
 * `10% on 200` is 220 and `10% off 200` is 180, the same answers as
 * `200 + 10%` and `200 - 10%` with the rate stated first. Both orders get
 * written; only one of them worked.
 *
 * Deliberately a normalizer rule keyed on the preceding `%` rather than a
 * keyword mapping for the bare words. "on" is already spoken for in two other
 * grammars, `stock(AAPL) on April 12, 2005` and `weekday on March 9, 2024`.
 * Claiming it outright broke both, which is how this rule came to exist.
 * Requiring the `%` immediately before means it can only fire where a
 * percentage is genuinely being applied to something.
 */
export function percentOnOffNormalizerRule(priority = 68): NormalizerRule {
	return {
		name: "percentage:on-off",
		priority,
		startTokenTypes: ["PERCENT"],
		match(tokens, pos): NormalizerMatch | null {
			if (tokens[pos]?.type !== "PERCENT") return null;

			const word = tokens[pos + 1];
			if (word?.type !== "IDENT") return null;
			const text = (word.text ?? word.value ?? "").toLowerCase();
			if (text !== "on" && text !== "off") return null;

			// `5% off what is 190` is the solve-for-the-base grammar, whose
			// "off what is" phrase owns this same "off". It is fused later than
			// this rule runs, so the guard has to be here.
			const after = (tokens[pos + 2]?.text ?? "").toLowerCase();
			if (after === "what") return null;

			// The `%` is kept: it still has to divide by a hundred. Only the
			// following word is retyped.
			return {
				consumed: 2,
				replacement: [
					tokens[pos],
					createFusedToken(text === "on" ? "PCT_ON" : "PCT_OFF", text, [word]),
				],
				ruleName: "percentage:on-off",
			};
		},
	};
}
