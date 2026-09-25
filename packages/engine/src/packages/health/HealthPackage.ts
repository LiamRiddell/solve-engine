import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { numberValue, stringValue, uomValue, errorValue, type Value } from "@solve-js/vm/Value";
import { bmi, speedKmh, pacePerKm } from "./HealthOps";
import { HealthCallParselet } from "./parselets/HealthCallParselet";
import { HEALTH_CALL_FUNCTIONS } from "./HealthFunctionNames";
import { readHealthInput, WEIGHT, HEIGHT, DISTANCE, DURATION, type HealthInput } from "./HealthUnits";

/**
 * Read a function's two arguments in its units, or the value that refuses them:
 * a refusal by name for a quantity of the wrong measure or a negative figure,
 * and `usage` for an argument that is neither a number nor a quantity.
 */
function readPair(fn: string, args: Value[], first: HealthInput, second: HealthInput, usage: string): [number, number] | Value {
	const a = readHealthInput(fn, args[0], first);
	if (typeof a !== "number") return a ?? errorValue("HEALTH_BAD_INPUT", usage);
	const b = readHealthInput(fn, args[1], second);
	if (typeof b !== "number") return b ?? errorValue("HEALTH_BAD_INPUT", usage);
	return [a, b];
}

/**
 * Everyday health and fitness helpers (issue #257): `bmi(weight, height)`,
 * `pace(distance, time)` and `speed(distance, time)`. On by default and
 * removable.
 *
 * They are functions, to stay clear of the many common words involved. Each
 * works in stated units: kilograms and metres for BMI, kilometres and minutes
 * for pace and speed. A plain number is read in that unit, and a quantity is
 * converted into it, so `bmi(70 kg, 175 cm)` and `bmi(70, 1.75)` agree (#644;
 * see HealthUnits.ts). `pace` and `speed` are the two ways the same effort is
 * read, time per distance against distance per time.
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
			const usage = "bmi(weight in kg, height in m), e.g. bmi(70, 1.75)";
			const read = readPair("bmi", args, WEIGHT, HEIGHT, usage);
			if (!Array.isArray(read)) return read;
			const [w, h] = read;
			if (h === 0) return errorValue("HEALTH_BAD_INPUT", usage);
			return numberValue(bmi(w, h));
		},
		healthPace: (args: Value[]): Value => {
			const usage = "pace(distance in km, time in min), e.g. pace(10, 50)";
			const read = readPair("pace", args, DISTANCE, DURATION, usage);
			if (!Array.isArray(read)) return read;
			const [d, t] = read;
			if (d === 0) return errorValue("HEALTH_BAD_INPUT", usage);
			return stringValue(`${pacePerKm(d, t)} /km`);
		},
		healthSpeed: (args: Value[]): Value => {
			const usage = "speed(distance in km, time in min), e.g. speed(10, 50)";
			const read = readPair("speed", args, DISTANCE, DURATION, usage);
			if (!Array.isArray(read)) return read;
			const [d, t] = read;
			if (t === 0) return errorValue("HEALTH_BAD_INPUT", usage);
			return uomValue(speedKmh(d, t), "km/h");
		},
	},
	tokenCategories: {
		HEALTH_CALL: "function",
	},
};
