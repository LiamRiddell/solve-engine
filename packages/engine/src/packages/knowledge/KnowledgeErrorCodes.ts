/**
 * The codes the knowledge package answers with. An answer that fails to fetch arrives as `KNOWLEDGE_QUERY_FAILED`, one of the query resolver codes.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const KnowledgeErrorCodes = {
	/** A knowledge question asked on an engine whose knowledge package was created without an `answerQuery`. The host supplies one through `createKnowledgePackage`. */
	KNOWLEDGE_NOT_CONFIGURED: "KNOWLEDGE_NOT_CONFIGURED",
} as const;
