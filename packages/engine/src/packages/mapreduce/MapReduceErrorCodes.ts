/**
 * The codes `map`, `reduce`, `sum(...)` and `prod(...)` answer with at parse time. What they refuse while running is in `CoreErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const MapReduceErrorCodes = {
	/** A `map` over named collections (`map(x + y, x = [1, 2], y = [3, 4])`) with one that has no name before its `=`. */
	MAP_REDUCE_EXPECTED_COLLECTION_NAME: "MAP_REDUCE_EXPECTED_COLLECTION_NAME",
	/** A `map`, `reduce`, `sum` or `prod` whose expression reaches live data, which it cannot wait for once per element. */
	MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS: "MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS",
} as const;
