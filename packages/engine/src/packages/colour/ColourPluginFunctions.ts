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
 * only marshal `Value`s in and out of it. Only the plugin-function table, the
 * name-to-index map and the hex-literal index are exported (the rest is internal
 * wiring): the parselets and normalizer reach for those three alone.
 */
import { Value, ValueType, colourValue, numberValue, boolValue, stringValue, errorValue, type ColourData } from "@solve-js/vm/Value";
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

/** Plugin index for `color(...)`, shared by the `#hex` literal parselet. */
export const COLOUR_PARSE_FN_IDX = allocatePluginFunctionIndex();
/** `color("#ff0000")` / `colour("red")`, and the backing handler for a `#hex` literal. */
function colourParseHandler(args: Value[]): Value {
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

const COLOUR_RGB_FN_IDX = allocatePluginFunctionIndex();
function rgbHandler(args: Value[]): Value {
	if (args.length !== 3) return badArgs("rgb", "three numbers: rgb(red, green, blue)");
	return colourValue({
		r: Colour.clamp255(args[0].toNumber()),
		g: Colour.clamp255(args[1].toNumber()),
		b: Colour.clamp255(args[2].toNumber()),
		a: 1,
		format: "rgb",
	});
}

const COLOUR_RGBA_FN_IDX = allocatePluginFunctionIndex();
function rgbaHandler(args: Value[]): Value {
	if (args.length !== 4) return badArgs("rgba", "four numbers: rgba(red, green, blue, alpha)");
	return colourValue({
		r: Colour.clamp255(args[0].toNumber()),
		g: Colour.clamp255(args[1].toNumber()),
		b: Colour.clamp255(args[2].toNumber()),
		a: Colour.clamp01(readAmount(args[3])),
		format: "rgba",
	});
}

const COLOUR_HSL_FN_IDX = allocatePluginFunctionIndex();
function hslHandler(args: Value[]): Value {
	if (args.length !== 3) return badArgs("hsl", "three values: hsl(hue, saturation%, lightness%)");
	const { r, g, b } = Colour.hslToRgb(args[0].toNumber(), readAmount(args[1]), readAmount(args[2]));
	return colourValue({ r, g, b, a: 1, format: "hsl" });
}

const COLOUR_HSLA_FN_IDX = allocatePluginFunctionIndex();
function hslaHandler(args: Value[]): Value {
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

const COLOUR_LIGHTEN_FN_IDX = allocatePluginFunctionIndex();
const lightenHandler = adjuster("lighten", Colour.lighten);
const COLOUR_DARKEN_FN_IDX = allocatePluginFunctionIndex();
const darkenHandler = adjuster("darken", Colour.darken);
const COLOUR_SATURATE_FN_IDX = allocatePluginFunctionIndex();
const saturateHandler = adjuster("saturate", Colour.saturate);
const COLOUR_DESATURATE_FN_IDX = allocatePluginFunctionIndex();
const desaturateHandler = adjuster("desaturate", Colour.desaturate);

const COLOUR_ROTATE_FN_IDX = allocatePluginFunctionIndex();
function rotateHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("rotate");
	if (args.length < 2) return badArgs("rotate", "a colour and a hue angle in degrees, e.g. rotate(#ff0000, 90)");
	return colourValue(Colour.rotateHue(c, args[1].toNumber()));
}

const COLOUR_COMPLEMENT_FN_IDX = allocatePluginFunctionIndex();
function complementHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("complement");
	return colourValue(Colour.complement(c));
}

const COLOUR_GRAYSCALE_FN_IDX = allocatePluginFunctionIndex();
function grayscaleHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("grayscale");
	return colourValue(Colour.grayscale(c));
}

const COLOUR_INVERT_FN_IDX = allocatePluginFunctionIndex();
function invertHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("invert");
	return colourValue(Colour.invert(c, args.length > 1 ? readAmount(args[1]) : 1));
}

const COLOUR_MIX_FN_IDX = allocatePluginFunctionIndex();
function mixHandler(args: Value[]): Value {
	const a = colourOf(args[0]);
	const b = colourOf(args[1]);
	if (!a || !b) return errorValue(ColourErrorCodes.COLOUR_EXPECTED_COLOUR, "mix(...) expects two colours to blend");
	return colourValue(Colour.mix(a, b, args.length > 2 ? readAmount(args[2]) : 0.5));
}

const COLOUR_ALPHA_FN_IDX = allocatePluginFunctionIndex();
function alphaHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("alpha");
	// One argument reads the alpha, two set it: `alpha(c)` is 0..1, `alpha(c, 0.5)`
	// returns the colour at that alpha.
	if (args.length < 2) return numberValue(c.a);
	return colourValue(Colour.withAlpha(c, readAmount(args[1])));
}

