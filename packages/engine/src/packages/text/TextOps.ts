/**
 * Text operations as pure functions: text in, text/number/boolean out, no
 * engine types and no side effects. The package layer (TextPluginFunctions.ts)
 * wraps each of these to read a String value and hand back a Value, so the
 * logic here is trivially unit-testable on its own.
 *
 * Every operation is Unicode-aware where it counts: character and reversal work
 * on code points (via the string iterator), so a character outside the Basic
 * Multilingual Plane, an emoji say, counts as one character and reverses as one
 * unit rather than being split into its two surrogate halves.
 */

/** The number of characters, counted as code points rather than UTF-16 units. */
export function textLength(text: string): number {
	return [...text].length;
}

/** Remove leading and trailing whitespace. */
export function textTrim(text: string): string {
	return text.trim();
}

/** The characters in reverse order, code point by code point. */
export function textReverse(text: string): string {
	return [...text].reverse().join("");
}

/** Whether `needle` appears anywhere in `text`. */
export function textContains(text: string, needle: string): boolean {
	return text.includes(needle);
}

/** Whether `text` begins with `prefix`. */
export function textStartsWith(text: string, prefix: string): boolean {
	return text.startsWith(prefix);
}

/** Whether `text` ends with `suffix`. */
export function textEndsWith(text: string, suffix: string): boolean {
	return text.endsWith(suffix);
}

/** Every literal occurrence of `find` in `text` replaced by `replacement`. */
export function textReplace(text: string, find: string, replacement: string): string {
	// A literal replace-all: split on the needle and rejoin, so no character in
	// `find` is treated as a regular-expression metacharacter. An empty needle
	// would match between every character; guard it so the input is returned
	// unchanged rather than the replacement being interleaved throughout.
	if (find === "") return text;
	return text.split(find).join(replacement);
}

/** `text` joined to itself `count` times (0 gives the empty string). */
export function textRepeat(text: string, count: number): string {
	const n = Math.trunc(count);
	if (n <= 0) return "";
	return text.repeat(n);
}

/** Upper case. */
export function textUpper(text: string): string {
	return text.toUpperCase();
}

/** Lower case. */
export function textLower(text: string): string {
	return text.toLowerCase();
}

/** Title case: the first letter of each whitespace-separated word capitalised. */
export function textTitle(text: string): string {
	return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * A slug: lower case, runs of anything that is not a letter or digit collapsed
 * to a single hyphen, and no leading or trailing hyphen. The shape a title
 * takes in a URL, so `"Hello, World!"` becomes `hello-world`.
 */
export function textSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** The number of whitespace-separated words. */
export function textWordCount(text: string): number {
	const trimmed = text.trim();
	if (trimmed === "") return 0;
	return trimmed.split(/\s+/).length;
}

/** The number of lines, splitting on any newline convention. */
export function textLineCount(text: string): number {
	if (text === "") return 0;
	return text.split(/\r\n|\r|\n/).length;
}
