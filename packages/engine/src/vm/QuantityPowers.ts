/**
 * Powers, roots, products and quotients of a quantity that carries a unit.
 *
 * Lengths multiply into areas and volumes: `5 m * 3 m` is 15 m² and
 * `2 m * 3 m * 4 m` is 24 m³ (see {@link multiplyLengths}). Dividing takes them
 * back down: `15 m² / 3 m` is 5 m and `24 m³ / 6 m²` is 4 m (see
 * {@link divideLengths}).
 *
 * A length squared is an area and a length cubed is a volume, so `(3 m)^2` is
 * 9 m² and `sqrt(16 m²)` is 4 m. Those are the only powers of a unit the engine
 * can name: the unit table holds areas and volumes, and nothing for a mass
 * squared, a time squared or a currency squared. Every other power or root of a
 * quantity is refused by name rather than answered with the bare number, which
 * is what `^`, `pow`, `sqrt` and `cbrt` used to do: they dropped the unit and
 * reported, for example, `(3 m)^2` as 9 and `sqrt(16 m2)` as 4.
 *
 * An area or volume worked out here is spelled with a superscript (`m²`), the
 * way it is printed. The table holds `m²` and `m2` as one unit, so the two
 * convert, compare and add as one.
 *
 * This is the run-time half. A power written on a unit literal (`5 m^2`) never
 * reaches it: `UomLiteralParselet` takes that power onto the unit at parse time,
 * where `5 m^2` means 5 square metres rather than (5 m) squared.
 */

import { Value, ValueType, uomValue, uomValueExact, numberValue, errorValue } from "@solve-js/vm/Value";
import { binaryOp } from "@solve-js/vm/VMConversion";
import { poweredUnit, rootUnit, measureForPower } from "@solve-js/uom/UnitPowers";
import { getMeasure, convertUnit } from "@solve-js/uom/UomConverter";

/** The base unit of each measure a power or root lands in. */
const BASE_UNIT_FOR_POWER: Readonly<Record<number, string>> = { 1: "m", 2: "m²", 3: "m³" };

/** How close an exponent must be to a third to be read as a cube root. */
const ROOT_EXPONENT_TOLERANCE = 1e-12;

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
 * square or cube unit where the table has one (`ft` gives `ft²`) and in square
 * or cubic metres where it does not (`furlong`). A power of a half on an area,
 * or a third on a volume, is its square or cube root, so `(9 m²)^0.5` is 3 m
 * as `sqrt(9 m²)` is. A power of 1 leaves the quantity as it is, and a power of
 * 0 is the plain number 1. Anything else is a `UNIT_POWER_UNSUPPORTED` error.
 *
 * @param base - A value of type Uom, with its unit set.
 * @param power - The exponent.
 * @returns The powered quantity, or an error value.
 */
