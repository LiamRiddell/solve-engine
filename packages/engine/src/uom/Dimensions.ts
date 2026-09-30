import { Value, ValueType, uomValue, numberValue } from "@solve-js/vm/Value";
import { getMeasure, convertUnit, accelerationSize } from "@solve-js/uom/UomConverter";
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
 * of a mass, a length, a time, an area, a volume, a speed, a frequency, a
 * force, an energy, a power, a pressure, a voltage or a current takes part:
 * `lb`, `ft`, `days`, `mph`, `kHz` and `kWh` as well as `kg`, `m`, `s` and `J`.
 * A unit written with a slash has the dimension of its two halves (`km/h` is a
 * length over a time, `ft/s²` a length over a time squared). Its size in the
 * base SI units (kg, m, s, A) comes from the same table, by converting one of it
 * into the measure's SI unit.
 *
 * It is deliberately narrow: it only produces a result when the composition
 * names a derived unit (a newton, a joule, a watt, a pascal, a volt, an ampere),
 * or, when one side is a speed, an acceleration or a frequency, a speed, an
 * acceleration, a time or a plain count (#737). Anything else, a bare `m * m`,
 * a `kg * m` with no name, is left to the caller's other rules. See
 * `vm/VM.ts`'s multiply and divide for the call sites.
 */

/** Exponents of the base quantities [mass, length, time, current]. */
export type Dimension = readonly [number, number, number, number];

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
	speed: { dim: [0, 1, -1, 0], si: "mps" },
	frequency: { dim: [0, 0, -1, 0], si: "Hz" },
	force: { dim: [1, 1, -2, 0], si: "N" },
	energy: { dim: [1, 2, -2, 0], si: "J" },
	power: { dim: [1, 2, -3, 0], si: "W" },
	pressure: { dim: [1, -1, -2, 0], si: "Pa" },
	voltage: { dim: [1, 2, -3, -1], si: "V" },
};

/**
 * Units with a dimension but no measure in the tables. `mps2` is acceleration
 * (m/s², the spelling the normalizer gives `m/s^2`). `hr` used to be listed
 * here too; the table spells it now (#666), so it is found by measure like `h`.
 */
const UNMEASURED_UNITS: Readonly<Record<string, { readonly dim: Dimension; readonly si: number }>> = {
	mps2: { dim: [0, 1, -2, 0], si: 1 },
};

/** The named unit a dimension composes onto, if it is a recognised derived one. */
const NAMED_OUTPUT: Readonly<Record<string, string>> = {
	"1,1,-2,0": "N",
	"1,2,-2,0": "J",
	"1,2,-3,0": "W",
	"1,-1,-2,0": "Pa",
	"1,2,-3,-1": "V",
	"0,0,0,1": "A",
};

/** The dimension of a speed, a length per time. */
const SPEED = "0,1,-1,0";
/** The dimension of an acceleration, a length per time squared. */
const ACCELERATION = "0,1,-2,0";
/** The dimension of a frequency, a count per time. */
const FREQUENCY = "0,0,-1,0";
/** The dimension of a time. */
const TIME = "0,0,1,0";
/** No dimension at all: a plain count. */
const COUNT = "0,0,0,0";
/** The dimension of a mass. */
const MASS = "1,0,0,0";

/**
 * The results a product or quotient may have only when one side is a speed, an
 * acceleration or a frequency: `9.81 m/s^2 * 3 s` is a speed, `100 km/h / 10 s`
 * an acceleration and `10 Hz * 2 s` a count. Kept apart from
 * {@link NAMED_OUTPUT} because two plain quantities keep their own answer:
 * `90 km / 3 days` is 30 km/day, a rate in the reader's units, and not a speed
 * in metres per second. A time or a mass is named only when an acceleration is
 * one side (`29.43 m/s / 9.81 m/s^2` is 3 s, `20 N / 2 m/s^2` is 10 kg), since
 * a distance over a speed is already answered in the speed's own time
 * (`120 mi / 60 mph` is 2 hours).
 */
const KINEMATIC_OUTPUT: Readonly<Record<string, string>> = {
	[SPEED]: "m/s",
	[ACCELERATION]: "mps2",
	[COUNT]: "",
	[TIME]: "s",
	[MASS]: "kg",
};

/** The clock units a time quotient is read in, largest first. */
const CLOCK_UNITS: readonly string[] = ["h", "min", "s"];

/** The table's measure kind for power, as keyed in `MEASURE_SYMBOLS`. */
const POWER_KIND = 11;

/** The table's measure kind for energy, as keyed in `MEASURE_SYMBOLS`. */
const ENERGY_KIND = 3;

