/**
 * The physical and mathematical constants, as pure data: a name to a value and,
 * where it has one, an engine unit. A constant with a unit becomes a Uom value,
 * so it flows into unit conversions and the derived-unit algebra (`gravity * 70
 * kg as N` is a force); one without becomes a plain number.
 *
 * Values are the current CODATA / defined figures. `pi` and `e` are left to the
 * engine's existing tokens and are not redefined here.
 */

/** One constant: its numeric value, and the engine unit it carries (if any). */
export interface ConstantEntry {
	readonly value: number;
	readonly unit?: string;
}

/** The constant table: each name to its value and optional engine unit. */
export const CONSTANTS: Record<string, ConstantEntry> = {
	// Dimensioned: these carry a unit and take part in unit arithmetic.
	"speed of light": { value: 299792458, unit: "m/s" },
	gravity: { value: 9.80665, unit: "mps2" },
	"electron mass": { value: 9.1093837015e-31, unit: "kg" },
	"proton mass": { value: 1.67262192369e-27, unit: "kg" },

	// Precise values without a simple engine unit (the unit is noted in the docs).
	avogadro: { value: 6.02214076e23 },
	planck: { value: 6.62607015e-34 },
	boltzmann: { value: 1.380649e-23 },
	"elementary charge": { value: 1.602176634e-19 },
	"gas constant": { value: 8.314462618 },

	// Mathematical.
	tau: { value: 6.283185307179586 },
	"golden ratio": { value: 1.618033988749895 },
	phi: { value: 1.618033988749895 },
};

/** Look up a constant by name, or null if it is not one. */
export function constantEntry(name: string): ConstantEntry | null {
	return CONSTANTS[name.toLowerCase()] ?? null;
}
