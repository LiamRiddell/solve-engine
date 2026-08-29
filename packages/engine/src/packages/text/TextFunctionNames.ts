/**
 * The function-call spellings the text package accepts, each mapped to the
 * plugin function it dispatches to. `length("hi")` is the call form of
 * `length of "hi"`; `upper("hi")` the call form of `"hi" as upper`.
 *
 * Only names that stay ordinary identifiers live here. `trim` and `reverse` are
 * bare prefix keywords, so `trim("  hi  ")` already works as the keyword applied
 * to a parenthesised value and needs no call fusion; `contains` and the two
 * membership tests are infix words. Every name below is one the lexer would
 * otherwise leave as a plain IDENT, so a normaliser rule mints the call token
 * only when the name is immediately followed by `(`.
 */
export const TEXT_CALL_FUNCTIONS: Record<string, string> = {
	length: "textLength",
	upper: "textUpper",
	uppercase: "textUpper",
	lower: "textLower",
	lowercase: "textLower",
	title: "textTitle",
	titlecase: "textTitle",
	slug: "textSlug",
	slugify: "textSlug",
	replace: "textReplace",
	repeat: "textRepeat",
	words: "textWordCount",
	wordcount: "textWordCount",
	characters: "textCharCount",
	charcount: "textCharCount",
	lines: "textLineCount",
	linecount: "textLineCount",
};
