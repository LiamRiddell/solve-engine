import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { stringValue, numberValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import { numberToRoman, romanToNumber, numberToOrdinal, numberToWords } from "./NumeralOps";
import { FromRomanParselet } from "./parselets/FromRomanParselet";

/** A converter over a number: number in, string out, an error for a value it cannot represent. */
function numeralConverter(name: string, fn: (n: number) => string | null): (value: Value) => Value {
	return (value: Value): Value => {
		if (value.type !== ValueType.Number) {
			return errorValue("NUMERAL_EXPECTED_NUMBER", `"as ${name}" expects a number`);
		}
		const out = fn(value.value as number);
		if (out === null) {
			return errorValue("NUMERAL_OUT_OF_RANGE", `${value.value} cannot be written as ${name}`);
		}
		return stringValue(out);
	};
}

/**
 * Numeral spellings (issues #248, #249): a number in words, as an ordinal, or in
 * Roman numerals, and Roman numerals back to a number.
 *
 * `as words`, `as ordinal` and `as roman` extend the general `as`-converter set;
 * `"MMXXIV" from roman` is the reverse. The reverse takes a quoted string rather
 * than a bare `MMXXIV` literal on purpose: the Roman digits `M C D L X V I` are
 * already units and variable names (`V` the volt, `C` Celsius), so a bare literal
 * would be ambiguous. On by default and removable.
 *
 * Roman numerals cover the classic 1 to 3999; a value outside that, or a
 * malformed Roman string, is answered with a structured Error. Words use British
 * spelling and the "and" of "one hundred and five".
 */
export const NUMERALS_PACKAGE: IEnginePackage = {
	name: "solve-numerals",
	phrases: {
		"from roman": "FROM_ROMAN",
	},
	asConverters: {
		roman: numeralConverter("roman", numberToRoman),
		ordinal: numeralConverter("ordinal", numberToOrdinal),
		words: numeralConverter("words", numberToWords),
	},
	infixParselets: {
		FROM_ROMAN: new FromRomanParselet(),
	},
	pluginFunctions: {
		romanFromString: (args: Value[]): Value => {
			const arg = args[0];
			if (arg?.type !== ValueType.String) {
				return errorValue("NUMERAL_EXPECTED_TEXT", `"from roman" expects text, e.g. "MMXXIV" from roman`);
			}
			const n = romanToNumber(arg.value as string);
			if (n === null) {
				return errorValue("NUMERAL_INVALID_ROMAN", `"${arg.value}" is not a valid Roman numeral`);
			}
			return numberValue(n);
		},
	},
	tokenCategories: {
		FROM_ROMAN: "operator",
	},
};
