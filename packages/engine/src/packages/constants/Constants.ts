/**
 * The physical and mathematical constants, as pure data: a name to a value and,
 * where it has one, an engine unit. A constant with a unit becomes a Uom value,
 * so it flows into unit conversions and the derived-unit algebra (`gravity * 70
 * kg as N` is a force); one without becomes a plain number. A physical constant
 * whose unit the engine cannot spell yet (`planck`, in J·s) is a plain number
 * marked with that unit, so a quantity meeting it is refused rather than lending
 * the answer its own unit (#648).
 *
 * Values are the current CODATA / defined figures. `pi` and `e` are left to the
 * engine's existing tokens and are not redefined here.
 */

/** One constant: its numeric value, and the engine unit it carries (if any). */
export interface ConstantEntry {
	readonly value: number;
	readonly unit?: string;
	/**
	 * The unit a physical constant is measured in when the engine has no
	 * spelling for it yet (`J·s`), as the reader would write it. The constant
	 * stays a plain number, and a quantity meeting it is refused rather than
	 * lending the answer its own unit (#648).
	 */
	readonly unspelledUnit?: string;
}

/** The constant table: each name to its value and optional engine unit. */
export const CONSTANTS: Record<string, ConstantEntry> = {
	// Dimensioned: these carry a unit and take part in unit arithmetic.
	"speed of light": { value: 299792458, unit: "m/s" },
	gravity: { value: 9.80665, unit: "mps2" },
	"electron mass": { value: 9.1093837015e-31, unit: "kg" },
	"proton mass": { value: 1.67262192369e-27, unit: "kg" },
	// Joules per kelvin, a rate the engine reads and cancels: `boltzmann * 300 K`
	// is an energy in joules (#648).
	boltzmann: { value: 1.380649e-23, unit: "J/K" },

	// Precise values whose unit needs a dimension the engine does not have yet
	// (charge, the mole, a product of units). Each is a plain number, marked
	// with the unit it is really in so a quantity meeting it is refused by name.
	avogadro: { value: 6.02214076e23, unspelledUnit: "mol⁻¹" },
	planck: { value: 6.62607015e-34, unspelledUnit: "J·s" },
	"elementary charge": { value: 1.602176634e-19, unspelledUnit: "coulombs" },
	"gas constant": { value: 8.314462618, unspelledUnit: "J/(mol·K)" },

	// Mathematical.
	tau: { value: 6.283185307179586 },
	"golden ratio": { value: 1.618033988749895 },
	phi: { value: 1.618033988749895 },
};

/** Look up a constant by name, or null if it is not one. */
export function constantEntry(name: string): ConstantEntry | null {
	return CONSTANTS[name.toLowerCase()] ?? null;
}
