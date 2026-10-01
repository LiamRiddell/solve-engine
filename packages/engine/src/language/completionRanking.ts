/**
 * The order completion results are offered in, and the merge that keeps that
 * order without sorting the static vocabulary on every keystroke.
 *
 * Internal to the language service: not exported from the package.
 */

import type { CompletionItem } from "@solve-js/language/LanguageService";
import type { TokenCategory } from "@solve-js/language/TokenCategory";

/**
 * Tier ordering for completion results: user-authored variables first, then
 * grammar, then units. A map rather than an object literal, so a category a
 * package names after an inherited property (`constructor`, `toString`) reads
 * as unlisted instead of reading a function off the prototype.
 */
const CATEGORY_TIER: ReadonlyMap<TokenCategory, number> = new Map<TokenCategory, number>([
	["variable", 0],
	["function", 1],
	["keyword", 1],
	["operator", 1],
	["comparison", 1],
	["bitwise", 1],
	["datetime", 1],
	["vector", 1],
	["unit", 2],
]);

/** The tier a category not listed in the table falls into, after every listed one. */
const UNLISTED_TIER = 3;

/**
 * A category's tier: 0 for variables, 1 for grammar, 2 for units, 3 for
 * anything else, a package's own categories included.
 *
 * @param category - The candidate's category.
 */
export function completionTier(category: TokenCategory): number {
	return CATEGORY_TIER.get(category) ?? UNLISTED_TIER;
}

/**
 * The completion order: by tier (variables, then grammar, then units, then
 * anything else), then by label in the default locale's collation.
 *
 * @param a - One candidate.
 * @param b - Another.
 * @returns Negative when `a` goes first, positive when `b` does, 0 for a tie.
 */
export function compareCompletionItems(a: CompletionItem, b: CompletionItem): number {
	const tierDiff = completionTier(a.category) - completionTier(b.category);
	if (tierDiff !== 0) return tierDiff;
	return a.label.localeCompare(b.label);
}

/**
 * The first `limit` items of the concatenation of `groups` as a stable sort by
 * {@link compareCompletionItems} would order it, given that each group is
 * already in that order. A tie goes to the earlier group, then to the earlier
 * place within a group, which is exactly what the stable sort does.
 *
 * Lets the static vocabulary be sorted once, when its index is built, so a
 * keystroke compares only the few candidates that change with the document
 * (variables, the document's units, phrases matched across words) against it.
 *
 * @param groups - Candidate lists, each already sorted, in insertion order.
 * @param limit - The most items to return; 0 or less returns none.
 * @returns A new array; the groups are not changed.
 */
export function mergeRankedCompletions(groups: readonly (readonly CompletionItem[])[], limit: number): CompletionItem[] {
	const out: CompletionItem[] = [];
	if (!(limit > 0)) return out;
	const heads: number[] = groups.map(() => 0);
	while (out.length < limit) {
		let best = -1;
		for (let g = 0; g < groups.length; g++) {
			const group = groups[g];
			if (heads[g] >= group.length) continue;
			// Strictly less: on a tie the earlier group keeps its place.
			if (best < 0 || compareCompletionItems(group[heads[g]], groups[best][heads[best]]) < 0) best = g;
		}
		if (best < 0) break;
		out.push(groups[best][heads[best]]);
		heads[best]++;
	}
	return out;
}
