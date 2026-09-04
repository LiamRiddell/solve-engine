/**
 * What a journey burns, and what that costs.
 *
 * Two sums a driver does before setting off, neither of which is a unit
 * conversion. How much fuel a trip takes depends on the distance and the car's
 * economy together; what it costs depends on that volume and the price at the
 * pump. The engine already converts an economy figure between `mpg` and
 * `l/100km`, and already reads `£1.50/litre` as a rate; this is the arithmetic
 * that joins them.
 *
 * Everything is computed through `l/100km`, whatever the reader wrote. It is
 * the one form in which the sum is a multiplication rather than a division,
 * which keeps the reciprocal in one place: `mpg` is distance over volume and
 * `l/100km` is volume over distance, and mixing the two is how a trip
 * calculator quietly halves someone's fuel bill.
 *
 * @module TripCost
 */

import { convertRate, convertUnit, getMeasure } from "@solve-js/uom/UomConverter";

/** The two ways an economy is written: distance per volume (`mpg`), and volume per distance (`l/100km`). */
export function isFuelEconomyUnit(unit: string): boolean {
	const measure = getMeasure(unit);
	return measure === "fuelEconomy" || measure === "fuelConsumption";
}

/**
 * Litres per 100 km, whatever unit the economy was written in, or null when it
 * is not an economy at all.
 *
 * Through `convertRate`, not `convertUnit`. The two spellings are reciprocals,
 * so the engine files them as different measures and `convertUnit` cannot
 * relate them at all: `canConvert("mpg", "l100km")` is false, and asking anyway
 * now throws. It used to answer 1,488 for 35 mpg instead, a number with no
 * meaning, which is how this arithmetic first produced a 300-mile trip that
 * burned seven thousand litres. `convertRate` is the path the engine's own
 * `40 mpg in l/100km` takes, and it relates reciprocals properly.
 */
export function litresPer100Km(economy: number, unit: string): number | null {
	if (!isFuelEconomyUnit(unit)) return null;
	if (unit === "l100km") return economy;
	return convertRate(economy, unit, "l100km");
}

/**
 * The fuel a journey takes, in litres, or null when the inputs are not a
 * distance and an economy.
 *
 * @param distance - How far, in `distanceUnit`.
 * @param distanceUnit - Any length unit the engine knows.
 * @param economy - The car's economy, in `economyUnit`.
 * @param economyUnit - `mpg`, `l/100km`, or another economy spelling.
 * @returns Litres, or null when either input is the wrong kind of thing.
 */
export function litresForTrip(distance: number, distanceUnit: string, economy: number, economyUnit: string): number | null {
	if (getMeasure(distanceUnit) !== "length") return null;
	const perHundred = litresPer100Km(economy, economyUnit);
	if (perHundred === null || !(perHundred > 0)) return null;
	const km = distanceUnit === "km" ? distance : convertUnit(distance, distanceUnit, "km");
	return (km / 100) * perHundred;
}
