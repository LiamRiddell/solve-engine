import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

/** The time measure's kind in UNIT_TABLE. Its base unit is the second. */
const TIME_KIND = 14;

/**
 * `[measureKind, ratioToBaseUnit]` for a unit spelling, or undefined.
 *
 * `previousKind` disambiguates the one letter that genuinely collides: `m` is
 * the metre, so `3h 5m 10s` would otherwise be three hours and five metres and
 * be declined. Inside a run that has already established itself as a duration,
 * `m` is minutes, which is the only thing it can be between an `h` and an `s`.
 * A `5m` on its own never reaches this, because a single part is not compound.
 */
function unitEntry(
	token: Token | undefined,
	previousKind?: number,
): { kind: number; ratio: number; spelling: string } | undefined {
	if (token === undefined || token.type !== "UNIT") return undefined;
	const spelling = (token.value ?? "").toLowerCase();
	// The corrected spelling is returned, not just the ratio. Emitting the
	// original "m" would label the result metres: `3h 5m` came out as "185 m",
	// the right number under the wrong unit, which is worse than not parsing.
	if (spelling === "m" && previousKind === TIME_KIND) {
		return { kind: TIME_KIND, ratio: 60, spelling: "minutes" };
	}
	const entry = UNIT_TABLE[spelling] as readonly [number, number] | undefined;
	return entry === undefined ? undefined : { kind: entry[0], ratio: entry[1], spelling };
}

/** A bare unsigned integer or decimal, never hex or scientific. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/**
 * Quantities written as several units at once: `3 hours 5 minutes 10 seconds`,
 * `5 hours 30 minutes`, `3h 5m 10s`.
 *
 * This is how durations are actually written, and none of it parsed. The two
 * parts sat next to each other as separate quantities and the parser reported
 * an unexpected number, which is why `5 hours 30 minutes to seconds`,
 * `16:00 + 3 hours 12 minutes` and the timespan examples all failed at the
 * same place for the same reason.
 *
 * The parts are summed into the smallest unit present, so
 * `3 hours 5 minutes 10 seconds` becomes 11,110 seconds and behaves as one
 * quantity everywhere afterwards: convertible, addable to a clock time, and
 * comparable. The engine renders that total rather than restating the parts,
 * which differs from Soulver's output but not from its arithmetic.
 *
 * Deliberately narrow, because a sequence of number-unit pairs is a shape that
 * ordinary arithmetic also produces:
 *
 * - Every part must belong to the same measure. `3 hours 5 metres` is not a
 *   quantity and is left alone.
 * - The units must strictly decrease. `5 minutes 3 hours` is not how anyone
 *   writes a duration, and treating it as one would silently reinterpret a
 *   multiplication.
 * - Every part after the first must be a bare positive integer with no sign,
 *   so `3 hours -5 minutes` stays a subtraction.
 */
export function compoundQuantityNormalizerRule(priority = 63): NormalizerRule {
	return {
		name: "uom:compound-quantity",
		priority,
		match(tokens, pos): NormalizerMatch | null {
			const firstNumber = tokens[pos];
			if (firstNumber?.type !== "NUMBER" || !PLAIN_NUMBER.test(firstNumber.text ?? "")) return null;

			const firstUnit = unitEntry(tokens[pos + 1]);
			if (firstUnit === undefined) return null;

			const kind = firstUnit.kind;
			let lastRatio = firstUnit.ratio;
			let total = Number(firstNumber.text) * lastRatio;
			let smallestUnit = firstUnit.spelling;
			let smallestUnitToken = tokens[pos + 1];
			let consumed = 2;

			// Each further part has to be a number, then a unit of the same
			// measure that is strictly smaller than the one before it.
			for (;;) {
				const number = tokens[pos + consumed];
				if (number?.type !== "NUMBER" || !PLAIN_NUMBER.test(number.text ?? "")) break;

				const entry = unitEntry(tokens[pos + consumed + 1], kind);
				if (entry === undefined) break;
				if (entry.kind !== kind || entry.ratio >= lastRatio) break;

				total += Number(number.text) * entry.ratio;
				lastRatio = entry.ratio;
				smallestUnit = entry.spelling;
				smallestUnitToken = tokens[pos + consumed + 1];
				consumed += 2;
			}

			// A single number and unit is not compound; leave it entirely alone.
			if (consumed === 2) return null;

			const source = tokens.slice(pos, pos + consumed);
			// The total is expressed in the smallest unit that appeared, which
			// keeps it exact for the units people actually combine and reads
			// naturally when converted.
			const scaled = total / lastRatio;
			return {
				consumed,
				replacement: [
					createFusedToken("NUMBER", String(scaled), source),
					createFusedToken("UNIT", smallestUnit, [smallestUnitToken]),
				],
				ruleName: "uom:compound-quantity",
			};
		},
	};
}
