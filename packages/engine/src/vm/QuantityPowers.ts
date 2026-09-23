/**
 * Powers and roots of a quantity that carries a unit.
 *
 * A length squared is an area and a length cubed is a volume, so `(3 m)^2` is
 * 9 m2 and `sqrt(16 m2)` is 4 m. Those are the only powers of a unit the engine
 * can name: the unit table holds areas and volumes, and nothing for a mass
 * squared, a time squared or a currency squared. Every other power or root of a
 * quantity is refused by name rather than answered with the bare number, which
 * is what `^`, `pow`, `sqrt` and `cbrt` used to do: they dropped the unit and
 * reported, for example, `(3 m)^2` as 9 and `sqrt(16 m2)` as 4.
 *
 * This is the run-time half. A power written on a unit literal (`5 m^2`) never
 * reaches it: `UomLiteralParselet` takes that power onto the unit at parse time,
 * where `5 m^2` means 5 square metres rather than (5 m) squared.
 */

import { Value, uomValue, numberValue, errorValue } from "@solve-js/vm/Value";
import { poweredUnit, rootUnit, measureForPower } from "@solve-js/uom/UnitPowers";
import { getMeasure, convertUnit } from "@solve-js/uom/UomConverter";

/** The base unit of each measure a power or root lands in. */
const BASE_UNIT_FOR_POWER: Readonly<Record<number, string>> = { 1: "m", 2: "m2", 3: "m3" };

/**
 * The error for a power the engine cannot give a unit to.
 *
 * @param unit - The quantity's unit.
 * @param exponent - The exponent as the reader would recognise it.
 * @returns A `UNIT_POWER_UNSUPPORTED` error value.
 */
export function unitPowerUnsupported(unit: string, exponent: string): Value {
	return errorValue(
		"UNIT_POWER_UNSUPPORTED",
		`A quantity in ${unit} cannot be raised to the power ${exponent}: only a length squared or cubed has a unit, an area or a volume.`,
	);
}

/**
 * Raise a quantity to a power.
 *
 * A length to the power 2 or 3 becomes an area or a volume, in the matching
 * square or cube unit where the table has one (`ft` gives `ft2`) and in square
 * or cubic metres where it does not (`furlong`). A power of 1 leaves the
 * quantity as it is, and a power of 0 is the plain number 1. Anything else is a
 * `UNIT_POWER_UNSUPPORTED` error.
 *
 * @param base - A value of type Uom, with its unit set.
 * @param power - The exponent.
 * @returns The powered quantity, or an error value.
 */
export function raiseQuantity(base: Value, power: number): Value {
	const unit = base.unit ?? "";
	if (power === 1) return base;
	if (power === 0) return numberValue(1);
	const magnitude = base.toNumber();
	if ((power === 2 || power === 3) && getMeasure(unit) === "length") {
		const spelled = poweredUnit(unit, power);
		if (spelled !== undefined) return uomValue(magnitude ** power, spelled);
		// A length with no square or cube spelling of its own is measured in
		// metres first, so the answer is exact rather than refused.
		const metres = convertUnit(magnitude, unit, "m");
		return uomValue(metres ** power, BASE_UNIT_FOR_POWER[power]);
	}
	return unitPowerUnsupported(unit, String(power));
}

/**
 * Take the square root (power 2) or cube root (power 3) of an area or volume.
 *
 * `sqrt(16 m2)` is 4 m and `cbrt(27 ft3)` is 3 ft. An area or volume with a
 * name of its own (`ha`, `L`) is measured in square or cubic metres first and
 * answers in metres. The root of anything that is not an area (for a square
 * root) or a volume (for a cube root) is a `UNIT_ROOT_UNSUPPORTED` error, as is
 * the square root of a negative area.
 *
 * @param value - A value of type Uom, with its unit set.
 * @param power - 2 for a square root, 3 for a cube root.
 * @param name - The function as the reader wrote it, for the error message.
 * @returns The length, or an error value.
 */
export function rootQuantity(value: Value, power: 2 | 3, name: string): Value {
	const unit = value.unit ?? "";
	const wanted = measureForPower(power);
	if (getMeasure(unit) !== wanted) {
		return errorValue(
			"UNIT_ROOT_UNSUPPORTED",
			`${name}: a quantity in ${unit} has no ${power === 2 ? "square" : "cube"} root with a unit; only ${power === 2 ? "an area" : "a volume"} has a length as its root.`,
		);
	}
	const magnitude = value.toNumber();
	if (power === 2 && magnitude < 0) {
		return errorValue("UNIT_ROOT_UNSUPPORTED", `${name}: a negative area has no square root.`);
	}
	const root = power === 2 ? Math.sqrt : Math.cbrt;
	const length = rootUnit(unit, power);
	if (length !== undefined) return uomValue(root(magnitude), length);
	return uomValue(root(convertUnit(magnitude, unit, BASE_UNIT_FOR_POWER[power])), BASE_UNIT_FOR_POWER[1]);
}
