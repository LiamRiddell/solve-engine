/**
 * Near-miss names for an unknown word: "did you mean".
 *
 * When a word is not a known variable, unit or function, the error names the
 * closest real names, so `sqr(16)` says "Did you mean sqrt?" instead of only
 * that `sqr` is undefined. It never corrects: the line is still an error, and
 * the reader (or a host offering a one-click fix) decides. Two or three names
 * equally close are all listed, since picking one of them would be a guess.
 *
 * Closeness is the optimal string alignment distance (Levenshtein with
 * adjacent transpositions, so `teh` is one step from `the`), compared without
 * case so `KM` finds `km`. The allowance grows with the word: one edit up to
 * five letters, two up to nine, three beyond. A short word gets no suggestion at
 * all, since the unit table holds thousands of short spellings and nearly every
 * short word is an edit or two from one of them: a caller sets how short, three
 * letters for a function name (`sqr` finds `sqrt`) and four for a variable,
 * whose candidates include every unit.
 */

/** The most names a suggestion lists; more ties than this and none is offered. */
const MAX_SUGGESTIONS = 3;

/** How many edits a word of this length may be from a suggestion. */
function allowance(length: number): number {
	if (length <= 5) return 1;
	if (length <= 9) return 2;
	return 3;
}

/**
 * The optimal string alignment distance between `a` and `b`, or `limit + 1`
 * as soon as it is certain to exceed `limit`.
 *
 * Three rolling rows rather than a full matrix: the distance runs once per
 * candidate, and a candidate list holds every unit spelling, so allocating a
 * matrix each time was most of the cost of an unknown name.
 */
function editDistance(a: string, b: string, limit: number): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	const cols = b.length + 1;
	let before = new Array<number>(cols).fill(0);
	let previous = new Array<number>(cols);
	let current = new Array<number>(cols);
	for (let j = 0; j < cols; j++) previous[j] = j;
	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		let rowMin = i;
		for (let j = 1; j < cols; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let best = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, before[j - 2] + 1);
			current[j] = best;
			if (best < rowMin) rowMin = best;
		}
		if (rowMin > limit) return limit + 1;
		const spare = before;
		before = previous;
		previous = current;
		current = spare;
	}
	return previous[cols - 1];
}

/**
 * Whether `b` can be within `limit` edits of `a`, by a test far cheaper than
 * the distance: some character among the first `limit + 1` of `a` appears among
 * the first `2 * limit + 2` of `b`. It never rejects a real match. With at most
 * `limit` edits, a substitution or deletion touches one character each, so at
 * least one of the first `limit + 1` characters of `a` survives, matched or
 * swapped with its neighbour, and the insertions and deletions before it move
 * it by at most `limit` places, a swap by one more. Most of the unit table
 * fails this for any given word, so the distance runs on few candidates.
 */
function mayBeNear(a: string, b: string, limit: number): boolean {
	const aEnd = Math.min(a.length, limit + 1);
	const bEnd = Math.min(b.length, 2 * limit + 2);
	for (let i = 0; i < aEnd; i++) {
		const c = a.charCodeAt(i);
		for (let j = 0; j < bEnd; j++) if (b.charCodeAt(j) === c) return true;
	}
	return false;
}

/** The nearest candidates found so far, and their distance. */
interface Nearest {
	best: number;
	found: string[];
}

/**
 * Weighs one candidate against the nearest found so far, in place.
 *
 * @param nearest - The search's state.
 * @param target - The unknown word, lower-cased.
 * @param name - The candidate as written.
 * @param lower - The candidate, lower-cased.
 * @param limit - The word's allowance.
 */
function consider(nearest: Nearest, target: string, name: string, lower: string, limit: number): void {
	if (Math.abs(lower.length - target.length) > limit || !mayBeNear(target, lower, limit)) return;
	const distance = editDistance(target, lower, limit);
	if (distance > limit || distance > nearest.best) return;
	if (distance < nearest.best) {
		nearest.best = distance;
		nearest.found = [name];
	} else {
		nearest.found.push(name);
	}
}

