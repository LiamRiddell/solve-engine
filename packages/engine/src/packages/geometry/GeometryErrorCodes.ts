/**
 * The codes the geometry package answers with: `area of`, `volume of` and the other shape measures.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const GeometryErrorCodes = {
	/** A shape measure (`area of`) followed by something that is not a shape. The message lists the shapes. */
	GEOMETRY_EXPECTED_SHAPE: "GEOMETRY_EXPECTED_SHAPE",
	/** A shape given a dimension that is not a length or a number, or a set of dimensions that make no shape. */
	GEOMETRY_ERROR: "GEOMETRY_ERROR",
} as const;
