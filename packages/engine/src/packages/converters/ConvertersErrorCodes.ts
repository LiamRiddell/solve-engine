/**
 * The codes the converters package answers with: `as <name>`, number notations and rounding.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const ConvertersErrorCodes = {
	/** `as` followed by something that is not a converter name, as in `1 as as`. */
	AS_CONVERTER_EXPECTED_NAME: "AS_CONVERTER_EXPECTED_NAME",
	/** A number notation (`as engineering`, `as compact`) given something that is not a number or a quantity. */
	AS_CONVERTER_EXPECTED_NUMBER: "AS_CONVERTER_EXPECTED_NUMBER",
	/** `as base N` for a base the engine cannot write numbers in. The message lists the bases it can. */
	AS_CONVERTER_UNSUPPORTED_BASE: "AS_CONVERTER_UNSUPPORTED_BASE",
	/** `to N dp` with a place count outside 0 to 100. */
	INVALID_DECIMAL_PLACES: "INVALID_DECIMAL_PLACES",
	/** `to N sf` with a count that is not a whole number from 1 to 17. */
	INVALID_SIGNIFICANT_FIGURES: "INVALID_SIGNIFICANT_FIGURES",
	/** `to nearest ...` followed by something that is not a positive number or a word such as `ten` or `hundred`. */
	INVALID_ROUNDING_INCREMENT: "INVALID_ROUNDING_INCREMENT",
} as const;
