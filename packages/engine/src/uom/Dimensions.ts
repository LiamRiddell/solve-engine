import { Value, ValueType, uomValue } from "@solve-js/vm/Value";
import { getMeasure, convertUnit } from "@solve-js/uom/UomConverter";
import { MEASURE_SYMBOLS, UNIT_TABLE } from "@solve-js/uom/generated/UnitTable.generated";

/**
 * Just enough dimensional algebra to name a compound derived unit (issue #191,
 * widened by #513).
 *
 * A physical quantity has a dimension: a combination of the base quantities mass
 * (M), length (L), time (T) and electric current (I), each raised to a power.
 * A newton is mass times length over time squared (M·L·T⁻²); a watt is voltage
 * times current, which works out to M·L²·T⁻³. When two quantities are
 * multiplied, their dimensions add; when divided, they subtract. This module
 * tracks those exponents through a single multiply or divide, and, when the
 * result lands exactly on a named derived unit, produces that unit.
 *
 * A unit's dimension comes from its measure in the unit table, so every spelling
 * of a mass, a length, a time, an area, a volume, a force, an energy, a power, a
 * pressure, a voltage or a current takes part: `lb`, `ft`, `days` and `kWh` as
 * well as `kg`, `m`, `s` and `J`. Its size in the base SI units (kg, m, s, A)
 * comes from the same table, by converting one of it into the measure's SI unit.
 *
 * It is deliberately narrow: it only produces a result when the composition
 * names a derived unit (a newton, a joule, a watt, a pascal, a volt). Anything
 * else, a bare `m * m`, a `kg * m` with no name, is left to the caller's other
 * rules. See `vm/VM.ts`'s multiply and divide for the call sites.
 */

/** Exponents of the base quantities [mass, length, time, current]. */
type Dimension = readonly [number, number, number, number];

/** A measure's dimension, and the unit its SI size is read in. */
interface MeasureDimension {
	readonly dim: Dimension;
	/** The SI unit of the measure; one of a unit converted into this is its SI size. */
	readonly si: string;
}

/** Each measure that takes part, keyed by the name `getMeasure` reports. */
const MEASURE_DIMENSIONS: Readonly<Record<string, MeasureDimension>> = {
	mass: { dim: [1, 0, 0, 0], si: "kg" },
	length: { dim: [0, 1, 0, 0], si: "m" },
	area: { dim: [0, 2, 0, 0], si: "m2" },
	volume: { dim: [0, 3, 0, 0], si: "m3" },
	time: { dim: [0, 0, 1, 0], si: "s" },
	current: { dim: [0, 0, 0, 1], si: "A" },
	force: { dim: [1, 1, -2, 0], si: "N" },
	energy: { dim: [1, 2, -2, 0], si: "J" },
	power: { dim: [1, 2, -3, 0], si: "W" },
	pressure: { dim: [1, -1, -2, 0], si: "Pa" },
	voltage: { dim: [1, 2, -3, -1], si: "V" },
};

/**
 * Units with a dimension but no measure in the tables. `mps2` is acceleration
 * (m/s², the spelling the normalizer gives `m/s^2`), and `hr` an hour.
 */
const UNMEASURED_UNITS: Readonly<Record<string, { readonly dim: Dimension; readonly si: number }>> = {
	mps2: { dim: [0, 1, -2, 0], si: 1 },
	hr: { dim: [0, 0, 1, 0], si: 3600 },
};

/** The named unit a dimension composes onto, if it is a recognised derived one. */
const NAMED_OUTPUT: Readonly<Record<string, string>> = {
	"1,1,-2,0": "N",
	"1,2,-2,0": "J",
	"1,2,-3,0": "W",
	"1,-1,-2,0": "Pa",
	"1,2,-3,-1": "V",
};

/** The table's measure kind for power, as keyed in `MEASURE_SYMBOLS`. */
const POWER_KIND = 11;

/** The table's measure kind for energy, as keyed in `MEASURE_SYMBOLS`. */
const ENERGY_KIND = 3;

/** Seconds in an hour, the time in a watt-hour. */
const SECONDS_PER_HOUR = 3600;

const key = (d: Dimension): string => d.join(",");

/** A unit's dimension and SI size, or `null` when it takes no part. */
type DimensionedUnit = { readonly dim: Dimension; readonly si: number } | null;

/**
 * Units already looked up. The vocabulary is fixed, so this stays small; the
 * cap is for the labels a rate can carry (`bottles`), which are open-ended.
 */
const DIMENSION_CACHE = new Map<string, DimensionedUnit>();
const DIMENSION_CACHE_LIMIT = 1024;

/** A unit's dimension and SI size, or `null` when it takes no part. */
function dimensionOf(unit: string): DimensionedUnit {
	const cached = DIMENSION_CACHE.get(unit);
	if (cached !== undefined) return cached;
	let found: DimensionedUnit = UNMEASURED_UNITS[unit] ?? null;
	if (found === null) {
		const measure = getMeasure(unit);
		const dimension = measure === undefined ? undefined : MEASURE_DIMENSIONS[measure];
		if (dimension !== undefined) found = { dim: dimension.dim, si: convertUnit(1, unit, dimension.si) };
	}
	if (DIMENSION_CACHE.size < DIMENSION_CACHE_LIMIT) DIMENSION_CACHE.set(unit, found);
	return found;
}

