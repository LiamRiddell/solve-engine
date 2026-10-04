/**
 * The codes the health package answers with: `bmi`, `pace` and `speed`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const HealthErrorCodes = {
	/** A health function given an argument of the wrong kind, such as a weight where a height goes. The message shows the call. */
	HEALTH_BAD_INPUT: "HEALTH_BAD_INPUT",
} as const;
