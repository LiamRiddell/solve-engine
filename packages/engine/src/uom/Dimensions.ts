import { Value, ValueType, uomValue } from "@solve-js/vm/Value";

/**
 * Just enough dimensional algebra to name a compound derived unit (issue #191).
 *
 * A physical quantity has a dimension: a combination of the base quantities mass
 * (M), length (L), time (T) and electric current (I), each raised to a power.
 * A newton is mass times length over time squared (M·L·T⁻²); a watt is voltage
 * times current, which works out to M·L²·T⁻³. When two quantities are
 * multiplied, their dimensions add; when divided, they subtract. This module
 * tracks those exponents through a single multiply or divide, and, when the
 * result lands exactly on a named derived unit, produces that unit.
 *
 * It is deliberately narrow: it only ever fires for the units it knows, and only
 * produces a result when the composition names a derived unit (a newton, a
 * joule, a watt, a pascal, a volt). Anything else, a bare `m * m`, a `kg * m`
 * with no name, is left to the ordinary unit arithmetic, so nothing that worked
 * before changes. See `vm/VM.ts`'s multiply and divide for the call sites.
 */

/** Exponents of the base quantities [mass, length, time, current]. */
type Dimension = readonly [number, number, number, number];

interface Dimensioned {
	readonly dim: Dimension;
	/** Multiply a value in this unit by this to read it in the base SI units (kg, m, s, A). */
	readonly si: number;
}

/** The units this algebra understands, each as its dimension and SI scale. */
const DIMENSIONED_UNITS: Record<string, Dimensioned> = {
	// Mass (base kg).
	kg: { dim: [1, 0, 0, 0], si: 1 }, g: { dim: [1, 0, 0, 0], si: 0.001 },
	tonne: { dim: [1, 0, 0, 0], si: 1000 }, t: { dim: [1, 0, 0, 0], si: 1000 },
	// Length (base m).
	m: { dim: [0, 1, 0, 0], si: 1 }, cm: { dim: [0, 1, 0, 0], si: 0.01 },
	mm: { dim: [0, 1, 0, 0], si: 0.001 }, km: { dim: [0, 1, 0, 0], si: 1000 },
	// Time (base s).
	s: { dim: [0, 0, 1, 0], si: 1 }, ms: { dim: [0, 0, 1, 0], si: 0.001 },
	min: { dim: [0, 0, 1, 0], si: 60 }, minute: { dim: [0, 0, 1, 0], si: 60 }, minutes: { dim: [0, 0, 1, 0], si: 60 },
	h: { dim: [0, 0, 1, 0], si: 3600 }, hr: { dim: [0, 0, 1, 0], si: 3600 },
	hour: { dim: [0, 0, 1, 0], si: 3600 }, hours: { dim: [0, 0, 1, 0], si: 3600 },
	// Current (base A).
	A: { dim: [0, 0, 0, 1], si: 1 }, mA: { dim: [0, 0, 0, 1], si: 0.001 }, kA: { dim: [0, 0, 0, 1], si: 1000 },
	ampere: { dim: [0, 0, 0, 1], si: 1 }, amperes: { dim: [0, 0, 0, 1], si: 1 },
	// Acceleration (m/s², stored slash-free as `mps2`; see the normalizer).
	mps2: { dim: [0, 1, -2, 0], si: 1 },
	// Named derived units, so composing back onto them, or multiplying them
	// further, both work (a newton times a metre is a joule).
	N: { dim: [1, 1, -2, 0], si: 1 }, kN: { dim: [1, 1, -2, 0], si: 1000 },
	newton: { dim: [1, 1, -2, 0], si: 1 }, newtons: { dim: [1, 1, -2, 0], si: 1 },
	J: { dim: [1, 2, -2, 0], si: 1 }, kJ: { dim: [1, 2, -2, 0], si: 1000 }, MJ: { dim: [1, 2, -2, 0], si: 1e6 },
	joule: { dim: [1, 2, -2, 0], si: 1 }, joules: { dim: [1, 2, -2, 0], si: 1 },
	Wh: { dim: [1, 2, -2, 0], si: 3600 }, kWh: { dim: [1, 2, -2, 0], si: 3.6e6 },
	W: { dim: [1, 2, -3, 0], si: 1 }, kW: { dim: [1, 2, -3, 0], si: 1000 }, MW: { dim: [1, 2, -3, 0], si: 1e6 },
	watt: { dim: [1, 2, -3, 0], si: 1 }, watts: { dim: [1, 2, -3, 0], si: 1 },
	Pa: { dim: [1, -1, -2, 0], si: 1 }, kPa: { dim: [1, -1, -2, 0], si: 1000 }, MPa: { dim: [1, -1, -2, 0], si: 1e6 },
	pascal: { dim: [1, -1, -2, 0], si: 1 }, pascals: { dim: [1, -1, -2, 0], si: 1 },
	V: { dim: [1, 2, -3, -1], si: 1 }, mV: { dim: [1, 2, -3, -1], si: 0.001 }, kV: { dim: [1, 2, -3, -1], si: 1000 },
	volt: { dim: [1, 2, -3, -1], si: 1 }, volts: { dim: [1, 2, -3, -1], si: 1 },
};

/** The named unit a dimension composes onto, if it is a recognised derived one. */
const NAMED_OUTPUT: Record<string, string> = {
	"1,1,-2,0": "N",
	"1,2,-2,0": "J",
	"1,2,-3,0": "W",
	"1,-1,-2,0": "Pa",
	"1,2,-3,-1": "V",
};

const key = (d: Dimension): string => d.join(",");

/**
 * The product or quotient of two dimensioned quantities, as a named derived
 * unit, or null when either operand is not dimensioned or the result is not a
 * named derived unit (in which case the caller keeps its existing behaviour).
 */
export function tryDimensionalCompose(left: Value, right: Value, multiply: boolean): Value | null {
	if (left.type !== ValueType.Uom || right.type !== ValueType.Uom) return null;
	const dl = left.unit ? DIMENSIONED_UNITS[left.unit] : undefined;
	const dr = right.unit ? DIMENSIONED_UNITS[right.unit] : undefined;
	if (dl === undefined || dr === undefined) return null;

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
	// The named unit is stored at its own SI scale (all the ones above are 1),
	// so the base-SI magnitude reads straight out in it.
	return uomValue(siResult / DIMENSIONED_UNITS[name].si, name);
}
