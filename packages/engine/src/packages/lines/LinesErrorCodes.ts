/**
 * The codes the lines package answers with: line ranges, `total above` and its siblings, sections and `inputs of`. The refusals every cross-line read shares are in `CoreErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const LinesErrorCodes = {
	/** A line range or an `above` aggregate reaching a line that is not a number or a quantity. */
	LINE_RANGE_NON_NUMERIC: "LINE_RANGE_NON_NUMERIC",
	/** A line range or an `above` aggregate with no figures in it: every line blank, a heading, or the top of the document. */
	LINE_RANGE_EMPTY: "LINE_RANGE_EMPTY",
	/** A reference to a line that has since been deleted. An editor that keeps references through edits writes it as `line deleted`. */
	LINE_REFERENCE_DELETED: "LINE_REFERENCE_DELETED",
	/** A section total evaluated with no document to read headings from. */
	SECTION_NO_DOCUMENT: "SECTION_NO_DOCUMENT",
	/** A section total naming a heading the note does not have. The message lists the headings it has. */
	SECTION_NOT_FOUND: "SECTION_NOT_FOUND",
	/** A section total naming a heading two or more headings share. */
	SECTION_AMBIGUOUS: "SECTION_AMBIGUOUS",
	/** A section with no figures under its heading. */
	SECTION_EMPTY: "SECTION_EMPTY",
	/** `inputs of` not followed by a line reference, as in `inputs of line 4`. */
	INPUTS_OF_SYNTAX: "INPUTS_OF_SYNTAX",
	/** `inputs of` a line that reads its own answer, directly or round a loop of lines. */
	TRACE_CYCLE: "TRACE_CYCLE",
	/** `inputs of` a line that reads a line below it, whose order of working cannot be traced. */
	TRACE_FORWARD_REFERENCE: "TRACE_FORWARD_REFERENCE",
} as const;
