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

/**
 * Named derived units on output (issue #191). Multiplying two compatible
 * quantities composes their dimensions in the VM (see `uom/Dimensions.ts`); this
 * package supplies the `as <named unit>` readouts and the `m/s^2` acceleration
 * literal. On by default and removable.
 *
 * The `as` targets are lower-cased converter names, so `as N`, `as kWh` and
 * `as w` all reach the right unit.
 */
export const DERIVED_UNITS_PACKAGE: IEnginePackage = {
	name: "solve-derived-units",
	normalizerRules: [accelerationNormalizerRule()],
	asConverters: {
		n: asUnit("N"), kn: asUnit("kN"),
		j: asUnit("J"), kj: asUnit("kJ"), mj: asUnit("MJ"), wh: asUnit("Wh"), kwh: asUnit("kWh"),
		w: asUnit("W"), kw: asUnit("kW"), mw: asUnit("MW"),
		pa: asUnit("Pa"), kpa: asUnit("kPa"), mpa: asUnit("MPa"),
		v: asUnit("V"), mv: asUnit("mV"), kv: asUnit("kV"),
	},
};
