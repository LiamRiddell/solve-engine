/**
 * Runs an async worker over a list with at most `limit` running at once.
 *
 * The coverage runner uses it to start its shards a few at a time: a shard
 * is a single-threaded process that slows as it accumulates coverage, so many
 * short shards run a few at a time finish sooner than a few long ones all at
 * once, and no more processes run at once than the runner has cores.
 *
 * Items start in order. Results come back in the order of the items, whatever
 * order they finish in. A worker that rejects does not strand the others: the
 * rest still run, and the rejection is returned in its place as
 * `{ error }`, so the caller sees every outcome.
 *
 * @module pool
 */

/**
 * @template T, R
 * @param {readonly T[]} items - What to run the worker over.
 * @param {number} limit - The most workers at once, a whole number of at least 1.
 * @param {(item: T, index: number) => Promise<R>} worker - Run for each item.
 * @returns {Promise<Array<R | { error: unknown }>>} One outcome per item, in order.
 * @throws {RangeError} When `limit` is not a whole number of at least 1.
 */
export async function runPool(items, limit, worker) {
	if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`The pool limit must be a whole number of at least 1, not ${String(limit)}.`);
	const outcomes = new Array(items.length);
	let next = 0;
	const lane = async () => {
		while (next < items.length) {
			const index = next++;
			try {
				outcomes[index] = await worker(items[index], index);
			} catch (error) {
				outcomes[index] = { error };
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
	return outcomes;
}
