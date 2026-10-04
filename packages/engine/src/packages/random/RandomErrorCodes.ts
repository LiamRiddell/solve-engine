/**
 * The codes the random package answers with: `random hex`, `pick`, `shuffle` and `random seed`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const RandomErrorCodes = {
	/** `random hex` given a count that is not a number of 0 or more. */
	RANDOM_EXPECTED_COUNT: "RANDOM_EXPECTED_COUNT",
	/** `pick` with no options to choose from. */
	RANDOM_PICK_EMPTY: "RANDOM_PICK_EMPTY",
	/** `shuffle` given something that is not a single row or column. */
	RANDOM_SHUFFLE_EXPECTED_LIST: "RANDOM_SHUFFLE_EXPECTED_LIST",
	/** `random seed` with nothing after it to seed with. */
	RANDOM_SEED_EXPECTED_VALUE: "RANDOM_SEED_EXPECTED_VALUE",
} as const;
