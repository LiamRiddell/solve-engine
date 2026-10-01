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

/** The part of a CodeMirror `EditorView` an option's `apply` uses, by structure, so no CodeMirror import is needed. */
export interface CompletionTargetView {
	dispatch(spec: { changes: { from: number; to: number; insert: string }; selection: { anchor: number } }): void;
}

/** A CodeMirror completion option, by structure: CM6's `Completion` accepts it. */
export interface CompletionOption {
	label: string;
	type: string;
	detail?: string;
	/**
	 * Present for a phrase matched across the words already typed: replaces
	 * those words, not only the last one, and puts the cursor after the label.
	 */
	apply?: (view: CompletionTargetView, completion: unknown, from: number, to: number) => void;
}

/**
 * Convert a completion into CodeMirror's option shape.
 *
 * Kept in an adapter so the language service itself stays editor-agnostic.
 * An item with `replaceLength` (`net pres` offering `net present value of`)
 * gets an `apply` that replaces that many characters before the cursor, since
 * CodeMirror would otherwise replace only the word under it and leave `net
 * net present value of`.
 *
 * @param item - Completion produced by the language service.
 * @returns The equivalent CodeMirror option.
 */
export function completionItemToOption(item: CompletionItem): CompletionOption {
	const option: CompletionOption = { label: item.label, type: CATEGORY_TO_COMPLETION_TYPE[item.category] ?? "text", detail: item.detail };
	const length = item.replaceLength;
	if (length !== undefined && Number.isInteger(length) && length > 0) {
		option.apply = (view, _completion, _from, to) => {
			const start = Math.max(0, to - length);
			view.dispatch({ changes: { from: start, to, insert: item.label }, selection: { anchor: start + item.label.length } });
		};
	}
	return option;
}
