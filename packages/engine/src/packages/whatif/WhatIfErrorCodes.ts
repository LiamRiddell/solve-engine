/**
 * The codes what-if lines (`line N with x = 5`) and sweeps (`line N for x from 1 to 10 step 1`) answer with. The refusals the engine raises while it re-runs the document are in `CoreErrorCodes`.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const WhatIfErrorCodes = {
	/** A what-if or a sweep evaluated with no document to re-run. */
	WHAT_IF_NO_DOCUMENT: "WHAT_IF_NO_DOCUMENT",
	/** A what-if or a sweep naming its own line, which it would re-run. */
	WHAT_IF_TARGETS_ITSELF: "WHAT_IF_TARGETS_ITSELF",
	/** A what-if with no name to change after `with`. */
	WHAT_IF_REQUIRES_VARIABLE_NAME: "WHAT_IF_REQUIRES_VARIABLE_NAME",
	/** A what-if that sets the same name twice. */
	WHAT_IF_DUPLICATE_INPUT: "WHAT_IF_DUPLICATE_INPUT",
	/** A what-if changing more inputs than one takes. */
	WHAT_IF_TOO_MANY_INPUTS: "WHAT_IF_TOO_MANY_INPUTS",
	/** A what-if whose input is still waiting on live data. */
	WHAT_IF_INPUT_PENDING: "WHAT_IF_INPUT_PENDING",
	/** A sweep with no name to step through after `for`. */
	SWEEP_REQUIRES_VARIABLE_NAME: "SWEEP_REQUIRES_VARIABLE_NAME",
	/** A sweep with no `step` after its range. */
	SWEEP_REQUIRES_STEP: "SWEEP_REQUIRES_STEP",
	/** A sweep whose start, end or step is not a finite number, percentage or quantity. */
	SWEEP_RANGE_NOT_NUMERIC: "SWEEP_RANGE_NOT_NUMERIC",
	/** A sweep whose start, end and step are not all the same kind of value. */
	SWEEP_RANGE_MISMATCH: "SWEEP_RANGE_MISMATCH",
	/** A sweep with a step of zero, which never reaches its end. */
	SWEEP_STEP_ZERO: "SWEEP_STEP_ZERO",
	/** A sweep whose step moves away from its end. */
	SWEEP_STEP_WRONG_SIGN: "SWEEP_STEP_WRONG_SIGN",
	/** A sweep that would try more values than one sweep allows. */
	SWEEP_TOO_MANY_STEPS: "SWEEP_TOO_MANY_STEPS",
	/** A sweep that would re-run more lines in all than one sweep allows. */
	SWEEP_TOO_MUCH_WORK: "SWEEP_TOO_MUCH_WORK",
	/** A sweep whose steps together reached a limit on the work one evaluation may do. */
	SWEEP_OVER_BUDGET: "SWEEP_OVER_BUDGET",
	/** A sweep one of whose steps failed. The message names the input value and the failure. */
	SWEEP_STEP_FAILED: "SWEEP_STEP_FAILED",
	/** A sweep one of whose answers is not a number or a quantity, which is all a sweep lists. */
	SWEEP_ANSWER_NOT_NUMERIC: "SWEEP_ANSWER_NOT_NUMERIC",
} as const;
