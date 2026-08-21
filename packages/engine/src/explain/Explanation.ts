import type { Value } from "@solve-js/vm/Value";

/**
 * One line of a derivation: a readable account of a single operation and the
 * value it arrives at.
 *
 * `description` is prose for the person reading the note, not developer
 * diagnostics ("80 less 20%", "64 plus 20%"), and `value` is that step's
 * intermediate result, the same {@link Value} the engine would produce for it.
 */
export interface ExplanationStep {
	/** A short, human-readable account of the operation, e.g. "80 less 20%". */
	readonly description: string;
	/** The value this step arrives at. */
	readonly value: Value;
}

/**
 * A worked-through derivation of how a line reached its answer.
 *
 * `steps` is ordered the way the engine evaluates the line: an operand appears
 * before the operation that consumes it, and each step's left-hand side is the
 * running value carried down from the steps above it. `result` is the final
 * value and is identical to what {@link ExpressionEngine.evaluateExpression}
 * returns for the same line.
 *
 * A line with nothing to break down (a bare literal, or a construct this slice
 * does not derive yet) returns an empty `steps` array with `result` set, rather
 * than an error: the answer is still reported, just without a derivation.
 */
export interface Explanation {
	/** The expression as given. */
	readonly expression: string;
	/** The ordered derivation, one entry per operation, in evaluation order. */
	readonly steps: ExplanationStep[];
	/** The final value, identical to the engine's own answer for the line. */
	readonly result: Value;
}
