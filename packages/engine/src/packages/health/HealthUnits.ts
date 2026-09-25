/**
 * The units `bmi`, `pace` and `speed` read their arguments in (#644).
 *
 * Each function works in fixed units: kilograms and metres for BMI, kilometres
 * and minutes for pace and speed. A plain number is read in that unit, which is
 * what the health page documents. A quantity used to have its unit dropped and
 * its magnitude read in the function's unit, so `bmi(70 kg, 175 cm)` took the
 * height as 175 metres and answered 0.00229, and `speed(10 km, 1 h)` took the
 * hour as one minute and answered 600 km/h. A quantity is now converted into the
 * function's unit, and one that measures something else is refused by name.
 */

import { Value, ValueType, errorValue } from "@solve-js/vm/Value";
import { convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { describeQuantity } from "@solve-js/vm/VMConversion";

/** What one argument of a health function is, and the unit a plain number is read in. */
export interface HealthInput {
	/** The argument's name in a sentence: "weight", "height", "distance", "time". */
	readonly noun: string;
	/** The measure a quantity given for it must be, as `getMeasure` names it. */
	readonly measure: string;
	/** The measure with its article, for the message: "a mass". */
	readonly measureWithArticle: string;
	/** The unit the function works in, and the unit a plain number is read in. */
	readonly unit: string;
	/** Examples of the argument written with units, for the message. */
	readonly examples: string;
	/** The unit a plain number is read in, as a word, for the message. */
	readonly plainUnit: string;
}

/** A weight for `bmi`, in kilograms. */
export const WEIGHT: HealthInput = { noun: "weight", measure: "mass", measureWithArticle: "a mass", unit: "kg", examples: "70 kg or 154 lb", plainUnit: "kilograms" };
/** A height for `bmi`, in metres. */
export const HEIGHT: HealthInput = { noun: "height", measure: "length", measureWithArticle: "a length", unit: "m", examples: "175 cm or 69 in", plainUnit: "metres" };
/** A distance for `pace` and `speed`, in kilometres. */
export const DISTANCE: HealthInput = { noun: "distance", measure: "length", measureWithArticle: "a length", unit: "km", examples: "10 km or 6.2 mi", plainUnit: "kilometres" };
/** A time for `pace` and `speed`, in minutes. */
export const DURATION: HealthInput = { noun: "time", measure: "time", measureWithArticle: "a duration", unit: "min", examples: "50 min or 1 h", plainUnit: "minutes" };

/**
 * One argument of a health function as a number in the function's unit.
 *
 * A plain number is taken as it is, in the unit the function documents. A
 * quantity of the right measure is converted into that unit, so 175 cm is 1.75
 * for a height and 1 h is 60 for a time. A quantity of any other measure (a
 * length given as a weight, money, a temperature) is refused, and so is a
 * negative figure, which no weight, height, distance or time can be.
 *
 * @param fn - The function's name, for the message.
 * @param value - The argument.
 * @param input - What the argument is.
 * @returns The number, a `HEALTH_BAD_INPUT` error Value, or null for an argument
 * that is neither a number nor a quantity (the caller's usage message).
 */
export function readHealthInput(fn: string, value: Value | undefined, input: HealthInput): number | Value | null {
	let n: number;
	if (value?.type === ValueType.Number) {
		n = value.value as number;
	} else if (value?.type === ValueType.Uom && value.unit !== undefined) {
		if (getMeasure(value.unit) !== input.measure) {
			return errorValue(
				"HEALTH_BAD_INPUT",
				`${fn}: the ${input.noun} is ${input.measureWithArticle}, not ${describeQuantity(value.unit)}. Give it with a unit (${input.examples}) or as a plain number of ${input.plainUnit}.`,
			);
		}
		n = convertUnit(value.toNumber(), value.unit, input.unit);
	} else {
		return null;
	}
	if (n < 0) return errorValue("HEALTH_BAD_INPUT", `${fn}: the ${input.noun} cannot be negative.`);
	return n;
}
