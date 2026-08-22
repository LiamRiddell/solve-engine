/**
 * Runtime handlers for the colour functions, dispatched through `CALL_PLUGIN`.
 *
 * Each handler reads its already-evaluated arguments off the stack (as `Value`s),
 * validates arity and type, and returns a colour `Value` (or a `Number` for the
 * measuring functions `contrast`/`luminance`). A bad argument surfaces a clear,
 * coded error Value rather than a silent wrong colour, matching the error
 * discipline the rest of the engine uses.
 *
 * The channel maths lives in the pure {@link ./ColourMath} module; these handlers
 * only marshal `Value`s in and out of it.
 */
import { Value, ValueType, colourValue, numberValue, errorValue, type ColourData } from "@solve-js/vm/Value";
import { allocatePluginFunctionIndex } from "@solve-js/vm/VMBuiltins";
import * as Colour from "./ColourMath";

/** Scoped error codes this package owns (see `errors/ErrorCode.ts` convention). */
export const ColourErrorCodes = {
	/** A string was not a hex colour or a known CSS colour name. */
	COLOUR_INVALID: "COLOUR_INVALID",
	/** A function expected a colour argument and got something else. */
	COLOUR_EXPECTED_COLOUR: "COLOUR_EXPECTED_COLOUR",
	/** A function was called with the wrong number or type of arguments. */
	COLOUR_BAD_ARGUMENTS: "COLOUR_BAD_ARGUMENTS",
} as const;

/** The colour payload of a Value, or null if it is not a colour. */
function colourOf(v: Value | undefined): ColourData | null {
	return v && v.type === ValueType.Colour ? (v.value as ColourData) : null;
}

/**
 * Read an amount argument as a fraction. A `Percentage` already stores its
 * fraction (0.2 for `20%`), a bare number greater than 1 is read as a percent
 * (`20` means 0.2), and a number in 0..1 is taken as the fraction itself. So
 * `20%`, `0.2` and `20` all mean the same adjustment.
 */
function readAmount(v: Value | undefined): number {
	if (!v) return 0;
	const n = v.toNumber();
	if (v.type === ValueType.Percentage) return n;
	return n > 1 ? n / 100 : n;
}

function badArgs(fn: string, expected: string): Value {
	return errorValue(ColourErrorCodes.COLOUR_BAD_ARGUMENTS, `${fn}(...) expects ${expected}`);
}

function notAColour(fn: string): Value {
	return errorValue(ColourErrorCodes.COLOUR_EXPECTED_COLOUR, `${fn}(...) expects a colour as its first argument`);
}

// ── Constructors ────────────────────────────────────────────────────────

export const COLOUR_PARSE_FN_IDX = allocatePluginFunctionIndex();
/** `color("#ff0000")` / `colour("red")`, and the backing handler for a `#hex` literal. */
export function colourParseHandler(args: Value[]): Value {
	const arg = args[0];
	if (!arg || arg.type !== ValueType.String || typeof arg.value !== "string") {
		return badArgs("color", "a string, e.g. color(\"#ff0000\") or color(\"red\")");
	}
	const parsed = Colour.parseColour(arg.value);
	if (!parsed) {
		return errorValue(
			ColourErrorCodes.COLOUR_INVALID,
			`"${arg.value}" is not a hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa) or a CSS colour name`,
		);
	}
	return colourValue(parsed);
}

export const COLOUR_RGB_FN_IDX = allocatePluginFunctionIndex();
export function rgbHandler(args: Value[]): Value {
	if (args.length !== 3) return badArgs("rgb", "three numbers: rgb(red, green, blue)");
	return colourValue({
		r: Colour.clamp255(args[0].toNumber()),
		g: Colour.clamp255(args[1].toNumber()),
		b: Colour.clamp255(args[2].toNumber()),
		a: 1,
		format: "rgb",
	});
}

export const COLOUR_RGBA_FN_IDX = allocatePluginFunctionIndex();
export function rgbaHandler(args: Value[]): Value {
	if (args.length !== 4) return badArgs("rgba", "four numbers: rgba(red, green, blue, alpha)");
	return colourValue({
		r: Colour.clamp255(args[0].toNumber()),
		g: Colour.clamp255(args[1].toNumber()),
		b: Colour.clamp255(args[2].toNumber()),
		a: Colour.clamp01(readAmount(args[3])),
		format: "rgba",
	});
}