/**
 * The symbol a table spelling is an alias of within one measure kind: `kilowatts`
 * and `kW` share an entry, so this finds `kW` for either. `shape`, when given,
 * picks among several symbols for one entry (`kW⋅h`, `kW h` and `kWh`).
 */
function symbolOf(unit: string, kind: number, shape?: RegExp): string | undefined {
	const entry = UNIT_TABLE[unit];
	if (entry === undefined || entry[0] !== kind) return undefined;
	for (const symbol of MEASURE_SYMBOLS[kind] ?? []) {
		if (UNIT_TABLE[symbol] === entry && (shape === undefined || shape.test(symbol))) return symbol;
	}
	return undefined;
}

/** The single-word watt-hour symbols: `Wh`, `kWh`, `MWh`. */
const WATT_HOUR_SYMBOL = /^[A-Za-z]*Wh$/;

/**
 * The watt-hour spelling for a power: `kW` gives `kWh`, `W` gives `Wh`. Found in
 * the table and checked against its size, so a power with no such spelling
 * (horsepower) gives `undefined` rather than an invented unit.
 */
function wattHourFor(power: string): string | undefined {
	const symbol = symbolOf(power, POWER_KIND);
	if (symbol === undefined) return undefined;
	const candidate = `${symbol}h`;
	const energy = UNIT_TABLE[candidate];
	const powerEntry = UNIT_TABLE[symbol];
	if (energy === undefined || energy[0] !== ENERGY_KIND || powerEntry === undefined) return undefined;
	return Math.abs(energy[1] - powerEntry[1] * SECONDS_PER_HOUR) <= energy[1] * 1e-9 ? candidate : undefined;
}

/** Whether a time unit is at least a minute long, so a count of watt-hours reads naturally in it. */
function isClockScale(unit: string): boolean {
	return getMeasure(unit) === "time" && convertUnit(1, unit, "s") >= 60;
}

/**
 * The name for an energy or a power worked out from a power and a time, where
 * the watt-hour reads better than the joule: a kilowatt for three hours is
 * `6.00 kWh`, not 21,600,000 joules, and six kilowatt-hours over three hours is
 * `2.00 kW`. `undefined` when the operands are not that shape, and the joule or
 * watt answer stands.
 */
function wattHourName(left: string, right: string, multiply: boolean, siResult: number): Value | null {
	if (multiply) {
		const [power, time] = getMeasure(left) === "power" ? [left, right] : [right, left];
		if (getMeasure(power) !== "power" || !isClockScale(time)) return null;
		const spelled = wattHourFor(power);
		if (spelled === undefined) return null;
		return uomValue(convertUnit(siResult, "J", spelled), spelled);
	}
	// A watt-hour energy over a clock-scale time is a power in the matching watt.
	if (getMeasure(left) !== "energy" || !isClockScale(right)) return null;
	const energySymbol = symbolOf(left, ENERGY_KIND, WATT_HOUR_SYMBOL);
	if (energySymbol === undefined) return null;
	const power = energySymbol.slice(0, -1);
	if (wattHourFor(power) !== energySymbol) return null;
	return uomValue(convertUnit(siResult, "W", power), power);
}

/**
 * The product or quotient of two dimensioned quantities, as a named derived
 * unit, or null when either operand is not dimensioned or the result is not a
 * named derived unit (in which case the caller keeps its existing behaviour).
 *
 * A power multiplied by a time of a minute or more is named in watt-hours with
 * the power's own prefix (`2 kW * 3 h` is 6.00 kWh), and a watt-hour energy over
 * such a time in the matching watt (`6 kWh / 3 h` is 2.00 kW); every other
 * energy and power is in joules and watts.
 */
export function tryDimensionalCompose(left: Value, right: Value, multiply: boolean): Value | null {
	if (left.type !== ValueType.Uom || right.type !== ValueType.Uom) return null;
	if (left.unit === undefined || right.unit === undefined) return null;
	const dl = dimensionOf(left.unit);
	if (dl === null) return null;
	const dr = dimensionOf(right.unit);
	if (dr === null) return null;

	const dim: Dimension = [
		dl.dim[0] + (multiply ? dr.dim[0] : -dr.dim[0]),
		dl.dim[1] + (multiply ? dr.dim[1] : -dr.dim[1]),
		dl.dim[2] + (multiply ? dr.dim[2] : -dr.dim[2]),
		dl.dim[3] + (multiply ? dr.dim[3] : -dr.dim[3]),
	];
	const name = NAMED_OUTPUT[key(dim)];
	if (name === undefined) return null;

	const siLeft = left.toNumber() * dl.si;
	const siRight = right.toNumber() * dr.si;
	const siResult = multiply ? siLeft * siRight : siLeft / siRight;
	if (name === "J" || name === "W") {
		const wattHours = wattHourName(left.unit, right.unit, multiply, siResult);
		if (wattHours !== null) return wattHours;
	}
	// Every named unit above is its measure's SI unit, so the base-SI magnitude
	// reads straight out in it.
	return uomValue(siResult, name);
}
