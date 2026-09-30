/**
 * The codes the units package answers with for cooking conversions between mass and volume.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const UomErrorCodes = {
	/** A cooking conversion of a plain number, with no mass or volume unit. */
	COOKING_CONVERSION_REQUIRES_UNIT: "COOKING_CONVERSION_REQUIRES_UNIT",
	/** A cooking conversion from or to a unit that is not a mass or a volume. */
	COOKING_CONVERSION_UNSUPPORTED_UNIT: "COOKING_CONVERSION_UNSUPPORTED_UNIT",
	/** A cooking conversion between mass and volume for an ingredient with no density in the table. */
	COOKING_UNKNOWN_INGREDIENT: "COOKING_UNKNOWN_INGREDIENT",
} as const;