export function raiseQuantity(base: Value, power: number): Value {
	const unit = base.unit ?? "";
	if (power === 1) return base;
	if (power === 0) return numberValue(1);
	if (power === 0.5 && getMeasure(unit) === "area") return rootQuantity(base, 2, "^");
	if (Math.abs(power - 1 / 3) < ROOT_EXPONENT_TOLERANCE && getMeasure(unit) === "volume") return rootQuantity(base, 3, "^");
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

/** How many lengths each measure is a product of. */
const GEOMETRIC_DIMENSION: Readonly<Record<string, number>> = { length: 1, area: 2, volume: 3 };

/**
 * A product of `magnitude` in units of `length` raised to `power`, labelled as
 * the area or volume it is: the matching square or cube spelling where the table
 * has one, and square or cubic metres where it does not. The exact decimal
 * sidecar is kept when the spelling is used, so `0.1 m * 0.2 m` stays exact.
 */
function asPowerOfLength(product: Value, length: string, power: number): Value {
	const spelled = poweredUnit(length, power);
	if (spelled !== undefined) {
		return product.exact !== undefined
			? uomValueExact(product.toNumber(), spelled, product.exact)
			: uomValue(product.toNumber(), spelled);
	}
	const factor = convertUnit(1, length, "m") ** power;
	return uomValue(product.toNumber() * factor, BASE_UNIT_FOR_POWER[power]);
}

/**
 * The product of two lengths, or of a length and an area, as the area or volume
 * it is; `undefined` when either operand is not a length, area or volume, so the
 * caller keeps its own rule for every other pair.
 *
 * A length times a length is an area and a length times an area is a volume, in
 * either order. The left operand's length sets the unit, the same rule addition
 * follows: `5 m * 3 ft` is 4.57 m2 and `5 m2 * 3 ft` is 4.57 m3. The general
 * multiply used to convert the right operand into the left's unit and then keep
 * only that unit, so `5 m * 3 m` was reported as 15 m, a length. A product of
 * more than three lengths (an area times an area, a volume times anything) has no
 * unit, and is refused by name rather than reported as the left operand's unit.
 *
 * @param l - The left operand.
 * @param r - The right operand.
 * @returns The area or volume, an error value, or `undefined` if not applicable.
 */
export function multiplyLengths(l: Value, r: Value): Value | undefined {
	if (l.type !== ValueType.Uom || r.type !== ValueType.Uom || l.unit === undefined || r.unit === undefined) return undefined;
	const left = getMeasure(l.unit);
	const right = getMeasure(r.unit);
	const leftDimension = left === undefined ? undefined : GEOMETRIC_DIMENSION[left];
	const rightDimension = right === undefined ? undefined : GEOMETRIC_DIMENSION[right];
	if (leftDimension === undefined || rightDimension === undefined) return undefined;
	const dimension = leftDimension + rightDimension;

	if (dimension === 2) {
		// The general multiply already converts the right length into the left's
		// unit and multiplies, exactly where both carry exact decimals. Only its
		// label is wrong, so the product is taken from it and relabelled.
		const product = binaryOp(l, r, (a, b) => a * b, (a, b) => a * b, "mul");
		return product.type === ValueType.Uom ? asPowerOfLength(product, l.unit, 2) : product;
	}

	if (dimension === 3) {
		// The length the volume is measured in: the left operand's own length, or
		// the length a left-hand area is the square of (`m2` gives `m`).
		const [area, length] = left === "area" ? [l, r] : [r, l];
		const basis = left === "length" ? l.unit : rootUnit(l.unit, 2);
		const basisArea = basis === undefined ? undefined : poweredUnit(basis, 2);
		if (basis !== undefined && basisArea !== undefined) {
			const magnitude = convertUnit(area.toNumber(), area.unit as string, basisArea) * convertUnit(length.toNumber(), length.unit as string, basis);
			return asPowerOfLength(uomValue(magnitude, basis), basis, 3);
		}
		// An area with a name of its own (`ha`), or a length with no square
		// spelling (`furlong`): measured in metres instead.
		const cubicMetres = convertUnit(area.toNumber(), area.unit as string, "m2") * convertUnit(length.toNumber(), length.unit as string, "m");
		return uomValue(cubicMetres, BASE_UNIT_FOR_POWER[3]);
	}

	return errorValue(
		"UNIT_PRODUCT_UNSUPPORTED",
		`A quantity in ${l.unit} times one in ${r.unit} has no unit: lengths multiply into an area or a volume, and a product of more than three lengths is not a unit.`,
	);
}

/**
 * The length a length, area or volume is measured in: a length is its own, and
 * an area or volume spelled as a power of one gives that one (`m²` gives `m`).
 * `undefined` for an area or volume with a name of its own (`ha`, `L`).
 */
function lengthBasis(unit: string, dimension: number): string | undefined {
	return dimension === 1 ? unit : rootUnit(unit, dimension);
}

/** A length raised to `power` as a unit spelling: the length itself for 1. */
function powerOfLength(length: string, power: number): string | undefined {
	return power === 1 ? length : poweredUnit(length, power);
}

/**
 * The quotient of an area or volume by a length or area that leaves a length or
 * an area; `undefined` when the pair is not that, so the caller keeps its own
 * rule (a length over an area, a reciprocal length, stays the rate `m/m²` it
 * always was).
 *
 * An area over a length is a length, a volume over an area is a length, and a
 * volume over a length is an area: `15 m² / 3 m` is 5 m, and `24 m³ / 6 m²` is
 * 4 m. The general divide read these as rates, so the first was `5.00 m2/m`. The
 * answer is measured in the length the dividend is a power of, the same rule
 * multiplication follows, or the divisor's where the dividend has a name of its
 * own (`1 ha / 50 m` is 200 m), and in metres where neither has one.
 *
 * @param l - The dividend.
 * @param r - The divisor.
 * @returns The length or area, or `undefined` if not applicable.
 */
export function divideLengths(l: Value, r: Value): Value | undefined {
	if (l.type !== ValueType.Uom || r.type !== ValueType.Uom || l.unit === undefined || r.unit === undefined) return undefined;
	const left = getMeasure(l.unit);
	const right = getMeasure(r.unit);
	const leftDimension = left === undefined ? undefined : GEOMETRIC_DIMENSION[left];
	const rightDimension = right === undefined ? undefined : GEOMETRIC_DIMENSION[right];
	if (leftDimension === undefined || rightDimension === undefined || leftDimension <= rightDimension) return undefined;
	const dimension = leftDimension - rightDimension;

	const basis = lengthBasis(l.unit, leftDimension) ?? lengthBasis(r.unit, rightDimension);
	if (basis !== undefined) {
		const dividendUnit = powerOfLength(basis, leftDimension);
		const divisorUnit = powerOfLength(basis, rightDimension);
		const resultUnit = powerOfLength(basis, dimension);
		if (dividendUnit !== undefined && divisorUnit !== undefined && resultUnit !== undefined) {
			const quotient = convertUnit(l.toNumber(), l.unit, dividendUnit) / convertUnit(r.toNumber(), r.unit, divisorUnit);
			return uomValue(quotient, resultUnit);
		}
	}
	// No length to measure in, or one with no square or cube spelling: metres.
	const quotient = convertUnit(l.toNumber(), l.unit, BASE_UNIT_FOR_POWER[leftDimension]) / convertUnit(r.toNumber(), r.unit, BASE_UNIT_FOR_POWER[rightDimension]);
	return uomValue(quotient, BASE_UNIT_FOR_POWER[dimension]);
}
