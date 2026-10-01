/**
 * The codes goal seek (`solve line N for x = target`) answers with. The refusals the engine raises while it re-runs the target line are in `CoreErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const GoalSeekErrorCodes = {
	/** A goal seek not written as `solve line N for <name> = <target>`. The message shows the form. */
	GOAL_SEEK_SYNTAX: "GOAL_SEEK_SYNTAX",
	/** A goal seek with no name to vary after `for`. */
	GOAL_SEEK_REQUIRES_VARIABLE_NAME: "GOAL_SEEK_REQUIRES_VARIABLE_NAME",
	/** A goal seek whose target is not a finite number, or whose target line does not give a number for a value tried. */
	GOAL_SEEK_TARGET_NOT_NUMERIC: "GOAL_SEEK_TARGET_NOT_NUMERIC",
	/** A goal seek's target in a unit that cannot be compared with the target line's answer: another measure, or money in another currency. The reader writes the target in the line's unit (#835). */
	GOAL_SEEK_TARGET_UNIT_MISMATCH: "GOAL_SEEK_TARGET_UNIT_MISMATCH",
	/** A goal seek varying a name its target line does not read, which could never move the answer. */
	GOAL_SEEK_VARIABLE_NOT_USED: "GOAL_SEEK_VARIABLE_NOT_USED",
	/** A goal seek whose target line gives no finite value for any input tried across the range, as `2^x` does not far out and `1/x` does not at zero. A value that is not finite for some inputs is a gap in the search, not this (#739). */
	GOAL_SEEK_NON_FINITE: "GOAL_SEEK_NON_FINITE",
	/** A goal seek over a range in which the target line stays on one side of the target wherever it could be worked out, or whose exact answers all lie outside a stated range. The message names the range searched. */
	GOAL_SEEK_NO_SOLUTION: "GOAL_SEEK_NO_SOLUTION",
	/** A goal seek's `between <low> and <high>` whose ends are not two different finite numbers in the unknown's measure (#739). */
	GOAL_SEEK_RANGE_INVALID: "GOAL_SEEK_RANGE_INVALID",
	/** A goal seek whose unknown carries a unit and whose line meets the target at several inputs. A list cannot carry the unit, so each value is named and the reader chooses with a range (#739). */
	GOAL_SEEK_SEVERAL_SOLUTIONS: "GOAL_SEEK_SEVERAL_SOLUTIONS",
	/** A goal seek whose line meets the target at more inputs than a list of answers should hold, as a line built on sin or cos does (#739). */
	GOAL_SEEK_TOO_MANY_SOLUTIONS: "GOAL_SEEK_TOO_MANY_SOLUTIONS",
	/** A goal seek that did not reach the target within its steps, or narrowed to a point where the line jumps across it. */
	GOAL_SEEK_DID_NOT_CONVERGE: "GOAL_SEEK_DID_NOT_CONVERGE",
} as const;