export const COLOUR_HSL_FN_IDX = allocatePluginFunctionIndex();
export function hslHandler(args: Value[]): Value {
	if (args.length !== 3) return badArgs("hsl", "three values: hsl(hue, saturation%, lightness%)");
	const { r, g, b } = Colour.hslToRgb(args[0].toNumber(), readAmount(args[1]), readAmount(args[2]));
	return colourValue({ r, g, b, a: 1, format: "hsl" });
}

export const COLOUR_HSLA_FN_IDX = allocatePluginFunctionIndex();
export function hslaHandler(args: Value[]): Value {
	if (args.length !== 4) return badArgs("hsla", "four values: hsla(hue, saturation%, lightness%, alpha)");
	const { r, g, b } = Colour.hslToRgb(args[0].toNumber(), readAmount(args[1]), readAmount(args[2]));
	return colourValue({ r, g, b, a: Colour.clamp01(readAmount(args[3])), format: "hsla" });
}

// ── Adjusters ───────────────────────────────────────────────────────────

/** Build a one-colour, one-amount adjuster handler (lighten/darken/saturate/desaturate). */
function adjuster(name: string, op: (c: ColourData, amount: number) => ColourData): (args: Value[]) => Value {
	return (args: Value[]): Value => {
		const c = colourOf(args[0]);
		if (!c) return notAColour(name);
		if (args.length < 2) return badArgs(name, `a colour and an amount, e.g. ${name}(#3366cc, 20%)`);
		return colourValue(op(c, readAmount(args[1])));
	};
}

export const COLOUR_LIGHTEN_FN_IDX = allocatePluginFunctionIndex();
export const lightenHandler = adjuster("lighten", Colour.lighten);
export const COLOUR_DARKEN_FN_IDX = allocatePluginFunctionIndex();
export const darkenHandler = adjuster("darken", Colour.darken);
export const COLOUR_SATURATE_FN_IDX = allocatePluginFunctionIndex();
export const saturateHandler = adjuster("saturate", Colour.saturate);
export const COLOUR_DESATURATE_FN_IDX = allocatePluginFunctionIndex();
export const desaturateHandler = adjuster("desaturate", Colour.desaturate);

export const COLOUR_ROTATE_FN_IDX = allocatePluginFunctionIndex();
export function rotateHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("rotate");
	if (args.length < 2) return badArgs("rotate", "a colour and a hue angle in degrees, e.g. rotate(#ff0000, 90)");
	return colourValue(Colour.rotateHue(c, args[1].toNumber()));
}

export const COLOUR_COMPLEMENT_FN_IDX = allocatePluginFunctionIndex();
export function complementHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("complement");
	return colourValue(Colour.complement(c));
}

export const COLOUR_GRAYSCALE_FN_IDX = allocatePluginFunctionIndex();
export function grayscaleHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("grayscale");
	return colourValue(Colour.grayscale(c));
}

export const COLOUR_INVERT_FN_IDX = allocatePluginFunctionIndex();
export function invertHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("invert");
	return colourValue(Colour.invert(c, args.length > 1 ? readAmount(args[1]) : 1));
}

export const COLOUR_MIX_FN_IDX = allocatePluginFunctionIndex();
export function mixHandler(args: Value[]): Value {
	const a = colourOf(args[0]);
	const b = colourOf(args[1]);
	if (!a || !b) return errorValue(ColourErrorCodes.COLOUR_EXPECTED_COLOUR, "mix(...) expects two colours to blend");
	return colourValue(Colour.mix(a, b, args.length > 2 ? readAmount(args[2]) : 0.5));
}

export const COLOUR_ALPHA_FN_IDX = allocatePluginFunctionIndex();
export function alphaHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("alpha");
	if (args.length < 2) return badArgs("alpha", "a colour and an alpha 0..1, e.g. alpha(#ff0000, 0.5)");
	return colourValue(Colour.withAlpha(c, readAmount(args[1])));
}

// ── Measurements (return a Number) ──────────────────────────────────────

