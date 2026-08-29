import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { numberValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import { computeGeometry, type Dimensions } from "./GeometryMath";
import { geometryParselet } from "./parselets/GeometryParselet";

/**
 * Area, perimeter and volume of the common shapes (issue #253): `area of circle
 * radius 5`, `volume of cylinder radius 2 height 5`, `surface area of sphere
 * radius 3`. On by default and removable.
 *
 * Only the measure triggers (`area of`, `perimeter of`, `circumference of`,
 * `volume of`, `surface area of`) are fused phrases; the shape and dimension
 * words are ordinary identifiers, read in context, so none of them is reserved.
 * Dimensions are plain numbers in this slice (unitless); a missing or wrong
 * dimension for a shape is answered with a structured Error.
 */
export const GEOMETRY_PACKAGE: IEnginePackage = {
	name: "solve-geometry",
	phrases: {
		"area of": "AREA_OF",
		"perimeter of": "PERIMETER_OF",
		"circumference of": "CIRCUMFERENCE_OF",
		"volume of": "VOLUME_OF",
		"surface area of": "SURFACE_AREA_OF",
	},
	prefixParselets: {
		AREA_OF: geometryParselet("area"),
		PERIMETER_OF: geometryParselet("perimeter"),
		CIRCUMFERENCE_OF: geometryParselet("circumference"),
		VOLUME_OF: geometryParselet("volume"),
		SURFACE_AREA_OF: geometryParselet("surface"),
	},
	pluginFunctions: {
		geometryCompute: (args: Value[]): Value => {
			const measure = String(args[0]?.value ?? "");
			const shape = String(args[1]?.value ?? "");
			const dims: Dimensions = {};
			for (let i = 2; i + 1 < args.length; i += 2) {
				const name = String(args[i]?.value ?? "");
				const val = args[i + 1];
				if (val?.type === ValueType.Error) return val;
				dims[name] = val?.toNumber() ?? NaN;
			}
			const result = computeGeometry(measure, shape, dims);
			if (result.error !== undefined) return errorValue("GEOMETRY_ERROR", result.error);
			return numberValue(result.value!);
		},
	},
	tokenCategories: {
		AREA_OF: "function",
		PERIMETER_OF: "function",
		CIRCUMFERENCE_OF: "function",
		VOLUME_OF: "function",
		SURFACE_AREA_OF: "function",
	},
};
