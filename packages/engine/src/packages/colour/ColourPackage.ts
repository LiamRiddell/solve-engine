import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { CompletionItem } from "@solve-js/language";
import { Value, ValueType, colourValue, type ColourData, type ColourFormat } from "@solve-js/vm/Value";
import { HexColourParselet } from "./parselets/HexColourParselet";
import { ColourCallParselet } from "./parselets/ColourCallParselet";
import { colourCallNormalizerRule } from "./normalizer/ColourCallNormalizerRule";
import { COLOUR_PLUGIN_FUNCTIONS, COLOUR_FUNCTION_INDEX } from "./ColourPluginFunctions";

/**
 * Re-tag a colour's display format for `<colour> as rgb|rgba|hsl|hsla`. The
 * channels are unchanged, only how the value renders; a non-colour passes
 * through untouched (the same lenient shape the other `asConverters` use).
 * `as hex` is not here: `hex` is a built-in converter that lowers to
 * `OpCode.TO_HEX`, which the VM handles for colours directly.
 */
const retag = (format: ColourFormat) => (v: Value): Value => {
	if (v.type !== ValueType.Colour) return v;
	const c = v.value as ColourData;
	return colourValue({ r: c.r, g: c.g, b: c.b, a: c.a, format });
};

/** One completion candidate per distinct colour function name. */
const completionItems: CompletionItem[] = Object.keys(COLOUR_FUNCTION_INDEX).map((label) => ({
	label,
	category: "function",
	detail: "colour",
}));

/**
 * Colours as first-class values: `#ff0000` hex literals, `rgb()`/`hsl()` and CSS
 * named colours via `color("...")`, and the DevTools-style adjusters (`lighten`,
 * `darken`, `rotate`, `mix`, `contrast`, ...). A colour result carries its
 * channels and a render-ready CSS string across the worker boundary so a host
 * can draw a swatch. See `ColourMath.ts` for the maths.
 *
 * The `#hex` literal is recognised by the core lexer (it has to disambiguate `#`
 * from a markdown heading/comment); this package supplies the parselet that turns
 * the resulting `HEX_COLOUR` token into a colour. Function names are fused only
 * when immediately called, so `mix`/`rotate`/`alpha` stay usable as variables.
 */
export const COLOUR_PACKAGE: IEnginePackage = {
	name: "solve-colour",
	prefixParselets: [
		{ tokenType: "HEX_COLOUR", parselet: new HexColourParselet() },
		{ tokenType: "COLOUR_CALL", parselet: new ColourCallParselet() },
	],
	normalizerRules: [colourCallNormalizerRule()],
	pluginFunctions: COLOUR_PLUGIN_FUNCTIONS.map((f) => ({ index: f.index, handler: f.handler })),
	asConverters: {
		rgb: retag("rgb"),
		rgba: retag("rgba"),
		hsl: retag("hsl"),
		hsla: retag("hsla"),
	},
	// HEX_COLOUR/COLOUR_CALL categories live in the core TokenCategoryMap (both
	// are declared TokenTypes), so no per-package tokenCategories are needed.
	completionItems,
};
