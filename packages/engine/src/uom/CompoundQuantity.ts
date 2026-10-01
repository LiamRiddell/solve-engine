import type { Token } from "@solve-js/lexer/Token";
import { UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

/** The time measure's kind in UNIT_TABLE. Its base unit is the second. */
const TIME_KIND = 14;

/** A day in seconds, the time measure's base unit. */
const DAY_SECONDS = 86_400;

/** A bare unsigned integer or decimal, never hex or scientific. */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/** One part of a quantity written in several units: the `1 day` of `1 month 1 day`. */
export interface CompoundPart {
	/** The amount as written, a plain unsigned number. */
	readonly amount: string;
	/** The unit's spelling, corrected where the run decides it (`m` between `h` and `s` is minutes). */
	readonly spelling: string;
	/** The unit's ratio to its measure's base unit. */
	readonly ratio: number;
	/** The unit token the part was read from. */
	readonly unitToken: Token;
}

/** A quantity written in several units, largest first, as {@link readCompoundQuantity} reads it. */
export interface CompoundQuantity {
	/** The parts in the order written, each smaller than the one before. */
	readonly parts: readonly CompoundPart[];
	/** The measure kind every part belongs to, in UNIT_TABLE's numbering. */
	readonly kind: number;
	/** How many tokens the quantity spans. */
	readonly consumed: number;
}

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
	// Own properties only: a unit spelled `constructor` is not in the table.
	if (!Object.prototype.hasOwnProperty.call(UNIT_TABLE, spelling)) return undefined;
	const entry = UNIT_TABLE[spelling] as readonly [number, number];
	return { kind: entry[0], ratio: entry[1], spelling };
}

/**
 * Reads a quantity written as several units at once from `pos`:
 * `3 hours 5 minutes 10 seconds`, `1 month 1 day`, `3h 5m 10s`.
 *
 * Deliberately narrow, because a sequence of number-unit pairs is a shape that
 * ordinary arithmetic also produces:
 *
 * - Every part must belong to the same measure. `3 hours 5 metres` is not a
 *   quantity and is left alone.
 * - The units must strictly decrease. `5 minutes 3 hours` is not how anyone
 *   writes a duration, and treating it as one would silently reinterpret a
 *   multiplication.
 * - Every part must be a bare unsigned number, so `3 hours -5 minutes` stays a
 *   subtraction.
 *
 * @param tokens - The line's tokens.
 * @param pos - The index of the first number.
 * @returns The parts, or null when fewer than two parts are written there.
 */
export function readCompoundQuantity(tokens: readonly Token[], pos: number): CompoundQuantity | null {
	const firstNumber = tokens[pos];
	if (firstNumber?.type !== "NUMBER" || !PLAIN_NUMBER.test(firstNumber.text ?? "")) return null;
	const first = unitEntry(tokens[pos + 1]);
	if (first === undefined) return null;

	const parts: CompoundPart[] = [{ amount: firstNumber.text, spelling: first.spelling, ratio: first.ratio, unitToken: tokens[pos + 1] }];
	let consumed = 2;
	// Each further part has to be a number, then a unit of the same measure
	// that is strictly smaller than the one before it.
	for (;;) {
		const number = tokens[pos + consumed];
		if (number?.type !== "NUMBER" || !PLAIN_NUMBER.test(number.text ?? "")) break;
		const entry = unitEntry(tokens[pos + consumed + 1], first.kind);
		if (entry === undefined || entry.kind !== first.kind || entry.ratio >= parts[parts.length - 1].ratio) break;
		parts.push({ amount: number.text, spelling: entry.spelling, ratio: entry.ratio, unitToken: tokens[pos + consumed + 1] });
		consumed += 2;
	}
	return parts.length < 2 ? null : { parts, kind: first.kind, consumed };
}

/**
 * Whether a compound quantity is a length of time led by a calendar step, a
 * day or longer (`1 month 1 day`, `1 year 2 months`, `1 day 2 hours`).
 *
 * A calendar step is not a fixed number of seconds on a date: a month is 28
 * to 31 days, and a day across a change of clocks is 23 or 25 hours. So such
 * a length added to a date has to be applied a part at a time, largest first,
 * as `d + 1 month + 1 day` applies it, rather than summed into one count first.
 * A length led by hours or smaller (`1 hour 30 minutes`) is fixed and is summed.
 */
export function isCalendarLength(quantity: CompoundQuantity): boolean {
	return quantity.kind === TIME_KIND && quantity.parts[0].ratio >= DAY_SECONDS;
}
