import { getTokenCategory } from "@solve-js/language/TokenCategoryMap"
import { tokenClassName } from "@solve-js/language/tokenClassName"

/**
 * The syntax-highlighting class for a token, from its lexer type.
 *
 * The diagnostic tabs list tokens constantly, and until now every one of them
 * was the same grey chip: the editor two panes to the left coloured `10` as a
 * number and `+` as an operator, and the Output tab beside it showed both in
 * the same neutral. The colour was already computed, by the same engine, for
 * the same tokens, and simply was not being asked for here.
 *
 * This is the same two-step an editor integration does. `getTokenCategory`
 * turns a lexer type into a semantic category, `tokenClassName` turns that into
 * a class, and the `.solve-*` rules in `index.css` supply the colour. Which
 * means the tabs, the editor and the documentation site are painted from one
 * palette, and a package that registers a new category is coloured in all three
 * without anything here changing.
 *
 * @param type - The token's lexer type, e.g. `NUMBER` or `PLUS`.
 * @returns A class name, or `undefined` for a type with no category, so a
 *   caller can fall back rather than paint an uncategorised token as an error.
 */
export function tokenClass(type: string | undefined): string | undefined {
	if (!type) return undefined
	const category = getTokenCategory(type)
	return category ? tokenClassName(category) : undefined
}
