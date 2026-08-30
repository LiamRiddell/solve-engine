import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { numberValue, stringValue, uomValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import { bmi, speedKmh, pacePerKm } from "./HealthOps";
import { HealthCallParselet } from "./parselets/HealthCallParselet";
import { HEALTH_CALL_FUNCTIONS } from "./HealthFunctionNames";

/** Read an argument as a number, accepting a bare number or a Uom (its magnitude). */
function num(value: Value | undefined): number | null {
	if (value?.type === ValueType.Number) return value.value as number;
	if (value?.type === ValueType.Uom) return value.toNumber();
	return null;
}

/**
 * Everyday health and fitness helpers (issue #257): `bmi(weight, height)`,
 * `pace(distance, time)` and `speed(distance, time)`. On by default and
 * removable.
 *
 * They are functions, to stay clear of the many common words involved. Inputs
 * are plain numbers in the stated units: kilograms and metres for BMI,
 * kilometres and minutes for pace and speed. `pace` and `speed` are the two ways
 * the same effort is read, time per distance against distance per time.
 */
export const HEALTH_PACKAGE: IEnginePackage = {
	name: "solve-health",
	prefixParselets: {
		HEALTH_CALL: new HealthCallParselet(),
	},
	// `bmi(...)`, `pace(...)`, `speed(...)` fused to HEALTH_CALL by the shared rule.
	callFusions: Object.fromEntries(Object.keys(HEALTH_CALL_FUNCTIONS).map((n) => [n, "HEALTH_CALL"])),
	pluginFunctions: {
		healthBmi: (args: Value[]): Value => {
			const w = num(args[0]), h = num(args[1]);
			if (w === null || h === null || h === 0) return errorValue("HEALTH_BAD_INPUT", "bmi(weight in kg, height in m), e.g. bmi(70, 1.75)");
			return numberValue(bmi(w, h));
		},
		healthPace: (args: Value[]): Value => {
			const d = num(args[0]), t = num(args[1]);
			if (d === null || t === null || d === 0) return errorValue("HEALTH_BAD_INPUT", "pace(distance in km, time in min), e.g. pace(10, 50)");
			return stringValue(`${pacePerKm(d, t)} /km`);
		},
		healthSpeed: (args: Value[]): Value => {
			const d = num(args[0]), t = num(args[1]);
			if (d === null || t === null || t === 0) return errorValue("HEALTH_BAD_INPUT", "speed(distance in km, time in min), e.g. speed(10, 50)");
			return uomValue(speedKmh(d, t), "km/h");
		},
	},
	tokenCategories: {
		HEALTH_CALL: "function",
	},
};
