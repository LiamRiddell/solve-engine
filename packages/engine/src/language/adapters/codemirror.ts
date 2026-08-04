import type { TokenCategory } from "@solve-js/language/TokenCategory";
import type { CompletionItem } from "@solve-js/language/LanguageService";

/**
 * Maps a semantic category to one of `@codemirror/autocomplete`'s built-in
 * completion "type" strings (which drive its default gutter icon), the one
 * genuinely CodeMirror-specific thing this feature needs. Falls back to
 * "text" for anything unmapped, including plugin-contributed categories
 * (e.g. OSRS's "osrs-item"), a reasonable neutral default rather than a
 * hard failure for a category this adapter doesn't know about yet.
 *
 * No `@codemirror/autocomplete` import here, the returned object shape is
 * structurally compatible with CM6's `Completion` type by duck typing, so
 * `solve-js` gains no new dependency; the actual `CompletionSource`
 * function (reading `CompletionContext`, building a `CompletionResult`)
 * lives in each consumer (src/app, playground), same tier as
 * `buildDecorations()` already is for highlighting.
 */
const CATEGORY_TO_COMPLETION_TYPE: Partial<Record<TokenCategory, string>> = {
	keyword: "keyword",
	operator: "keyword",
	comparison: "keyword",
	bitwise: "keyword",
	function: "function",
	variable: "variable",
	unit: "type",
	datetime: "keyword",
	vector: "type",
};

/**
 * Convert a completion into CodeMirror's option shape.
 *
 * Kept in an adapter so the language service itself stays editor-agnostic.
 *
 * @param item - Completion produced by the language service.
 * @returns The equivalent CodeMirror option.
 */
export function completionItemToOption(item: CompletionItem): { label: string; type: string; detail?: string } {
	return { label: item.label, type: CATEGORY_TO_COMPLETION_TYPE[item.category] ?? "text", detail: item.detail };
}
