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
	/** A goal seek whose target line gives a value that is not finite for one of the values tried. */
	GOAL_SEEK_NON_FINITE: "GOAL_SEEK_NON_FINITE",
	/** A goal seek over a range in which the target line stays on one side of the target. */
	GOAL_SEEK_NO_SOLUTION: "GOAL_SEEK_NO_SOLUTION",
	/** A goal seek that did not reach the target within its steps, or narrowed to a point where the line jumps across it. */
	GOAL_SEEK_DID_NOT_CONVERGE: "GOAL_SEEK_DID_NOT_CONVERGE",
} as const;
