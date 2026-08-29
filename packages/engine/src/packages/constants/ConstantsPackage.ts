import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { numberValue, uomValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import { constantEntry } from "./Constants";
import { constantParselet } from "./parselets/ConstantParselet";

/**
 * Named physical and mathematical constants (issue #256): `speed of light`,
 * `gravity`, `avogadro`, `planck`, `tau`, `golden ratio` and more. On by default
 * and removable.
 *
 * A constant with a unit (the speed of light in m/s, gravity in m/s²) becomes a
 * Uom value, so it converts and takes part in unit arithmetic: `gravity * 70 kg
 * as N` is a force. The multi-word constants are fused phrases; the single-word
 * ones are keywords. `pi` and `e` already exist in the language and are left
 * untouched.
 */
export const CONSTANTS_PACKAGE: IEnginePackage = {
	name: "solve-constants",
	phrases: {
		"speed of light": "SPEED_OF_LIGHT",
		"electron mass": "ELECTRON_MASS",
		"proton mass": "PROTON_MASS",
		"elementary charge": "ELEMENTARY_CHARGE",
		"gas constant": "GAS_CONSTANT",
		"golden ratio": "GOLDEN_RATIO",
	},
	lexerVocabulary: {
		keywords: {
			gravity: "GRAVITY",
			avogadro: "AVOGADRO",
			planck: "PLANCK",
			boltzmann: "BOLTZMANN",
			tau: "TAU",
			phi: "PHI",
		},
	},
	prefixParselets: {
		SPEED_OF_LIGHT: constantParselet("speed of light"),
		ELECTRON_MASS: constantParselet("electron mass"),
		PROTON_MASS: constantParselet("proton mass"),
		ELEMENTARY_CHARGE: constantParselet("elementary charge"),
		GAS_CONSTANT: constantParselet("gas constant"),
		GOLDEN_RATIO: constantParselet("golden ratio"),
		GRAVITY: constantParselet("gravity"),
		AVOGADRO: constantParselet("avogadro"),
		PLANCK: constantParselet("planck"),
		BOLTZMANN: constantParselet("boltzmann"),
		TAU: constantParselet("tau"),
		PHI: constantParselet("phi"),
	},
	pluginFunctions: {
		constantValue: (args: Value[]): Value => {
			const name = args[0]?.type === ValueType.String ? (args[0].value as string) : "";
			const entry = constantEntry(name);
			if (entry === null) return errorValue("UNKNOWN_CONSTANT", `"${name}" is not a known constant`);
			return entry.unit ? uomValue(entry.value, entry.unit) : numberValue(entry.value);
		},
	},
	tokenCategories: {
		SPEED_OF_LIGHT: "keyword",
		ELECTRON_MASS: "keyword",
		PROTON_MASS: "keyword",
		ELEMENTARY_CHARGE: "keyword",
		GAS_CONSTANT: "keyword",
		GOLDEN_RATIO: "keyword",
		GRAVITY: "keyword",
		AVOGADRO: "keyword",
		PLANCK: "keyword",
		BOLTZMANN: "keyword",
		TAU: "keyword",
		PHI: "keyword",
	},
};
