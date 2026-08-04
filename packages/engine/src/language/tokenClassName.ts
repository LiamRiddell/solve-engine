import type { TokenCategory } from "@solve-js/language/TokenCategory";

/**
 * Namespace applied to a semantic category when no other one is asked for.
 *
 * A prefix is needed because a bare category name like `number` or `error`
 * would collide with almost any host stylesheet. `solve-` is the narrowest
 * namespace that still says where the class came from, and it deliberately
 * names this library rather than any particular editor.
 */
export const DEFAULT_TOKEN_CLASS_PREFIX = "solve-";

/**
 * Maps a semantic category to a predictable, stable CSS class name.
 *
 * Deliberately trivial: the category name IS the class-name key
 * (`"number"` → `solve-number`), so there is no separate table to keep in
 * sync as categories grow. A brand-new category, including one contributed
 * by a solve-js package at runtime, gets a matching class name with no
 * changes here.
 *
 * This is editor-agnostic on purpose. It produces a class-name string and
 * nothing else, so it works the same whether the host is CodeMirror
 * (`Decoration.mark({ class: tokenClassName(token.category) })`), Slate,
 * ProseMirror, Monaco or a plain `<span>`. Actual colors are pure CSS,
 * resolved from `--solve-hl-{category}` custom properties by each consumer.
 *
 * @param category - Semantic category from `getSemanticTokens()`.
 * @param prefix - Namespace to apply. Defaults to `solve-`.
 * @returns The class name for that category.
 */
export function tokenClassName(category: TokenCategory, prefix: string = DEFAULT_TOKEN_CLASS_PREFIX): string {
	return `${prefix}${category}`;
}

/**
 * Builds a `tokenClassName` bound to a fixed prefix.
 *
 * The prefix is configurable because a host may already own a namespace it
 * wants these classes to sit inside: a CodeMirror theme that keys off `cm-`,
 * a design system that scopes everything under one token, or an app that
 * embeds two editors and wants to style them apart. Passing the prefix once
 * here is cheaper than threading it through every call site.
 *
 * ```ts
 * const className = createTokenClassName("cm-solve-");
 * className("number"); // "cm-solve-number"
 * ```
 *
 * @param prefix - Namespace to apply to every category.
 * @returns A function mapping a category to a prefixed class name.
 */
export function createTokenClassName(prefix: string): (category: TokenCategory) => string {
	return (category: TokenCategory) => `${prefix}${category}`;
}
