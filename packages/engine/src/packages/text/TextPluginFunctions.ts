/**
 * The engine-facing layer over TextOps.ts: each handler reads its String
 * argument, applies a pure operation, and returns a Value. A non-text argument
 * is answered with a structured Error that names the operation and what it
 * wanted, never a wrong number or a throw, the same discipline the encoding
 * package follows.
 */
import { stringValue, numberValue, boolValue, errorValue, ValueType, type Value } from "@solve-js/vm/Value";
import { checkAllocation } from "@solve-js/vm/AllocationBudget";
import {
	textLength, textTrim, textReverse,
	textContains, textStartsWith, textEndsWith,
	textReplace, textRepeat,
	textUpper, textLower, textTitle, textSlug,
	textWordCount, textLineCount,
} from "./TextOps";

/** The text of a String value, or null when the value is not text. */
function asText(value: Value | undefined): string | null {
	return value?.type === ValueType.String ? (value.value as string) : null;
}

/** A clear "this wanted text" error for an operation given a non-string. */
function expectedText(operation: string): Value {
	return errorValue("TEXT_EXPECTED", `${operation} expects text (a "quoted string")`);
}

/** One-argument text → number (length, counts). */
function textToNumber(operation: string, fn: (t: string) => number): (args: Value[]) => Value {
	return (args) => {
		const text = asText(args[0]);
		if (text === null) return expectedText(operation);
		return numberValue(fn(text));
	};
}

/** One-argument text → text (trim, reverse, case, slug). */
function textToText(operation: string, fn: (t: string) => string): (args: Value[]) => Value {
	return (args) => {
		const text = asText(args[0]);
		if (text === null) return expectedText(operation);
		return stringValue(fn(text));
	};
}

/**
 * How many times `find` occurs in `text`, counted without allocating: the
 * size of a replacement has to be known before the replacement is built.
 */
function occurrences(text: string, find: string): number {
	if (find === "") return 0;
	let count = 0;
	let at = text.indexOf(find);
	while (at !== -1) {
		count++;
		at = text.indexOf(find + "", at + find.length);
	}
	return count;
}

/** Two-argument text × text → boolean (contains, starts with, ends with). */
function textPairToBool(operation: string, fn: (t: string, other: string) => boolean): (args: Value[]) => Value {
	return (args) => {
		const text = asText(args[0]);
		const other = asText(args[1]);
		if (text === null || other === null) return expectedText(operation);
		return boolValue(fn(text, other));
	};
}

/**
 * The text package's plugin functions, keyed by the names the parselets and the
 * function-call forms emit. The `text` prefix keeps them clear of any other
 * package's names in the shared plugin-function registry.
 */
export const TEXT_PLUGIN_FUNCTIONS: Record<string, (args: Value[]) => Value> = {
	textLength: textToNumber("length", textLength),
	textWordCount: textToNumber("words in", textWordCount),
	textCharCount: textToNumber("characters in", textLength),
	textLineCount: textToNumber("lines in", textLineCount),

	textTrim: textToText("trim", textTrim),
	textReverse: textToText("reverse", textReverse),
	textUpper: textToText('"as upper"', textUpper),
	textLower: textToText('"as lower"', textLower),
	textTitle: textToText('"as title"', textTitle),
	textSlug: textToText('"as slug"', textSlug),

	textContains: textPairToBool("contains", textContains),
	textStartsWith: textPairToBool("starts with", textStartsWith),
	textEndsWith: textPairToBool("ends with", textEndsWith),

	// `replace(text, find, replacement)`: literal replace-all. Function form
	// because the natural phrasing "replace A with B in C" cannot be offered,
	// "with" is already the word form of "+", see the docs.
	textReplace: (args: Value[]): Value => {
		const text = asText(args[0]);
		const find = asText(args[1]);
		const replacement = asText(args[2]);
		if (text === null || find === null || replacement === null) return expectedText("replace");
		// The two text operations that can make a string LONGER than any of
		// their inputs are charged against the evaluation's allocation budget
		// before they build it, the same way a matrix product is refused from
		// its shape. The VM's other limits are checked between opcodes, so a
		// single call that allocates hundreds of megabytes is invisible to them.
		// Characters are the element here: they are what the input caused to
		// exist, and the count is in hand before anything is allocated.
		const grownBy = occurrences(text, find) * (replacement.length - find.length);
		checkAllocation(Math.max(0, text.length + grownBy), "characters");
		return stringValue(textReplace(text, find, replacement));
	},

	// `repeat(text, count)` and the phrase `text repeated N times`.
	textRepeat: (args: Value[]): Value => {
		const text = asText(args[0]);
		if (text === null) return expectedText("repeat");
		const count = args[1];
		if (count?.type !== ValueType.Number) return errorValue("TEXT_EXPECTED", "repeat expects a count (a number)");
		// See textReplace above. `x repeated 400000000 times` used to allocate
		// eight hundred megabytes inside one opcode.
		const times = Math.max(0, Math.trunc(count.value as number));
		checkAllocation(text.length * times, "characters");
		return stringValue(textRepeat(text, count.value as number));
	},
};