/** Seconds in an hour, the time in a watt-hour. */
const SECONDS_PER_HOUR = 3600;

const key = (d: Dimension): string => d.join(",");

/** A unit's dimension and SI size, or `null` when it takes no part. */
export type DimensionedUnit = { readonly dim: Dimension; readonly si: number } | null;

/**
 * Units already looked up. The vocabulary is fixed, so this stays small; the
 * cap is for the labels a rate can carry (`bottles`), which are open-ended.
 */
const DIMENSION_CACHE = new Map<string, DimensionedUnit>();
const DIMENSION_CACHE_LIMIT = 1024;

/** No dimension, and a size of one: the top of a count per something (`/s`). */
const DIMENSIONLESS: DimensionedUnit = { dim: [0, 0, 0, 0], si: 1 };

/** An own-property read, so a unit named after an inherited property (`constructor`) is never found. */
function ownEntry<T>(table: Readonly<Record<string, T>>, name: string): T | undefined {
	return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
}

/** The dimension of a single unit, one with no slash, from its measure. */
function simpleDimension(unit: string): DimensionedUnit {
	const unmeasured = ownEntry(UNMEASURED_UNITS, unit);
	if (unmeasured !== undefined) return unmeasured;
	const measure = getMeasure(unit);
	const dimension = measure === undefined ? undefined : ownEntry(MEASURE_DIMENSIONS, measure);
	return dimension === undefined ? null : { dim: dimension.dim, si: convertUnit(1, unit, dimension.si) };
}

/** The powers a unit after a slash may carry, as the superscript it is printed with. */
const SUPERSCRIPT_POWER: Readonly<Record<string, number>> = { "²": 2, "³": 3 };

/**
 * The dimension of a unit after a slash: a single unit, or one raised to a power
 * the table does not spell (`s²`, the squared time of an acceleration). A power
 * the table does spell (`m³`) is a volume, found by its measure.
 */
function denominatorDimension(unit: string): DimensionedUnit {
	const simple = simpleDimension(unit);
	if (simple !== null) return simple;
	const power = ownEntry(SUPERSCRIPT_POWER, unit.slice(-1));
	if (power === undefined) return null;
	const base = simpleDimension(unit.slice(0, -1));
	if (base === null) return null;
	return { dim: [base.dim[0] * power, base.dim[1] * power, base.dim[2] * power, base.dim[3] * power], si: base.si ** power };
}

/**
 * The dimension of a unit written with one slash, the dimension of its top
 * over that of its bottom: `km/h` is a speed and `ft/s²` an acceleration. A
 * count per something (`/s`) has a top of no dimension. `null` when either half
 * takes no part (money, a label such as `bottles`).
 */
function compoundDimension(unit: string): DimensionedUnit {
	const slash = unit.indexOf("/");
	if (slash < 0 || unit.indexOf("/", slash + 1) >= 0) return null;
	const top = slash === 0 ? DIMENSIONLESS : simpleDimension(unit.slice(0, slash));
	if (top === null) return null;
	const bottom = denominatorDimension(unit.slice(slash + 1));
	if (bottom === null) return null;
	return {
		dim: [top.dim[0] - bottom.dim[0], top.dim[1] - bottom.dim[1], top.dim[2] - bottom.dim[2], top.dim[3] - bottom.dim[3]],
		si: top.si / bottom.si,
	};
}

/**
 * A unit's dimension and SI size, or `null` when it takes no part.
 *
 * @param unit - A unit spelling, single (`kWh`) or with one slash (`km/h`).
 * @returns The exponents of mass, length, time and current, and the size of one
 * of it in base SI units, or `null`.
 */
export function dimensionOf(unit: string): DimensionedUnit {
	const cached = DIMENSION_CACHE.get(unit);
	if (cached !== undefined) return cached;
	// A unit with a measure of its own is read by it, even when it is spelled
	// with a slash (`cd/m2`, the nit, is a luminance and takes no part).
	const found = simpleDimension(unit) ?? (getMeasure(unit) === undefined ? compoundDimension(unit) : null);
	if (DIMENSION_CACHE.size < DIMENSION_CACHE_LIMIT) DIMENSION_CACHE.set(unit, found);
	return found;
}

