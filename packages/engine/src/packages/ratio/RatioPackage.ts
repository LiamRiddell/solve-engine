import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { stringValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import { reduceRatio } from "./RatioOps";
import { ratioCallParselet } from "./parselets/RatioCallParselet";

/**
 * Reduce a ratio to its lowest whole-number terms (issue #252): `ratio(1920,
 * 1080)` is `16:9`, `ratio(2, 4, 6)` is `1:2:3`. On by default and removable.
 *
 * It is a function, `ratio(...)`, rather than a `1920:1080` literal, because a
 * colon already builds a range (`1:10`). Reduction is by the greatest common
 * divisor. Parts must be whole positive numbers, and there must be at least two;
 * anything else is answered with a structured Error.
 */
export const RATIO_PACKAGE: IEnginePackage = {
	name: "solve-ratio",
	prefixParselets: {
		RATIO_CALL: ratioCallParselet,
	},
	// `ratio(...)`, fused to RATIO_CALL by the engine's shared call-fusion rule.
	callFusions: { ratio: "RATIO_CALL" },
	pluginFunctions: {
		ratioReduce: (args: Value[]): Value => {
			const parts: number[] = [];
			for (const arg of args) {
				if (arg.type !== ValueType.Number) {
					return errorValue("RATIO_EXPECTED_NUMBERS", "ratio expects whole numbers, e.g. ratio(16, 9)");
				}
				parts.push(arg.value as number);
			}
			const reduced = reduceRatio(parts);
			if (reduced === null) {
				return errorValue("RATIO_INVALID", "ratio needs at least two whole positive numbers");
			}
			return stringValue(reduced);
		},
	},
	tokenCategories: {
		RATIO_CALL: "function",
	},
};
