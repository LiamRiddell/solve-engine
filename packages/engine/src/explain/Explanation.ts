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
 * A line with nothing to break down (a bare literal, or a construct no package
 * describes) returns an empty `steps` array with `result` set, rather than an
 * error: the answer is still reported, just without a derivation.
 */
export interface Explanation {
	/** The expression as given. */
	readonly expression: string;
	/** The ordered derivation, one entry per operation, in evaluation order. */
	readonly steps: ExplanationStep[];
	/** The final value, identical to the engine's own answer for the line. */
	readonly result: Value;
}

/**
 * One call the engine made while working out a line, handed to a package's
 * {@link ExplainHook} so the package can describe it.
 *
 * `kind` says what ran and `name` which one:
 *
 * - `"builtin"`: one of the engine's built-in functions, named as its arity
 *   error spells it (`sqrt`, `round`, `presentValue`, `loanRepayment`). The
 *   finance phrases and the function-call forms reach the same builtins, so a
 *   hook that describes `presentValue` describes both spellings.
 * - `"plugin"`: one of the calling package's own `pluginFunctions`, by the name
 *   it was registered under. Only the package that registered the function is
 *   asked about it.
 * - `"converter"`: one of the calling package's own `asConverters`, by name.
 *   Only the package that registered it is asked.
 * - `"conversion"`: a unit, rate or currency conversion (`5 km in miles`),
 *   named by the table that answered it: `"measure"`, `"rate"` or `"currency"`.
 *
 * `args` are the values the call was given, in the order it declares them; a
 * conversion's single argument is the source quantity in its own unit, and the
 * target unit is `result.unit`. `result` is the value the call produced, the
 * same object the rest of the line went on to use.
 */
export interface ExplainCall {
	/** What ran. */
	readonly kind: "builtin" | "plugin" | "converter" | "conversion";
	/** Which one ran; see the interface description for each kind. */
	readonly name: string;
	/** The values the call was given, in declaration order. */
	readonly args: readonly Value[];
	/** The value the call produced. The last step a hook returns must carry this object. */
	readonly result: Value;
}

/**
 * Formatting help handed to an {@link ExplainHook}, so a package's step reads
 * like the engine's own.
 */
export interface ExplainContext {
	/**
	 * A value as the engine displays it, without the leading `= `: `$1,000.00`,
	 * `5.00 km`, `4.00%`. A plain number is shown to six significant figures
	 * (see {@link formatNumber}) rather than the display's two decimal places,
	 * so an argument such as `3.14159` is not shown as `3.14` in the step that
	 * rounds it.
	 */
	format(value: Value): string;
	/**
	 * A bare number to six significant figures, and never fewer digits than
	 * its whole part has, with thousands grouped: `0.621371`, `1,609.34`,
	 * `100,000`. For a factor or a rate that the display's two decimal places
	 * would round away.
	 */
	formatNumber(n: number): string;
}

/**
 * A package's account of one call, the `explain` field of `IEnginePackage`.
 *
 * Return the steps that turn `call.args` into `call.result`, in order, or
 * `undefined` for a call this package does not describe. The contract:
 *
 * - The last step's `value` must be `call.result` itself, the same object. A
 *   list that ends anywhere else is discarded, because a derivation that does
 *   not arrive at the answer is worse than none.
 * - Every number a step shows must be one the engine computes, by the same
 *   function the call itself used, never a second calculation of your own.
 * - It must not throw. A hook that throws is treated as having declined.
 *
 * The hook runs only when a host asks for an explanation; ordinary evaluation
 * never calls it.
 */
export type ExplainHook = (call: ExplainCall, context: ExplainContext) => readonly ExplanationStep[] | undefined;

/**
 * Where a line's answer came from: the line, its value, and the lines it read,
 * each followed upwards in the same shape.
 *
 * Returned by `ExpressionEngine.traceLine()` and read by the `inputs of line N`
 * form. A line reads another by a variable it uses (`deposit`), by position
 * (`line 2`, `prev`, `total above`, `sum(line 1 : line 3)`), or by a category
 * tag (`total of #food`); each input records how it was read in `via`.
 */
export interface LineTrace {
	/** The line's 1-based number. */
	readonly line: number;
	/** The variable the line defines (`payment` for `:payment = ...`), or `null` when it defines none. */
	readonly name: string | null;
	/** The line's current answer, or `null` when it has none (a blank or heading line, or one not read). */
	readonly value: Value | null;
	/** How the line that read this one reached it: `deposit`, `line 2`, `prev`, `above`, `#food`. Empty at the root. */
	readonly via: readonly string[];
	/** The lines this one read, in the order its text reads them, each traced the same way. */
	readonly inputs: readonly LineTrace[];
	/** This line is already on the path above it: the lines read each other, so it is not followed again. */
	readonly cycle: boolean;
	/** This line is below the line that read it (a forward reference). */
	readonly forward: boolean;
	/** The depth or size bound stopped the trace here: the line has inputs, and they are not listed. */
	readonly truncated: boolean;
}
