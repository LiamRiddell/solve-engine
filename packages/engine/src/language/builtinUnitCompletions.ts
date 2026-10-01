/**
 * The built-in units offered as completions, shared by every language service
 * in the process.
 *
 * The built-in units are most of the completion vocabulary (more than 1,300 of
 * some 1,750 candidates) and the one part of it that no engine can change: they
 * come from `knownUnits` and `getMeasure`, both fixed when the module loads, not
 * from anything an engine registers. Building their candidates once per engine
 * made the first completion on every new engine pay for a lowercase, a measure
 * lookup, a deduplication key and an index entry per unit, which is most of
 * what #771 added to that first call. They are read here once per process
 * instead, and a first character's candidates are only made and sorted when a
 * prefix starting with it is first typed.
 *
 * What stays per engine is everything an engine registers: a package's own
 * items, the lexer's keywords (a language pack's included), the call words and
 * the phrases. See `LanguageService.rankedStaticBucket`, which merges the two.
 *
 * Internal to the language service: not exported from the package.
 */

import type { CompletionItem } from "@solve-js/language/LanguageService";
import { compareCompletionItems, type IndexedCompletionCandidate } from "@solve-js/language/completionRanking";
import { knownUnits } from "@solve-js/lexer/units";
import { getMeasure } from "@solve-js/uom/UomConverter";

/** The answer for a first character no built-in unit starts with. */
const NO_UNITS: readonly IndexedCompletionCandidate[] = Object.freeze([]);

/**
 * The built-in unit spellings by the lowercased first character, in
 * `knownUnits` order, one per lowercased spelling (the first wins, as it did
 * when each engine deduplicated them). Built on the first completion in the
 * process. A map, so a character is never read off an inherited property.
 */
let spellingsByFirstCharacter: ReadonlyMap<string, readonly string[]> | null = null;

/** The first characters whose candidates have been made and sorted, and those candidates. */
const rankedBuckets = new Map<string, readonly IndexedCompletionCandidate[]>();

/**
 * Group unit spellings by their lowercased first character, keeping the first
 * of any that lowercase alike, in the order given. A spelling that lowercases
 * to nothing is left out, since no prefix can match it.
 *
 * @param spellings - Unit spellings, in the order their candidates are gathered.
 * @returns The spellings kept, by first character, each list in the order given.
 */
export function groupUnitSpellings(spellings: Iterable<string>): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	const seen = new Set<string>();
	for (const spelling of spellings) {
		const lower = spelling.toLowerCase();
		const firstCharacter = lower[0];
		if (firstCharacter === undefined || seen.has(lower)) continue;
		seen.add(lower);
		let group = groups.get(firstCharacter);
		if (group === undefined) {
			group = [];
			groups.set(firstCharacter, group);
		}
		group.push(spelling);
	}
	return groups;
}

/**
 * The built-in unit candidates whose lowercased label starts with
 * `firstCharacter`, in completion order (see `compareCompletionItems`), ties
 * keeping `knownUnits` order. Made and sorted the first time any language
 * service in the process asks for that character, then shared. The list and
 * each completion item in it are frozen, since every engine reads the same
 * ones and a host is handed the items themselves.
 *
 * @param firstCharacter - The lowercased first character of a prefix.
 * @returns The candidates, or an empty list when no built-in unit starts with it.
 */
export function rankedBuiltinUnitBucket(firstCharacter: string): readonly IndexedCompletionCandidate[] {
	const ranked = rankedBuckets.get(firstCharacter);
	if (ranked !== undefined) return ranked;
	spellingsByFirstCharacter ??= groupUnitSpellings(knownUnits);
	const spellings = spellingsByFirstCharacter.get(firstCharacter);
	if (spellings === undefined) return NO_UNITS;
	const bucket = spellings.map((label): IndexedCompletionCandidate => {
		const item: CompletionItem = Object.freeze({ label, category: "unit", detail: getMeasure(label) });
		return { item, lowerLabel: label.toLowerCase() };
	});
	bucket.sort((a, b) => compareCompletionItems(a.item, b.item));
	const frozen = Object.freeze(bucket);
	rankedBuckets.set(firstCharacter, frozen);
	return frozen;
}
