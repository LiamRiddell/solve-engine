/**
 * Text operations as pure functions: text in, text/number/boolean out, no
 * engine types and no side effects. The package layer (TextPluginFunctions.ts)
 * wraps each of these to read a String value and hand back a Value, so the
 * logic here is trivially unit-testable on its own.
 *
 * Every operation is Unicode-aware where it counts: character counting and
 * reversal work on grapheme clusters, the characters a reader sees. A thumbs-up
 * with a skin tone, a flag, or a letter with a combining accent is one
 * character, where counting code points made the skin-toned thumbs-up two and
 * reversing it split the tone off onto its own.
 */

/**
 * The part of `Intl.Segmenter` this module uses. The engine compiles against
 * the ES2020 library, which predates the segmenter's types, so the shape is
 * declared here rather than widening the library for one call.
 */
interface GraphemeSegmenter {
	segment(text: string): Iterable<{ segment: string }>;
}

/** How a runtime's `Intl.Segmenter` is constructed, for the one granularity used here. */
type GraphemeSegmenterConstructor = new (locale: string | undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter;

/** The shared segmenter: undefined until first asked for, null in a runtime that has none. */
let sharedSegmenter: GraphemeSegmenter | null | undefined;

/**
 * The runtime's grapheme segmenter, built on first use rather than at import,
 * so loading the text package stays free of side effects. Null where
 * `Intl.Segmenter` does not exist, and the callers fall back to code points.
 */
function graphemeSegmenter(): GraphemeSegmenter | null {
	if (sharedSegmenter === undefined) {
		const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;
		sharedSegmenter = typeof Segmenter === "function" ? new Segmenter(undefined, { granularity: "grapheme" }) : null;
	}
	return sharedSegmenter;
}

/**
 * The characters of `text` as a reader sees them: grapheme clusters, or code
 * points in a runtime without `Intl.Segmenter`, which still keeps an emoji's two
 * surrogate halves together.
 */
function characters(text: string): string[] {
	const segmenter = graphemeSegmenter();
	if (segmenter === null) return [...text];
	return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** The number of characters, counted as grapheme clusters: `"👍🏽"` is 1. */
export function textLength(text: string): number {
	return characters(text).length;
}

/** Remove leading and trailing whitespace. */
export function textTrim(text: string): string {
	return text.trim();
}

/** The characters in reverse order, each grapheme cluster kept whole. */
export function textReverse(text: string): string {
	return characters(text).reverse().join("");
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
