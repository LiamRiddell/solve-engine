import type { BytecodeBuilder, BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { ErrorFactory, type EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import { safeText } from "@solve-js/parser/ParseMessages";

/**
 * The refusal for a held expression that reads other lines of the document,
 * or null when it reads none.
 *
 * A held expression is compiled on its own and worked out later, away from
 * the line that wrote it: once for each element of a `map`, `reduce`, `sum`
 * or `prod`, once for each point of a plot, or as a formula by an algebra verb
 * (`der`, `solve`, `integral`). A call that reads other lines (`prev`,
 * `line 1`, `total above`, a tag or a table column) waits for the document to
 * hand it a value, so such an expression used to be refused as reaching live
 * data, "no weather/stocks/currency calls", which named something the line
 * never did. It is refused for what it is, with the way to write it: give the
 * line's value a name on a line of its own and use the name.
 *
 * A held expression that reaches live data is not this refusal: its
 * `readsDocument` is false, and the caller's own refusal for that stands.
 *
 * @param program - The held expression, compiled.
 * @param builder - The builder it was compiled into, which knows whether a call read lines.
 * @param verb - The form holding it, as the reader wrote it (`map`, `sum`, `plot`, `der`).
 * @returns The refusal to throw, or null.
 */
export function heldExpressionReadsLines(program: BytecodeProgram, builder: BytecodeBuilder, verb: string): EngineError | null {
	if (!program.hasAsync || !builder.readsDocument) return null;
	const name = safeText(verb);
	return ErrorFactory.parsing({
		code: "HELD_EXPRESSION_READS_LINES",
		message: `${name}'s expression reads other lines of the document, and it is worked out away from the line, where there are no lines to read: give the line's value a name first, as in p = prev, and use p in the expression`,
		suggestion: `Write p = prev (or p = line 1) on the line above, then use p inside ${name}(...)`,
		context: { verb: name },
	});
}
