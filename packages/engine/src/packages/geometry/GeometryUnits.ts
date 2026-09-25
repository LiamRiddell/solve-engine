/**
 * The units of a shape's dimensions and of the measure worked out from them
 * (#638).
 *
 * A radius in metres gives an area in square metres, the way `pi * (5 m)^2`
 * does: the dimensions are read as lengths, converted into one unit, and the
 * answer takes the power its measure has (a length for a perimeter, the square
 * for an area, the cube for a volume). The formulae themselves stay unitless in
 * `GeometryMath.ts`; this is the layer either side of them.
 */

import { Value, ValueType, numberValue, uomValue, errorValue } from "@solve-js/vm/Value";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { describeQuantity, nonNumericKind } from "@solve-js/vm/VMConversion";
import { asPowerOfLength } from "@solve-js/vm/QuantityPowers";
import type { Dimensions } from "./GeometryMath";

/** The power of a length each measure is: a perimeter is a length, an area its square, a volume its cube. */
const MEASURE_POWER: Readonly<Record<string, number>> = {
	perimeter: 1,
	circumference: 1,
	area: 2,
	surface: 2,
	volume: 3,
};

/** A shape's dimensions as magnitudes in one length unit, or in none when every dimension was a bare number. */
export interface ReadDimensions {
	/** Each dimension's magnitude, in {@link unit} when there is one. */
	readonly dims: Dimensions;
	/** The length unit the magnitudes are in: the first one written, or `undefined` for bare numbers. */
	readonly unit: string | undefined;
}

/**
 * Read a shape's dimension name and value pairs into magnitudes in one length
 * unit.
 *
 * A dimension with a unit must be a length, and the first length written sets
 * the unit the others are converted into, the rule `total of 1.2 km, 800 m`
 * follows: `width 3 m, height 400 cm` is 3 by 4 in metres. A dimension with no
 * unit is read in that same unit, as a bare number in a list of quantities is,
 * so `width 3 m, height 4` is 3 m by 4 m. Anything else is refused by name with
 * `GEOMETRY_ERROR`: a mass, a length of time or money as a side, and a value
 * with no single amount (a list, text, a date). A fault in a dimension (an
 * Error, a value still loading) is handed back as it is.
 *
 * @param pairs - The dimension names and values, interleaved: name, value, name, value.
 * @returns The magnitudes and their unit, or the value that refuses them.
 */
export function readDimensions(pairs: readonly Value[]): ReadDimensions | Value {
	const dims: Dimensions = {};
	let unit: string | undefined;
	for (let i = 0; i + 1 < pairs.length; i += 2) {
		const name = String(pairs[i]?.value ?? "");
		const value = pairs[i + 1];
		if (value === undefined) continue;
		if (value.type === ValueType.Error || value.type === ValueType.Pending) return value;
		const kind = nonNumericKind(value);
		if (kind !== undefined) {
			return errorValue("GEOMETRY_ERROR", `a ${name} is a length or a number, and ${kind} is neither`);
		}
		if (value.type !== ValueType.Uom || value.unit === undefined) {
			dims[name] = value.toNumber();
			continue;
		}
		if (getMeasure(value.unit) !== "length") {
			return errorValue(
				"GEOMETRY_ERROR",
				`a ${name} is a length, not ${describeQuantity(value.unit)}: give it in a unit of length, such as m or ft`,
			);
		}
		if (unit === undefined) unit = value.unit;
		dims[name] = convertUnit(value.toNumber(), value.unit, unit);
	}
	return { dims, unit };
}

/**
 * A measure worked out from lengths in `unit`, labelled with the unit it is in:
 * a perimeter in the length itself, an area in its square and a volume in its
 * cube (`m`, `m²`, `m³`). A length whose square or cube has no spelling of its
 * own (`furlong`) is measured in square or cubic metres, as `(5 furlong)^2` is.
 * With no unit the magnitude is a plain number, which is what a shape with bare
 * dimensions has always answered.
 *
 * @param magnitude - The measure, in `unit` raised to the measure's power.
 * @param measure - `perimeter`, `circumference`, `area`, `surface` or `volume`.
 * @param unit - The length unit the dimensions were read in, or `undefined`.
 * @returns The measure as a number or a quantity.
 */
export function measureInUnit(magnitude: number, measure: string, unit: string | undefined): Value {
	if (unit === undefined) return numberValue(magnitude);
	const power = Object.prototype.hasOwnProperty.call(MEASURE_POWER, measure) ? MEASURE_POWER[measure] : 1;
	const length = uomValue(magnitude, unit);
	return power === 1 ? length : asPowerOfLength(length, unit, power);
}