// ── Measurements (return a Number) ──────────────────────────────────────

const COLOUR_CONTRAST_FN_IDX = allocatePluginFunctionIndex();
function contrastHandler(args: Value[]): Value {
	const a = colourOf(args[0]);
	const b = colourOf(args[1]);
	if (!a || !b) return errorValue(ColourErrorCodes.COLOUR_EXPECTED_COLOUR, "contrast(...) expects two colours");
	return numberValue(Colour.contrastRatio(a, b));
}

const COLOUR_LUMINANCE_FN_IDX = allocatePluginFunctionIndex();
function luminanceHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("luminance");
	return numberValue(Colour.relativeLuminance(c));
}

// ── Channel extractors (return a Number) ────────────────────────────────

/** Build a one-colour extractor that returns a channel as a Number. */
function extractor(name: string, get: (c: ColourData) => number): (args: Value[]) => Value {
	return (args: Value[]): Value => {
		const c = colourOf(args[0]);
		if (!c) return notAColour(name);
		return numberValue(get(c));
	};
}

const COLOUR_RED_FN_IDX = allocatePluginFunctionIndex();
const redHandler = extractor("red", (c) => c.r);
const COLOUR_GREEN_FN_IDX = allocatePluginFunctionIndex();
const greenHandler = extractor("green", (c) => c.g);
const COLOUR_BLUE_FN_IDX = allocatePluginFunctionIndex();
const blueHandler = extractor("blue", (c) => c.b);
const COLOUR_HUE_FN_IDX = allocatePluginFunctionIndex();
const hueHandler = extractor("hue", (c) => Colour.rgbToHsl(c.r, c.g, c.b).h);
const COLOUR_SATURATION_FN_IDX = allocatePluginFunctionIndex();
const saturationHandler = extractor("saturation", (c) => Colour.rgbToHsl(c.r, c.g, c.b).s * 100);
const COLOUR_LIGHTNESS_FN_IDX = allocatePluginFunctionIndex();
const lightnessHandler = extractor("lightness", (c) => Colour.rgbToHsl(c.r, c.g, c.b).l * 100);

// ── Extra colour-space constructors ─────────────────────────────────────

const COLOUR_HSV_FN_IDX = allocatePluginFunctionIndex();
function hsvHandler(args: Value[]): Value {
	if (args.length !== 3) return badArgs("hsv", "three values: hsv(hue, saturation%, value%)");
	const { r, g, b } = Colour.hsvToRgb(args[0].toNumber(), readAmount(args[1]), readAmount(args[2]));
	return colourValue({ r, g, b, a: 1, format: "hex" });
}

const COLOUR_HSVA_FN_IDX = allocatePluginFunctionIndex();
function hsvaHandler(args: Value[]): Value {
	if (args.length !== 4) return badArgs("hsva", "four values: hsva(hue, saturation%, value%, alpha)");
	const { r, g, b } = Colour.hsvToRgb(args[0].toNumber(), readAmount(args[1]), readAmount(args[2]));
	return colourValue({ r, g, b, a: Colour.clamp01(readAmount(args[3])), format: "hex" });
}

const COLOUR_HWB_FN_IDX = allocatePluginFunctionIndex();
function hwbHandler(args: Value[]): Value {
	if (args.length !== 3) return badArgs("hwb", "three values: hwb(hue, whiteness%, blackness%)");
	const { r, g, b } = Colour.hwbToRgb(args[0].toNumber(), readAmount(args[1]), readAmount(args[2]));
	return colourValue({ r, g, b, a: 1, format: "hex" });
}

// ── Tint / shade / tone (mix toward white / black / grey) ────────────────

const COLOUR_TINT_FN_IDX = allocatePluginFunctionIndex();
const tintHandler = adjuster("tint", Colour.tint);
const COLOUR_SHADE_FN_IDX = allocatePluginFunctionIndex();
const shadeHandler = adjuster("shade", Colour.shade);
const COLOUR_TONE_FN_IDX = allocatePluginFunctionIndex();
const toneHandler = adjuster("tone", Colour.tone);

// ── Accessibility helpers ───────────────────────────────────────────────

const COLOUR_ISDARK_FN_IDX = allocatePluginFunctionIndex();
function isdarkHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("isdark");
	return boolValue(Colour.isDark(c));
}

const COLOUR_ISLIGHT_FN_IDX = allocatePluginFunctionIndex();
function islightHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("islight");
	return boolValue(!Colour.isDark(c));
}

const COLOUR_READABLE_FN_IDX = allocatePluginFunctionIndex();
function readableHandler(args: Value[]): Value {
	const c = colourOf(args[0]);
	if (!c) return notAColour("readable");
	return colourValue(Colour.readableColour(c));
}

