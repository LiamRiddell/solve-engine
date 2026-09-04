/**
 * The gas mark, as a scale rather than a unit.
 *
 * A British gas oven is not marked in degrees. Its dial runs from a quarter to
 * nine, and each mark stands for an oven temperature: gas mark 4 is 180°C, and
 * a recipe that says "gas 6" means 200°C. That makes it a lookup, not an
 * arithmetic conversion: there is no formula from °C to a gas mark the way
 * there is from °C to °F, because the marks are a published table with uneven
 * steps (the gap from 1 to 2 is ten degrees, from 6 to 7 is twenty).
 *
 * The table below is the standard British one, as printed on cooker dials and
 * in recipe books. The two fractional marks at the bottom are the slow-oven
 * settings, written `1/4` and `1/2` on the dial and spelled here as the
 * numbers a reader would type.
 *
 * @module GasMark
 */

/** One row of the published table: the dial setting and the oven temperature it means. */
export interface GasMarkRow {
	/** The dial setting, as a number: 0.25 and 0.5 are the two fractional marks. */
	readonly mark: number;
	/** The temperature in degrees Celsius that mark stands for. */
	readonly celsius: number;
	/** How the mark is written on a dial, which is not always its number (`1/4`). */
	readonly written: string;
}

/**
 * The standard British gas-mark table.
 *
 * Fahrenheit is deliberately not a column. Every published table gives the same
 * Celsius figures and rounds Fahrenheit differently, so the engine converts
 * from whatever it is given into Celsius and reads this one table, rather than
 * carrying two tables that could disagree.
 */
export const GAS_MARKS: readonly GasMarkRow[] = [
	{ mark: 0.25, celsius: 110, written: "1/4" },
	{ mark: 0.5, celsius: 120, written: "1/2" },
	{ mark: 1, celsius: 140, written: "1" },
	{ mark: 2, celsius: 150, written: "2" },
	{ mark: 3, celsius: 170, written: "3" },
	{ mark: 4, celsius: 180, written: "4" },
	{ mark: 5, celsius: 190, written: "5" },
	{ mark: 6, celsius: 200, written: "6" },
	{ mark: 7, celsius: 220, written: "7" },
	{ mark: 8, celsius: 230, written: "8" },
	{ mark: 9, celsius: 240, written: "9" },
];

/** How far a temperature may sit from a mark and still be read as it: half the widest gap in the table. */
const NEAREST_WITHIN_CELSIUS = 10;

/**
 * The temperature a gas mark stands for, or null when the dial has no such mark.
 *
 * @param mark - The dial setting, `0.25` and `0.5` included.
 * @returns Degrees Celsius, or null for a setting the table does not have.
 */
export function celsiusForGasMark(mark: number): number | null {
	return GAS_MARKS.find((row) => row.mark === mark)?.celsius ?? null;
}

/**
 * The gas mark an oven temperature corresponds to, or null when it is not near one.
 *
 * The nearest mark within ten degrees, which is half the widest step in the
 * table. A temperature further out than that is not a gas setting at all, and
 * answering with the nearest one would invent a precision the dial does not
 * have: 300°C is hotter than any domestic gas oven goes, and calling it "gas 9"
 * would be wrong rather than approximate.
 *
 * @param celsius - The oven temperature in degrees Celsius.
 * @returns The row, or null when no mark is close enough.
 */
export function gasMarkForCelsius(celsius: number): GasMarkRow | null {
	let best: GasMarkRow | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const row of GAS_MARKS) {
		const distance = Math.abs(row.celsius - celsius);
		if (distance < bestDistance) {
			best = row;
			bestDistance = distance;
		}
	}
	return best !== null && bestDistance <= NEAREST_WITHIN_CELSIUS ? best : null;
}

/** The coldest and hottest settings on the dial, for the sentence a refusal ends with. */
export function gasMarkRange(): { readonly coldest: GasMarkRow; readonly hottest: GasMarkRow } {
	return { coldest: GAS_MARKS[0], hottest: GAS_MARKS[GAS_MARKS.length - 1] };
}
