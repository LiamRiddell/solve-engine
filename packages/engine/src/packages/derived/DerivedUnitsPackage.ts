import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { Value, ValueType, uomValue, errorValue } from "@solve-js/vm/Value";
import { canConvert, convertUnit } from "@solve-js/uom/UomConverter";
import { accelerationNormalizerRule } from "./normalizer/AccelerationNormalizerRule";

/**
 * A converter that expresses a quantity in a named unit, `... as N`, `... as
 * kWh`. It is the readout half of dimensional arithmetic (issue #191): once
 * `kg * m/s^2` has composed into a force, `as N` shows it in newtons, and a
 * composed energy shows in `as kWh`. It converts within a measure, so a mass
 * asked to be a newton is a clear error, not a wrong number.
 */
function asUnit(target: string): (value: Value) => Value {
	return (value: Value): Value => {
		if (value.type !== ValueType.Uom || !value.unit) {
			return errorValue("AS_UNIT_EXPECTED_QUANTITY", `"as ${target}" expects a quantity with a unit`);
		}
		if (value.unit === target) return value;
		if (!canConvert(value.unit, target)) {
			return errorValue("AS_UNIT_INCOMPATIBLE", `${value.unit} cannot be expressed as ${target}: they do not measure the same thing`);
		}
		return uomValue(convertUnit(value.toNumber(), value.unit, target), target);
	};
}

/** The SI prefixes the unit table spells before the derived units, smallest first. */
const SI_PREFIXES = ["p", "n", "µ", "m", "k", "M", "G", "T", "P"] as const;

/**
 * The `as` readouts for a unit and each prefixed spelling of it, keyed by the
 * spelling itself: `W`, `pW`, `nW`, `µW`, `mW`, `kW`, `MW` and so on.
 *
 * @param base - The unprefixed symbol.
 * @param prefixes - The prefixes the unit table spells before it.
 */
function prefixedReadouts(base: string, prefixes: readonly string[] = SI_PREFIXES): Record<string, (value: Value) => Value> {
	const readouts: Record<string, (value: Value) => Value> = { [base]: asUnit(base) };
	for (const prefix of prefixes) readouts[prefix + base] = asUnit(prefix + base);
	return readouts;
}

/**
 * Named derived units on output (issue #191). Multiplying two compatible
 * quantities composes their dimensions in the VM (see `uom/Dimensions.ts`); this
 * package supplies the `as <named unit>` readouts and the `m/s^2` acceleration
 * literal. On by default and removable.
 *
 * The `as` targets are registered under their own spellings. A name is
 * matched as typed first, so `as mW` is milliwatts and `as MW` megawatts
 * (issue #824); a spelling that matches none (`as n`, `as KWH`) falls back to
 * the lower-cased name, which reaches the one unit it can mean, and a
 * lower-cased name two units share (`as mw`) is refused by name rather than
 * read as either.
 */
export const DERIVED_UNITS_PACKAGE: IEnginePackage = {
	name: "solve-derived-units",
	normalizerRules: [accelerationNormalizerRule()],
	asConverters: {
		...prefixedReadouts("N"),
		...prefixedReadouts("J"),
		...prefixedReadouts("Wh"),
		...prefixedReadouts("W"),
		...prefixedReadouts("Pa"),
		// The unit table spells only the millivolt and the kilovolt.
		...prefixedReadouts("V", ["m", "k"]),
	},
};