/**
 * The unit and size of one `numerator` per one `denominator`, when that
 * quotient is a single unit the engine names: a kilowatt-hour per kilowatt is an
 * hour, and a kilowatt-hour per hour a kilowatt. `null` when the quotient names
 * no single unit (a second per kilogram, or a kilometre per hour, which is a
 * rate of its own).
 *
 * A time is read in hours when the numerator is a watt-hour (`kWh / kW` is 1 h,
 * `kWh / MW` 0.001 h), and otherwise in the largest of hours, minutes and
 * seconds that it counts whole (`J / W` is 1 s, `kJ / W` 1,000 s). This is what lets
 * a price per kilowatt-hour meet a power before the time has made it an energy
 * (#758).
 *
 * @param numerator - The unit on top, such as `kWh`.
 * @param denominator - The unit underneath, such as `kW`.
 * @returns The single unit and how many of it one quotient is, or `null`.
 */
export function unitQuotient(numerator: string, denominator: string): { readonly unit: string; readonly size: number } | null {
	const top = dimensionOf(numerator);
	const bottom = dimensionOf(denominator);
	if (top === null || bottom === null) return null;
	const dim: Dimension = [top.dim[0] - bottom.dim[0], top.dim[1] - bottom.dim[1], top.dim[2] - bottom.dim[2], top.dim[3] - bottom.dim[3]];
	const si = top.si / bottom.si;
	if (!Number.isFinite(si) || si <= 0) return null;
	if (key(dim) === TIME) {
		// A watt-hour over a power is counted in hours, as a bill counts it:
		// `kWh / MW` is a thousandth of an hour, not 3.6 seconds.
		if (symbolOf(numerator, ENERGY_KIND, WATT_HOUR_SYMBOL) !== undefined) return { unit: "h", size: si / SECONDS_PER_HOUR };
		for (const unit of CLOCK_UNITS) {
			const count = si / convertUnit(1, unit, "s");
			if (count >= 1 && Math.abs(count - Math.round(count)) <= count * 1e-9) return { unit, size: Math.round(count) };
		}
		return { unit: "s", size: si };
	}
	const composed = tryDimensionalCompose(uomValue(1, numerator), uomValue(1, denominator), false);
	if (composed === null || composed.type !== ValueType.Uom || composed.unit === undefined) return null;
	// Only a single unit: a speed (`m/s`) would make a rate per a rate.
	if (composed.unit.includes("/") || composed.unit === "mps2") return null;
	return { unit: composed.unit, size: composed.toNumber() };
}

/**
 * The speed an acceleration gives over a time, in the acceleration's own
 * length and time: `ft/s²` over a time is in `ft/s`. `undefined` when neither
 * operand is an acceleration spelled with its parts (`mps2` gives `m/s`, the
 * SI default).
 */
function speedInAccelerationUnits(left: string, right: string, siResult: number): Value | undefined {
	for (const unit of [left, right]) {
		if (unit === "mps2" || accelerationSize(unit) === undefined) continue;
		const slash = unit.indexOf("/");
		const length = unit.slice(0, slash);
		const time = unit.slice(slash + 1, -1);
		return uomValue(siResult / (convertUnit(1, length, "m") / convertUnit(1, time, "s")), `${length}/${time}`);
	}
	return undefined;
}

/**
 * A product or quotient with a speed, an acceleration or a frequency on one
 * side, as the speed, acceleration, time or plain count it comes to; `undefined`
 * when it is not one of those (see {@link KINEMATIC_OUTPUT}).
 */
function kinematicResult(result: string, sides: readonly string[], left: string, right: string, siResult: number): Value | undefined {
	const output = ownEntry(KINEMATIC_OUTPUT, result);
	if (output === undefined) return undefined;
	const accelerating = sides.includes(ACCELERATION);
	if (!accelerating && !sides.includes(SPEED) && !sides.includes(FREQUENCY)) return undefined;
	if ((result === TIME || result === MASS) && !accelerating) return undefined;
	if (result === COUNT) return numberValue(siResult);
	if (result === SPEED) return speedInAccelerationUnits(left, right, siResult) ?? uomValue(siResult, output);
	return uomValue(siResult, output);
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
 * `2.00 kW`. `null` when the operands are not that shape, and the joule or watt
 * answer stands.
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
	const siLeft = left.toNumber() * dl.si;
	const siRight = right.toNumber() * dr.si;
	const siResult = multiply ? siLeft * siRight : siLeft / siRight;
	const kinematic = kinematicResult(key(dim), [key(dl.dim), key(dr.dim)], left.unit, right.unit, siResult);
	if (kinematic !== undefined) return kinematic;
	const name = ownEntry(NAMED_OUTPUT, key(dim));
	if (name === undefined) return null;
	if (name === "J" || name === "W") {
		const wattHours = wattHourName(left.unit, right.unit, multiply, siResult);
		if (wattHours !== null) return wattHours;
	}
	// Every named unit above is its measure's SI unit, so the base-SI magnitude
	// reads straight out in it.
	return uomValue(siResult, name);
}
