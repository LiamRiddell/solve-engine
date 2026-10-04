/**
 * The codes the matrix package answers with at parse time. What matrices refuse while running is in `CoreErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const MatrixErrorCodes = {
	/** A matrix written as `[]`, which has no shape. */
	EMPTY_MATRIX_LITERAL: "EMPTY_MATRIX_LITERAL",
	/** A matrix whose rows have different numbers of columns. The message names the row. */
	RAGGED_MATRIX_LITERAL: "RAGGED_MATRIX_LITERAL",
	/** A matrix slice with other than two ranges, one for the rows and one for the columns. */
	INVALID_MATRIX_SLICE_ARITY: "INVALID_MATRIX_SLICE_ARITY",
} as const;