/** The most searches a {@link NameIndex} remembers before it starts again. */
const MEMO_LIMIT = 1024;

/**
 * A fixed set of names, lower-cased once and grouped by length, for a search
 * that runs on every unknown name: the unit table, which holds about 1,450
 * spellings. A search reads only the lengths the word's allowance reaches, and
 * its result is remembered, since the names never change: a document that
 * re-evaluates the same unknown word pays for the search once.
 */
export class NameIndex {
	private readonly byLength = new Map<number, Array<readonly [string, string]>>();
	private readonly memo = new Map<string, Nearest>();

	/** @param names - The names to search; duplicates are kept once. */
	constructor(names: Iterable<string>) {
		const seen = new Set<string>();
		for (const name of names) {
			if (seen.has(name)) continue;
			seen.add(name);
			const bucket = this.byLength.get(name.length) ?? [];
			bucket.push([name, name.toLowerCase()]);
			this.byLength.set(name.length, bucket);
		}
	}

	/**
	 * The nearest names to `word` in this index, and their distance, excluding
	 * `word` itself. The caller must not change the result.
	 *
	 * @param word - The unknown word as written.
	 * @param target - The word, lower-cased.
	 * @param limit - The word's allowance.
	 */
	nearest(word: string, target: string, limit: number): Readonly<Nearest> {
		const remembered = this.memo.get(word);
		if (remembered !== undefined) return remembered;
		const nearest: Nearest = { best: limit + 1, found: [] };
		for (let length = word.length - limit; length <= word.length + limit; length++) {
			const bucket = this.byLength.get(length);
			if (bucket === undefined) continue;
			for (const [name, lower] of bucket) {
				if (name !== word) consider(nearest, target, name, lower, limit);
			}
		}
		if (this.memo.size >= MEMO_LIMIT) this.memo.clear();
		this.memo.set(word, nearest);
		return nearest;
	}
}

/**
 * The closest names to `word` among `candidates` and, when one is given, the
 * names in `index`, nearest first, or an empty list when none is close enough
 * or too many are equally close.
 *
 * @param word - The unknown word as written.
 * @param candidates - Names the reader could have meant that change between
 * calls, such as the document's variables.
 * @param minLength - The shortest word that gets a suggestion; 3 by default.
 * @param index - A fixed set of names searched alongside, such as the unit table.
 */
export function nearestNames(word: string, candidates: Iterable<string>, minLength = 3, index?: NameIndex): string[] {
	if (word.length < minLength) return [];
	const target = word.toLowerCase();
	const limit = allowance(word.length);
	const nearest: Nearest = { best: limit + 1, found: [] };
	const seen = new Set<string>();
	if (index !== undefined) {
		const fromIndex = index.nearest(word, target, limit);
		nearest.best = fromIndex.best;
		nearest.found = [...fromIndex.found];
		for (const name of fromIndex.found) seen.add(name);
	}
	for (const candidate of candidates) {
		// The length test before the lower-casing: it costs nothing.
		if (Math.abs(candidate.length - word.length) > limit) continue;
		if (candidate === word || seen.has(candidate)) continue;
		seen.add(candidate);
		consider(nearest, target, candidate, candidate.toLowerCase(), limit);
	}
	if (nearest.found.length > MAX_SUGGESTIONS) return [];
	return nearest.found.sort();
}

/**
 * The sentence an error appends for its suggestions, with a leading space, or
 * the empty string when there are none.
 *
 * @param names - The suggestions, from {@link nearestNames}.
 */
export function didYouMeanSentence(names: readonly string[]): string {
	if (names.length === 0) return "";
	if (names.length === 1) return ` Did you mean ${names[0]}?`;
	return ` Did you mean ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}?`;
}
