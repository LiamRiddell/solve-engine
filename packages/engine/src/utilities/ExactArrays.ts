/**
 * Arrays held at exactly their length, for the lists an engine builds once at
 * construction and keeps for its whole life.
 *
 * V8 grows an array by more than it needs: the first `push` onto an empty
 * array, or a spread such as `[...[], name]`, reserves room for seventeen
 * elements. That slack is what makes appending cheap, and it is the right
 * trade for a list that keeps growing. A list that is filled once and then
 * only read keeps the slack for nothing, and an engine holds hundreds of them
 * (the names each package contributed, the spellings of each `as` converter),
 * so it came to tens of kilobytes per engine for the built-in packages.
 *
 * Both helpers return a new array and never change the one they are given.
 * An empty array costs nothing extra (V8 shares one empty backing store
 * between them), so {@link exactLength} hands an empty list back as it is.
 *
 * @module ExactArrays
 */

/**
 * `items` held at exactly its length: a copy when it has elements, the array
 * itself when it is empty. The input is not changed, but a non-empty result is
 * a different array, so a caller that goes on appending to the input does not
 * reach it.
 *
 * @param items - The finished list.
 * @returns A list with the same elements in the same order.
 */
export function exactLength<T>(items: T[]): T[] {
	return items.length === 0 ? items : items.slice();
}

/**
 * A new list: `items` with `item` on the end, held at exactly its length.
 * Copied element by element into an array sized up front, because a spread
 * builds its result by appending and keeps the room an append reserves.
 *
 * @param items - The list so far. Not changed.
 * @param item - The element to add.
 * @returns A new array one longer than `items`.
 */
export function appendExact<T>(items: readonly T[], item: T): T[] {
	const next = new Array<T>(items.length + 1);
	for (let i = 0; i < items.length; i++) next[i] = items[i];
	next[items.length] = item;
	return next;
}
