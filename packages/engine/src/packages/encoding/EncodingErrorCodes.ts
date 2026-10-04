/**
 * The codes the encoding package answers with: `as base64`, `from url`, `jwt(...)` and `query(...)`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const EncodingErrorCodes = {
	/** An encoding form given something that is not text in quotes. */
	ENCODING_EXPECTED_TEXT: "ENCODING_EXPECTED_TEXT",
	/** Text that does not decode in the encoding named: not valid base64, not a JSON Web Token, not a query string. */
	ENCODING_DECODE_FAILED: "ENCODING_DECODE_FAILED",
	/** `from <name>` naming an encoding the package does not know. The message lists the ones it does. */
	UNKNOWN_ENCODING: "UNKNOWN_ENCODING",
} as const;
