import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { stringValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { TEXT_PLUGIN_FUNCTIONS } from "./TextPluginFunctions";
import { textUpper, textLower, textTitle, textSlug } from "./TextOps";
import { unaryTextParselet, booleanTextInfixParselet, repeatTextParselet } from "./parselets/TextParselets";
import { TextCallParselet } from "./parselets/TextCallParselet";
import { textCallNormalizerRule } from "./normalizer/TextCallNormalizerRule";

/** An `as`-converter over text: text in, reshaped text out, an error for a non-string. */
function textConverter(name: string, fn: (t: string) => string): (value: Value) => Value {
	return (value: Value): Value => {
		if (value.type !== ValueType.String) {
			return errorValue("TEXT_EXPECTED", `"as ${name}" expects text (a "quoted string")`);
		}
		return stringValue(fn(value.value as string));
	};
}

/**
 * Text operations on String values (issues #236, #237). Measure text (`length
 * of`, `words in`, `characters in`, `lines in`), test it (`contains`, `starts
 * with`, `ends with`), and reshape it (`trim`, `reverse`, `X repeated N times`,
 * `as upper`/`lower`/`title`/`slug`, and the `replace(text, find, with)`
 * function). Every form also has a call spelling (`length("hi")`), and joining
 * text with text is plain `+`.
 *
 * On by default and removable, like the other utility packages. A non-text
 * input to any operation is answered with a structured Error that names what it
 * wanted, never a wrong value.
 *
 * Two grammar boundaries worth stating, both because a word is already spoken
 * for elsewhere in the language: `replace` is a function rather than the natural
 * "replace A with B in C", because "with" is the word form of "+" (`40 with 2`
 * is 42); and "times" in `X repeated N times` is optional, because it is the
 * word form of "*" (`8 times 9` is 72) and is recognised here only as a trailing
 * flourish on the count.
 */
export const TEXT_PACKAGE: IEnginePackage = {
	name: "solve-text",
	phrases: {
		"length of": "LENGTH_OF",
		"words in": "WORDS_IN",
		"characters in": "CHARACTERS_IN",
		"lines in": "LINES_IN",
		"starts with": "STARTS_WITH",
		"ends with": "ENDS_WITH",
	},
	lexerVocabulary: {
		keywords: {
			trim: "TRIM",
			reverse: "REVERSE",
			contains: "CONTAINS",
			repeated: "REPEATED",
		},
	},
	prefixParselets: {
		LENGTH_OF: unaryTextParselet("textLength", BindingPower.Lowest),
		WORDS_IN: unaryTextParselet("textWordCount", BindingPower.Lowest),
		CHARACTERS_IN: unaryTextParselet("textCharCount", BindingPower.Lowest),
		LINES_IN: unaryTextParselet("textLineCount", BindingPower.Lowest),
		TRIM: unaryTextParselet("textTrim", BindingPower.Prefix),
		REVERSE: unaryTextParselet("textReverse", BindingPower.Prefix),
		TEXT_CALL: new TextCallParselet(),
	},
	infixParselets: {
		CONTAINS: booleanTextInfixParselet("textContains"),
		STARTS_WITH: booleanTextInfixParselet("textStartsWith"),
		ENDS_WITH: booleanTextInfixParselet("textEndsWith"),
		REPEATED: repeatTextParselet,
	},
	asConverters: {
		upper: textConverter("upper", textUpper),
		lower: textConverter("lower", textLower),
		title: textConverter("title", textTitle),
		slug: textConverter("slug", textSlug),
	},
	normalizerRules: [textCallNormalizerRule()],
	pluginFunctions: TEXT_PLUGIN_FUNCTIONS,
	tokenCategories: {
		LENGTH_OF: "function",
		WORDS_IN: "function",
		CHARACTERS_IN: "function",
		LINES_IN: "function",
		TRIM: "function",
		REVERSE: "function",
		TEXT_CALL: "function",
		CONTAINS: "operator",
		STARTS_WITH: "operator",
		ENDS_WITH: "operator",
		REPEATED: "operator",
	},
};
