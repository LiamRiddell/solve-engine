/**
 * The codes the numerals package answers with: Roman numerals and numbers in words.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const NumeralsErrorCodes = {
	/** A numeral form (`as roman`, `as words`) given something that is not a number. */
	NUMERAL_EXPECTED_NUMBER: "NUMERAL_EXPECTED_NUMBER",
	/** A number the numeral form cannot write: Roman numerals cover 1 to 3,999, and a number past the largest spelled one has no words. */
	NUMERAL_OUT_OF_RANGE: "NUMERAL_OUT_OF_RANGE",
	/** `from roman` given something that is not text in quotes. */
	NUMERAL_EXPECTED_TEXT: "NUMERAL_EXPECTED_TEXT",
	/** `from roman` given text that is not a valid Roman numeral. */
	NUMERAL_INVALID_ROMAN: "NUMERAL_INVALID_ROMAN",
} as const;
