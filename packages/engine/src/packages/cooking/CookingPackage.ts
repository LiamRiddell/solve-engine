import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { canConvert, convertUnit } from "@solve-js/uom/UomConverter";
import { errorValue, numberValue, stringValue, uomValue, Value, ValueType } from "@solve-js/vm/Value";
import { celsiusForGasMark, gasMarkForCelsius, gasMarkRange } from "./GasMark";
import { gasMarkNormalizerRule } from "./normalizer/GasMarkNormalizerRule";
import { scaleServingsNormalizerRule } from "./normalizer/ScaleServingsNormalizerRule";
import { GasMarkParselet } from "./parselets/GasMarkParselet";
import { ScaleServingsParselet } from "./parselets/ScaleServingsParselet";

/** Error codes this package answers with. Each is a fault a cook can act on. */
export const CookingErrorCodes = {
	/** `as gas mark` was given something that is not an oven temperature. */
	GAS_MARK_EXPECTED_TEMPERATURE: "GAS_MARK_EXPECTED_TEMPERATURE",
	/** An oven temperature that no gas mark stands for, hotter or colder than the dial goes. */
	GAS_MARK_OFF_THE_DIAL: "GAS_MARK_OFF_THE_DIAL",
	/** A dial setting the table does not have, such as `gas mark 12`. */
	GAS_MARK_UNKNOWN: "GAS_MARK_UNKNOWN",
	/** A serving count that cannot scale a recipe, such as zero. */
	SERVINGS_NOT_POSITIVE: "SERVINGS_NOT_POSITIVE",
} as const;

/**
 * `<oven temperature> in gas mark` -> the dial setting, as text.
 *
 * Text rather than a number, because "gas 4" is what the dial says and what a
 * recipe writes; a bare `4` beside a temperature reads as a quantity and
 * invites arithmetic that means nothing. The fractional settings make the
 * point: the answer for 110°C is `gas 1/4`, which is not the number 0.25.
 */
function toGasMark(value: Value): Value {
	if (value.type !== ValueType.Uom || value.unit === undefined) {
		return errorValue(
			CookingErrorCodes.GAS_MARK_EXPECTED_TEMPERATURE,
			'"in gas mark" expects an oven temperature, as in "180C in gas mark"',
		);
	}
	if (!canConvert(value.unit, "C")) {
		return errorValue(
			CookingErrorCodes.GAS_MARK_EXPECTED_TEMPERATURE,
			`${value.unit} is not a temperature, so it names no gas mark`,
		);
	}
	const celsius = value.unit === "C" ? value.toNumber() : convertUnit(value.toNumber(), value.unit, "C");
	const row = gasMarkForCelsius(celsius);
	if (row === null) {
		const { coldest, hottest } = gasMarkRange();
		return errorValue(
			CookingErrorCodes.GAS_MARK_OFF_THE_DIAL,
			`${Math.round(celsius)}C is not a gas setting: the dial runs from gas ${coldest.written} (${coldest.celsius}C) to gas ${hottest.written} (${hottest.celsius}C)`,
		);
	}
	return stringValue(`gas ${row.written}`);
}

/** `gas mark <n>` -> the oven temperature that setting means, in degrees Celsius. */
function gasMarkToCelsius(args: Value[]): Value {
	const mark = args[0].toNumber();
	const celsius = celsiusForGasMark(mark);
	if (celsius === null) {
		const { coldest, hottest } = gasMarkRange();
		return errorValue(
			CookingErrorCodes.GAS_MARK_UNKNOWN,
			`there is no gas mark ${mark}: the dial runs from ${coldest.written} to ${hottest.written}`,
		);
	}
	return uomValue(celsius, "C");
}

/**
 * `scale <from> servings to <to>` -> the factor to multiply every quantity by.
 *
 * A factor, not a rewritten recipe. Cooking for six from a recipe that serves
 * four means multiplying each ingredient by 1.5, and that number is the thing
 * a cook actually needs: it multiplies the line above it, or any quantity they
 * write beside it. Parsing a whole recipe is a different job, and this
 * deliberately does not attempt it.
 */
function scalingFactor(args: Value[]): Value {
	const from = args[0].toNumber();
	const to = args[1].toNumber();
	if (!(from > 0) || !(to > 0)) {
		return errorValue(
			CookingErrorCodes.SERVINGS_NOT_POSITIVE,
			`a recipe serves a positive number of people, so ${from} to ${to} names no scaling`,
		);
	}
	return numberValue(to / from);
}

/**
 * Cooking: the gas-mark scale, and scaling a recipe by its servings.
 *
 * Two things a recipe asks for that are not unit conversions. A gas mark is a
 * dial setting standing for an oven temperature, published as a table with
 * uneven steps, so it is a lookup rather than a formula. Scaling by servings is
 * a factor derived from two counts, which the cook then applies to whatever
 * they are measuring.
 *
 * What is deliberately not here: converting ingredients between cups and grams,
 * which the units package already does through its ingredient densities
 * (`2 cups flour in grams`), and Fahrenheit to Celsius, which is an ordinary
 * unit conversion. This package is only what those two cannot express.
 */
export const COOKING_PACKAGE: IEnginePackage = {
	name: "solve-cooking",
	phrases: {
		// One token, so `180C in gas mark` resolves the converter by name. A
		// number after it makes it a dial setting instead; see the rule below.
		"gas mark": "CONVERTER_NAME",
	},
	normalizerRules: [gasMarkNormalizerRule(), scaleServingsNormalizerRule()],
	prefixParselets: {
		GAS_MARK: new GasMarkParselet(),
		SCALE_SERVINGS: new ScaleServingsParselet(),
	},
	pluginFunctions: {
		gasMarkToCelsius,
		recipeScalingFactor: scalingFactor,
	},
	asConverters: {
		"gas mark": toGasMark,
	},
	tokenCategories: {
		GAS_MARK: "keyword",
		SCALE_SERVINGS: "keyword",
	},
};
