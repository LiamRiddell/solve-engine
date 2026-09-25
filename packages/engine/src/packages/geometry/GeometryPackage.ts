import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { Value, errorValue } from "@solve-js/vm/Value";
import { computeGeometry } from "./GeometryMath";
import { readDimensions, measureInUnit } from "./GeometryUnits";
import { geometryParselet } from "./parselets/GeometryParselet";

/**
 * Area, perimeter and volume of the common shapes (issue #253): `area of circle
 * radius 5`, `volume of cylinder radius 2 height 5`, `surface area of sphere
 * radius 3`. On by default and removable.
 *
 * Only the measure triggers (`area of`, `perimeter of`, `circumference of`,
 * `volume of`, `surface area of`) are fused phrases; the shape and dimension
 * words are ordinary identifiers, read in context, so none of them is reserved.
 * A dimension can carry a length unit, and the answer then takes the power its
 * measure has: `area of circle radius 5 m` is in m², a volume in m³ (#638, see
 * GeometryUnits.ts). Bare numbers answer a plain number, as they always have. A
 * missing or wrong dimension for a shape is answered with a structured Error.
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
			const read = readDimensions(args.slice(2));
			if (read instanceof Value) return read;
			const result = computeGeometry(measure, shape, read.dims);
			if (result.error !== undefined) return errorValue("GEOMETRY_ERROR", result.error);
			return measureInUnit(result.value!, measure, read.unit);
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
