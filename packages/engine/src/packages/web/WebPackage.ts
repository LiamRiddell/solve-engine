import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { errorValue, stringValue, uomValue, Value, ValueType } from "@solve-js/vm/Value";
import { aspectRatioOf, formatPixelSize, resizeToSide } from "./Dimensions";
import { atRootFontSize } from "./RootFontSize";
import { atPixelDensity, isUsableDensity } from "./PixelDensity";
import { DimensionsParselet, PixelDensityParselet, ResizeParselet, RootFontSizeParselet } from "./parselets/DimensionsParselets";
import { dimensionsNormalizerRule, resizeNormalizerRule } from "./normalizer/DimensionsNormalizerRule";
import { rootFontSizeNormalizerRule } from "./normalizer/RootFontSizeNormalizerRule";
import { pixelDensityNormalizerRule } from "./normalizer/PixelDensityNormalizerRule";

/** Error codes this package answers with. Each names something a person can correct. */
export const WebErrorCodes = {
	/** A width or a height was not a whole count of pixels. */
	WEB_EXPECTED_PIXELS: "WEB_EXPECTED_PIXELS",
	/** `at` and `dpi` with a word rather than a number of dots per inch between them, as in `4000px at x dpi`. */
	DENSITY_EXPECTED_NUMBER: "DENSITY_EXPECTED_NUMBER",
	/** A size measured against a root font size was in neither `px` nor `rem`. */
	WEB_EXPECTED_PX_OR_REM: "WEB_EXPECTED_PX_OR_REM",
	/** The stated root font size was not a size a `rem` can be measured against. */
	WEB_EXPECTED_ROOT_SIZE: "WEB_EXPECTED_ROOT_SIZE",
	/** A size measured against a density was neither a CSS length nor a physical length. */
	WEB_EXPECTED_PIXELS_OR_LENGTH: "WEB_EXPECTED_PIXELS_OR_LENGTH",
	/** The stated density was not a number of dots per inch above zero. */
	WEB_EXPECTED_DENSITY: "WEB_EXPECTED_DENSITY",
} as const;

/** `<width>x<height> as ratio` -> the shape in lowest whole-number terms. */
function aspectRatio(args: Value[]): Value {
	const width = args[0].toNumber();
	const height = args[1].toNumber();
	const ratio = aspectRatioOf(width, height);
	if (ratio === null) {
		return errorValue(
			WebErrorCodes.WEB_EXPECTED_PIXELS,
			`a screen or an image is a whole number of pixels each way, and "${width}x${height}" is not`,
		);
	}
	return stringValue(ratio);
}

/** `resize <width>x<height> to <size> wide|tall` -> the pair at that size, keeping its shape. */
function resizeDimensions(args: Value[]): Value {
	const width = args[0].toNumber();
	const height = args[1].toNumber();
	const target = args[2].toNumber();
	const side = args[3].value === "height" ? "height" : "width";
	const resized = resizeToSide(width, height, target, side);
	if (resized === null) {
		return errorValue(
			WebErrorCodes.WEB_EXPECTED_PIXELS,
			`a resize works in whole pixels, and "${width}x${height} to ${target}" is not`,
		);
	}
	return stringValue(formatPixelSize(resized));
}

/** `<size> at <n>px base` -> the same size in the other unit, against that root font size. */
function atRootFontSizeCall(args: Value[]): Value {
	const size = args[0];
	const base = args[1].toNumber();
	if (size.type !== ValueType.Uom || size.unit === undefined) {
		return errorValue(
			WebErrorCodes.WEB_EXPECTED_PX_OR_REM,
			'a root font size relates px and rem, as in "1.5rem at 20px base"',
		);
	}
	const converted = atRootFontSize(size.toNumber(), size.unit, base);
	if (converted === null) {
		if (!(base > 0)) {
			return errorValue(WebErrorCodes.WEB_EXPECTED_ROOT_SIZE, `a root font size has to be above zero, and ${base}px is not`);
		}
		return errorValue(
			WebErrorCodes.WEB_EXPECTED_PX_OR_REM,
			`a root font size relates px and rem, and "${size.unit}" is neither`,
		);
	}
	return uomValue(converted.amount, converted.unit);
}

/** `<size> at <n> dpi` -> pixels as a print size in inches, or a length as pixels. */
function atPixelDensityCall(args: Value[]): Value {
	const size = args[0];
	const density = args[1].toNumber();
	if (!isUsableDensity(density)) {
		return errorValue(WebErrorCodes.WEB_EXPECTED_DENSITY, `a density is a finite number of dots per inch above zero, and ${density} is not`);
	}
	if (size.type !== ValueType.Uom || size.unit === undefined) {
		return errorValue(
			WebErrorCodes.WEB_EXPECTED_PIXELS_OR_LENGTH,
			'a density relates pixels and a printed length, as in "4000px at 300 dpi" or "8 inches at 300 dpi"',
		);
	}
	const converted = atPixelDensity(size.toNumber(), size.unit, density);
	if (converted === null) {
		return errorValue(
			WebErrorCodes.WEB_EXPECTED_PIXELS_OR_LENGTH,
			`a density relates pixels and a printed length, and "${size.unit}" is neither`,
		);
	}
	if (!Number.isFinite(converted.amount)) {
		return errorValue(
			WebErrorCodes.WEB_EXPECTED_DENSITY,
			`at ${density} dpi the size is too large to be a number`,
		);
	}
	return uomValue(converted.amount, converted.unit);
}

/**
 * Web: the sums a front-end or an image needs, beside the ones the units
 * already do.
 *
 * `px in rem` is an ordinary unit conversion and already ships, treating one
 * `rem` as the CSS default of 16px. What was missing is everything that default
 * cannot answer: a page whose root font size is not 16px, the shape of a screen
 * or an image, the other side of a resize, and the print size of an image at a
 * stated density (`4000px at 300 dpi`), the one bridge between pixels and
 * physical length.
 *
 * The boundary: the two dimension forms are whole pixels in and whole pixels
 * out, because a screen and an image file are counted that way, and a resize
 * rounds rather than answering with a fraction of a pixel. `em`, which is
 * measured against an element's own font size rather than the root, is still
 * deliberately not converted: what an `em` is worth depends on where it sits.
 */
export const WEB_PACKAGE: IEnginePackage = {
	name: "solve-web",
	normalizerRules: [dimensionsNormalizerRule(), resizeNormalizerRule(), rootFontSizeNormalizerRule(), pixelDensityNormalizerRule()],
	prefixParselets: {
		DIMENSIONS: new DimensionsParselet(),
		RESIZE: new ResizeParselet(),
	},
	infixParselets: {
		ROOT_FONT_SIZE: new RootFontSizeParselet(),
		PIXEL_DENSITY: new PixelDensityParselet(),
	},
	pluginFunctions: {
		aspectRatio,
		atPixelDensity: atPixelDensityCall,
		atRootFontSize: atRootFontSizeCall,
		resizeDimensions,
	},
	tokenCategories: {
		DIMENSIONS: "number",
		RESIZE: "keyword",
		ROOT_FONT_SIZE: "keyword",
		PIXEL_DENSITY: "keyword",
	},
};
