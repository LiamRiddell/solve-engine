import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/**
 * Fuses a slash-notation compound unit, `UNIT / UNIT`, into one UNIT token
 * whose value is the rate spelling `"numerator/denominator"` (e.g. `km/h`,
 * `m/s`, `hours/day`).
 *
 * The lexer reads a unit as one run of word characters and stops at the slash,
 * so `km/h` arrived as three tokens and the parser saw `km` divided by `h`.
 * That is exactly a rate, and the surrounding code already represents a rate as
 * a `"numerator/denominator"` unit string, so fusing here produces the same
 * value the bare-denominator path builds for `100 km / h` while ALSO making the
 * compound spelling usable as a conversion target: `100 km/h in mph` needs the
 * whole `km/h` in one token before `in` can see it, and a target like `in km/h`
 * has no number to hang a bare denominator off at all.
 *
 * Deliberately narrow, so it never steals a case from a real division:
 *
 * - Both flanks must be UNIT tokens. `120 km / 2 hours` has a number after the
 *   slash, so the slash stays a divide and the result is still a rate built the
 *   ordinary way. `a / b` between variables is untouched.
 * - Exactly one slash is fused. `m/s^2` becomes `m/s` followed by `^2`, which
 *   is the same value the engine already produced for it, a squared rate rather
 *   than an acceleration. Naming a compound derived unit like the newton is left
 *   for later; see the pull request for #89.
 *
 * Runs above the bare-denominator rule so the whole spelling is claimed at the
 * numerator's position before the slash can be read on its own.
 */
export function compoundUnitNormalizerRule(priority = 77): NormalizerRule {
	return {
		name: "uom:compound-unit",
		priority,
		// Derived from this rule's own opening guards; see RuleSlot on why an
		// over-broad slot is safe and an over-narrow one is not.
		shape: [{ types: ["UNIT"] }, { types: ["SLASH"] }],
		match(tokens, pos): NormalizerMatch | null {
			const numerator = tokens[pos];
			const slash = tokens[pos + 1];
			const denominator = tokens[pos + 2];
			if (numerator?.type !== "UNIT") return null;
			if (slash?.type !== "SLASH") return null;
			if (denominator?.type !== "UNIT") return null;

			const spelling = `${numerator.value}/${denominator.value}`;
			return {
				consumed: 3,
				replacement: [createFusedToken("UNIT", spelling, [numerator, slash, denominator] as Token[])],
				ruleName: "uom:compound-unit",
			};
		},
	};
}
