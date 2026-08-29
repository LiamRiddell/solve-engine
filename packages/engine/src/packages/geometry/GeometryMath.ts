/**
 * The geometry formulae as pure functions: a measure (area, perimeter, ...), a
 * shape, and its named dimensions in, a number out, or a message naming what is
 * missing. No engine types, so each formula is unit-tested on its own.
 *
 * Dimensions are plain numbers here (unitless). A measure that a shape does not
 * define (the perimeter of a triangle, without its three sides), or a missing
 * dimension, is a clear error rather than a guess.
 */

export type Dimensions = Record<string, number>;
/** The outcome of a geometry computation: a `value`, or an `error` message naming what was missing. */
export interface GeometryResult {
	readonly value?: number;
	readonly error?: string;
}

const PI = Math.PI;

/** Read the named dimensions, or null if any is missing. */
function read(dims: Dimensions, names: string[]): number[] | null {
	const out: number[] = [];
	for (const name of names) {
		if (!(name in dims)) return null;
		out.push(dims[name]);
	}
	return out;
}

/** The shapes the package understands, used by the parselet and for a helpful error. */
export const SHAPES = ["circle", "square", "rectangle", "triangle", "sphere", "cube", "cylinder", "cone"];
/** The dimension words the parselet recognises after a shape. */
export const DIMENSIONS = ["radius", "side", "width", "height", "base", "length"];

/**
 * Compute a measure of a shape from its dimensions. `measure` is one of area,
 * perimeter, circumference, volume, surface; `shape` one of {@link SHAPES}.
 */
export function computeGeometry(measure: string, shape: string, dims: Dimensions): GeometryResult {
	const missing = (need: string) => ({ error: `the ${measure} of a ${shape} needs its ${need}` });
	const unsupported = { error: `the ${measure} of a ${shape} is not one of the shapes this supports` };

	switch (`${measure}:${shape}`) {
		// Circle
		case "area:circle": {
			const d = read(dims, ["radius"]); return d ? { value: PI * d[0] ** 2 } : missing("radius");
		}
		case "perimeter:circle":
		case "circumference:circle": {
			const d = read(dims, ["radius"]); return d ? { value: 2 * PI * d[0] } : missing("radius");
		}
		// Square
		case "area:square": {
			const d = read(dims, ["side"]); return d ? { value: d[0] ** 2 } : missing("side");
		}
		case "perimeter:square": {
			const d = read(dims, ["side"]); return d ? { value: 4 * d[0] } : missing("side");
		}
		// Rectangle
		case "area:rectangle": {
			const d = read(dims, ["width", "height"]); return d ? { value: d[0] * d[1] } : missing("width and height");
		}
		case "perimeter:rectangle": {
			const d = read(dims, ["width", "height"]); return d ? { value: 2 * (d[0] + d[1]) } : missing("width and height");
		}
		// Triangle (area from base and height; its perimeter needs three sides)
		case "area:triangle": {
			const d = read(dims, ["base", "height"]); return d ? { value: 0.5 * d[0] * d[1] } : missing("base and height");
		}
		// Sphere
		case "volume:sphere": {
			const d = read(dims, ["radius"]); return d ? { value: (4 / 3) * PI * d[0] ** 3 } : missing("radius");
		}
		case "surface:sphere": {
			const d = read(dims, ["radius"]); return d ? { value: 4 * PI * d[0] ** 2 } : missing("radius");
		}
		// Cube
		case "volume:cube": {
			const d = read(dims, ["side"]); return d ? { value: d[0] ** 3 } : missing("side");
		}
		case "surface:cube": {
			const d = read(dims, ["side"]); return d ? { value: 6 * d[0] ** 2 } : missing("side");
		}
		// Cylinder
		case "volume:cylinder": {
			const d = read(dims, ["radius", "height"]); return d ? { value: PI * d[0] ** 2 * d[1] } : missing("radius and height");
		}
		case "surface:cylinder": {
			const d = read(dims, ["radius", "height"]); return d ? { value: 2 * PI * d[0] * (d[0] + d[1]) } : missing("radius and height");
		}
		// Cone (volume)
		case "volume:cone": {
			const d = read(dims, ["radius", "height"]); return d ? { value: (1 / 3) * PI * d[0] ** 2 * d[1] } : missing("radius and height");
		}
		default:
			return unsupported;
	}
}
