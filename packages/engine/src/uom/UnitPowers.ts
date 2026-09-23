/**
 * The square and cube spellings of a length unit, and the length behind an area
 * or volume unit.
 *
 * The unit table stores areas and volumes as units in their own right (`m2`,
 * `ft3`, `L`), not as lengths with an exponent, so raising `m` to the power 2
 * means finding the spelling the table already has for a square metre. Every
 * length symbol with such a spelling follows one convention: the symbol plus the
 * power (`m2`, `km3`, `ft2`, `in3`), whose ratio to the base unit is the length's
 * ratio squared or cubed. A word form (`metres`, `feet`) reaches its symbol
 * through the table itself, because every alias of a unit shares the one entry.
 *
 * Nothing here builds a unit that the table does not already hold, so a length
 * with no square spelling (`furlong`, `nmi`) is reported as absent rather than
 * invented; the caller decides whether to measure it in metres instead or to
 * refuse.
 */

import { UNIT_TABLE, MEASURE_SYMBOLS } from "@solve-js/uom/generated/UnitTable.generated";
import { getMeasure } from "@solve-js/uom/UomConverter";

/** The table's measure kind for length, as keyed in `MEASURE_SYMBOLS`. */
const LENGTH_KIND = 7;

/** What a length becomes when raised to each power the table can spell. */
const MEASURE_FOR_POWER: Readonly<Record<number, string>> = { 2: "area", 3: "volume" };

/**
 * The length symbol a spelling is an alias of: `metres` and `m` share one table
 * entry, so this finds `m` for either. `undefined` for a unit that is not a
 * length in the base table (an extended length such as `furlong` has no symbol
 * here).
 */
function lengthSymbolOf(unit: string): string | undefined {
	const entry = UNIT_TABLE[unit];
	if (entry === undefined) return undefined;
	for (const symbol of MEASURE_SYMBOLS[LENGTH_KIND] ?? []) {
		if (UNIT_TABLE[symbol] === entry) return symbol;
	}
	return undefined;
}

/**
 * Whether `candidate` is `length` raised to `power`: an area (or volume) unit
 * whose size is exactly the length's size squared (or cubed). The size check
 * guards the naming convention rather than trusting it, so a spelling that only
 * looks right can never pass.
 */
function isPowerOf(candidate: string, length: string, power: number): boolean {
	const powered = UNIT_TABLE[candidate];
	const base = UNIT_TABLE[length];
	if (powered === undefined || base === undefined) return false;
	if (getMeasure(candidate) !== MEASURE_FOR_POWER[power]) return false;
	const expected = base[1] ** power;
	return Math.abs(powered[1] - expected) <= expected * 1e-9;
}

/**
 * The unit spelling for a length raised to the power 2 or 3: `m` gives `m2`,
 * `km` gives `km3`, `feet` gives `ft2`. `undefined` when `unit` is not a length,
 * the power is not 2 or 3, or the table holds no square or cube spelling for it.
 *
 * @param unit - The unit as written, a symbol or a word.
 * @param power - The exponent.
 * @returns The area or volume unit, or `undefined` if there is none.
 */
export function poweredUnit(unit: string, power: number): string | undefined {
	if (power !== 2 && power !== 3) return undefined;
	if (getMeasure(unit) !== "length") return undefined;
	for (const length of [unit, lengthSymbolOf(unit)]) {
		if (length === undefined) continue;
		const candidate = `${length}${power}`;
		if (isPowerOf(candidate, length, power)) return candidate;
	}
	return undefined;
}

/**
 * The length an area or volume unit is written as the square or cube of: `m2`
 * gives `m`, `ft3` gives `ft`. Only a spelling that is itself a symbol plus the
 * power qualifies. An area with a name of its own (`ha`, `acre`, `L`) gives
 * `undefined`, since the length behind it (`hm` for a hectare) is not a unit a
 * reader would expect to see; the caller measures such a value in square or
 * cubic metres instead.
 *
 * @param unit - An area (power 2) or volume (power 3) unit.
 * @param power - 2 for a square root, 3 for a cube root.
 * @returns The length unit, or `undefined` if the spelling has none.
 */
export function rootUnit(unit: string, power: number): string | undefined {
	if (power !== 2 && power !== 3) return undefined;
	if (!unit.endsWith(String(power))) return undefined;
	const length = unit.slice(0, -1);
	if (getMeasure(length) !== "length") return undefined;
	return isPowerOf(unit, length, power) ? length : undefined;
}

/**
 * The measure a length becomes at `power`: `"area"` for 2, `"volume"` for 3,
 * `undefined` otherwise.
 *
 * @param power - The exponent.
 * @returns The measure name as `getMeasure` reports it.
 */
export function measureForPower(power: number): string | undefined {
	return MEASURE_FOR_POWER[power];
}
