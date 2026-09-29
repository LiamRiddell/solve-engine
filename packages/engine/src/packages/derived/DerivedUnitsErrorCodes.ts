/**
 * The codes the derived-units package answers with: `as <unit>`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const DerivedUnitsErrorCodes = {
	/** `as <unit>` given a plain number or something else with no unit. */
	AS_UNIT_EXPECTED_QUANTITY: "AS_UNIT_EXPECTED_QUANTITY",
	/** `as <unit>` given a quantity that does not measure what the unit does. */
	AS_UNIT_INCOMPATIBLE: "AS_UNIT_INCOMPATIBLE",
} as const;