export const COLOUR_CONTRAST_FN_IDX = allocatePluginFunctionIndex();
export function contrastHandler(args: Value[]): Value {
	const a = colourOf(args[0]);
	const b = colourOf(args[1]);
	if (!a || !b) return errorValue(ColourErrorCodes.COLOUR_EXPECTED_COLOUR, "contrast(...) expects two colours");
	return numberValue(Colour.contrastRatio(a, b));
}

export const COLOUR_LUMINANCE_FN_IDX = allocatePluginFunctionIndex();
export function luminanceHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("luminance");
	return numberValue(Colour.relativeLuminance(c));
}

/**
 * The call-name grammar: every function name (and alias) a `COLOUR_CALL` token
 * can carry, mapped to the plugin index that runs it. Also the source of truth
 * for the normalizer (which names to fuse) and completions.
 */
export const COLOUR_FUNCTION_INDEX: Readonly<Record<string, number>> = {
	color: COLOUR_PARSE_FN_IDX,
	colour: COLOUR_PARSE_FN_IDX,
	rgb: COLOUR_RGB_FN_IDX,
	rgba: COLOUR_RGBA_FN_IDX,
	hsl: COLOUR_HSL_FN_IDX,
	hsla: COLOUR_HSLA_FN_IDX,
	lighten: COLOUR_LIGHTEN_FN_IDX,
	darken: COLOUR_DARKEN_FN_IDX,
	saturate: COLOUR_SATURATE_FN_IDX,
	desaturate: COLOUR_DESATURATE_FN_IDX,
	desat: COLOUR_DESATURATE_FN_IDX,
	rotate: COLOUR_ROTATE_FN_IDX,
	spin: COLOUR_ROTATE_FN_IDX,
	adjusthue: COLOUR_ROTATE_FN_IDX,
	complement: COLOUR_COMPLEMENT_FN_IDX,
	grayscale: COLOUR_GRAYSCALE_FN_IDX,
	greyscale: COLOUR_GRAYSCALE_FN_IDX,
	invert: COLOUR_INVERT_FN_IDX,
	mix: COLOUR_MIX_FN_IDX,
	alpha: COLOUR_ALPHA_FN_IDX,
	opacity: COLOUR_ALPHA_FN_IDX,
	fade: COLOUR_ALPHA_FN_IDX,
	contrast: COLOUR_CONTRAST_FN_IDX,
	luminance: COLOUR_LUMINANCE_FN_IDX,
};

/** Every `{ index, handler }` this package registers as `pluginFunctions`. */
export const COLOUR_PLUGIN_FUNCTIONS: ReadonlyArray<{ index: number; handler: (args: Value[]) => Value }> = [
	{ index: COLOUR_PARSE_FN_IDX, handler: colourParseHandler },
	{ index: COLOUR_RGB_FN_IDX, handler: rgbHandler },
	{ index: COLOUR_RGBA_FN_IDX, handler: rgbaHandler },
	{ index: COLOUR_HSL_FN_IDX, handler: hslHandler },
	{ index: COLOUR_HSLA_FN_IDX, handler: hslaHandler },
	{ index: COLOUR_LIGHTEN_FN_IDX, handler: lightenHandler },
	{ index: COLOUR_DARKEN_FN_IDX, handler: darkenHandler },
	{ index: COLOUR_SATURATE_FN_IDX, handler: saturateHandler },
	{ index: COLOUR_DESATURATE_FN_IDX, handler: desaturateHandler },
	{ index: COLOUR_ROTATE_FN_IDX, handler: rotateHandler },
	{ index: COLOUR_COMPLEMENT_FN_IDX, handler: complementHandler },
	{ index: COLOUR_GRAYSCALE_FN_IDX, handler: grayscaleHandler },
	{ index: COLOUR_INVERT_FN_IDX, handler: invertHandler },
	{ index: COLOUR_MIX_FN_IDX, handler: mixHandler },
	{ index: COLOUR_ALPHA_FN_IDX, handler: alphaHandler },
	{ index: COLOUR_CONTRAST_FN_IDX, handler: contrastHandler },
	{ index: COLOUR_LUMINANCE_FN_IDX, handler: luminanceHandler },
];
