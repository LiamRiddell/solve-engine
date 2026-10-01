/**
 * The codes the algebra verbs answer with at parse time. What algebra refuses while running is in `CoreErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const SymbolicErrorCodes = {
	/** An algebra verb (`der`, `integral`, `solve`) whose expression reaches live data. */
	SYMBOLIC_ARGUMENT_MUST_BE_SYNCHRONOUS: "SYMBOLIC_ARGUMENT_MUST_BE_SYNCHRONOUS",
} as const;
