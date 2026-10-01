/**
 * Whether a line's text is a scenario declaration (`scenario bull with growth
 * = 8%`, #744), read from the text alone.
 *
 * The declaration answers a summary of the inputs it keeps, which is text, not
 * a figure, so a block total, a section total and a trace pass over it the way
 * they pass over a check line. The shape is the one the declaration rule
 * fuses: the word `scenario`, a name, `with`, and a name followed by `=`.
 *
 * @param text - The line, as written.
 */
export function isScenarioDeclarationText(text: string): boolean {
	return SCENARIO_DECLARATION.test(text);
}

/** `scenario <name> with [:]<name> =`, at the start of the line. */
const SCENARIO_DECLARATION = /^\s*scenario\s+[\p{L}_][\p{L}\p{N}_]*\s+with\s+:?[\p{L}_][\p{L}\p{N}_]*\s*=/iu;
