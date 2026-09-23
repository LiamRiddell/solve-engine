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
 */
function editDistance(a: string, b: string, limit: number): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	const rows = a.length + 1;
	const cols = b.length + 1;
	const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
	for (let i = 0; i < rows; i++) d[i][0] = i;
	for (let j = 0; j < cols; j++) d[0][j] = j;
	for (let i = 1; i < rows; i++) {
		let rowMin = Infinity;
		for (let j = 1; j < cols; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2][j - 2] + 1);
			d[i][j] = best;
			if (best < rowMin) rowMin = best;
		}
		if (rowMin > limit) return limit + 1;
	}
	return d[rows - 1][cols - 1];
}

/**
 * The closest names to `word` among `candidates`, nearest first, or an empty
 * list when none is close enough or too many are equally close.
 *
 * @param word - The unknown word as written.
 * @param candidates - Every name the reader could have meant.
 * @param minLength - The shortest word that gets a suggestion; 3 by default.
 */
export function nearestNames(word: string, candidates: Iterable<string>, minLength = 3): string[] {
	if (word.length < minLength) return [];
	const target = word.toLowerCase();
	const limit = allowance(word.length);
	let best = limit + 1;
	let found: string[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (candidate === word || seen.has(candidate)) continue;
		seen.add(candidate);
		const distance = editDistance(target, candidate.toLowerCase(), limit);
		if (distance > limit || distance > best) continue;
		if (distance < best) {
			best = distance;
			found = [candidate];
		} else {
			found.push(candidate);
		}
	}
	if (found.length > MAX_SUGGESTIONS) return [];
	return found.sort();
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