/**
 * The minimum contrast ratio to test against. A number is used as the ratio
 * directly; a level name maps to the WCAG threshold (`AA` = 4.5, `AAA` = 7,
 * `AA large` = 3, `AAA large` = 4.5); anything else, or absent, defaults to AA.
 */
function readWcagThreshold(v: Value | undefined): number {
	if (!v) return Colour.WCAG_THRESHOLDS.aa;
	if (v.type === ValueType.Number) return v.toNumber();
	if (v.type === ValueType.String) {
		const key = (v.value as string).trim().toLowerCase();
		if (key === "aaa") return Colour.WCAG_THRESHOLDS.aaa;
		if (key === "aa large" || key === "aa-large" || key === "large") return Colour.WCAG_THRESHOLDS.aaLarge;
		if (key === "aaa large" || key === "aaa-large") return Colour.WCAG_THRESHOLDS.aaaLarge;
	}
	return Colour.WCAG_THRESHOLDS.aa;
}

const COLOUR_CONTRAST_COMPLIANT_FN_IDX = allocatePluginFunctionIndex();
function contrastCompliantHandler(args: Value[]): Value {
	const a = colourOf(args[0]);
	const b = colourOf(args[1]);
	if (!a || !b) {
		return errorValue(ColourErrorCodes.COLOUR_EXPECTED_COLOUR, "iscontrastcompliant(...) expects two colours");
	}
	return boolValue(Colour.contrastRatio(a, b) >= readWcagThreshold(args[2]));
}

const COLOUR_WCAG_LEVEL_FN_IDX = allocatePluginFunctionIndex();
function wcagLevelHandler(args: Value[]): Value {
	const a = colourOf(args[0]);
	const b = colourOf(args[1]);
	if (!a || !b) return errorValue(ColourErrorCodes.COLOUR_EXPECTED_COLOUR, "wcaglevel(...) expects two colours");
	return stringValue(Colour.wcagLevel(a, b));
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
	red: COLOUR_RED_FN_IDX,
	green: COLOUR_GREEN_FN_IDX,
	blue: COLOUR_BLUE_FN_IDX,
	hue: COLOUR_HUE_FN_IDX,
	saturation: COLOUR_SATURATION_FN_IDX,
	lightness: COLOUR_LIGHTNESS_FN_IDX,
	hsv: COLOUR_HSV_FN_IDX,
	hsb: COLOUR_HSV_FN_IDX,
	hsva: COLOUR_HSVA_FN_IDX,
	hwb: COLOUR_HWB_FN_IDX,
	tint: COLOUR_TINT_FN_IDX,
	shade: COLOUR_SHADE_FN_IDX,
	tone: COLOUR_TONE_FN_IDX,
	negate: COLOUR_INVERT_FN_IDX,
	isdark: COLOUR_ISDARK_FN_IDX,
	islight: COLOUR_ISLIGHT_FN_IDX,
	readable: COLOUR_READABLE_FN_IDX,
	contrastcolor: COLOUR_READABLE_FN_IDX,
	contrastcolour: COLOUR_READABLE_FN_IDX,
	iscontrastcompliant: COLOUR_CONTRAST_COMPLIANT_FN_IDX,
	wcaglevel: COLOUR_WCAG_LEVEL_FN_IDX,
	wcag: COLOUR_WCAG_LEVEL_FN_IDX,
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
	{ index: COLOUR_RED_FN_IDX, handler: redHandler },
	{ index: COLOUR_GREEN_FN_IDX, handler: greenHandler },
	{ index: COLOUR_BLUE_FN_IDX, handler: blueHandler },
	{ index: COLOUR_HUE_FN_IDX, handler: hueHandler },
	{ index: COLOUR_SATURATION_FN_IDX, handler: saturationHandler },
	{ index: COLOUR_LIGHTNESS_FN_IDX, handler: lightnessHandler },
	{ index: COLOUR_HSV_FN_IDX, handler: hsvHandler },
	{ index: COLOUR_HSVA_FN_IDX, handler: hsvaHandler },
	{ index: COLOUR_HWB_FN_IDX, handler: hwbHandler },
	{ index: COLOUR_TINT_FN_IDX, handler: tintHandler },
	{ index: COLOUR_SHADE_FN_IDX, handler: shadeHandler },
	{ index: COLOUR_TONE_FN_IDX, handler: toneHandler },
	{ index: COLOUR_ISDARK_FN_IDX, handler: isdarkHandler },
	{ index: COLOUR_ISLIGHT_FN_IDX, handler: islightHandler },
	{ index: COLOUR_READABLE_FN_IDX, handler: readableHandler },
	{ index: COLOUR_CONTRAST_COMPLIANT_FN_IDX, handler: contrastCompliantHandler },
	{ index: COLOUR_WCAG_LEVEL_FN_IDX, handler: wcagLevelHandler },
];
