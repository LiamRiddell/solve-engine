import {
	Value,
	ValueType,
	errorValue,
	numberValue,
	percentageValue,
	rowVectorValue,
	uomValue,
} from "@solve-js/vm/Value";
import type { LineExecutionContext, LineRerun } from "@solve-js/vm/VM";
import { unifyQuantities } from "@solve-js/vm/VMConversion";

/**
 * What-if and sweeps: `line 4 with deposit = 150000` and `line 4 for rate from
 * 3% to 6% step 1%`.
 *
 * Both ask what a line would say if an input were different, without editing
 * the note. The work is a re-run of every line from the top of the document to
 * the target, from their text, with the input held at the value asked for, in
 * a scratch engine the document never sees (`LineExecutionContext.rerunLines`).
 * That is what lets an input reach the target through the lines between: line
 * 3 computes `payment` from `deposit`, line 4 reads `payment`, and overriding
 * `deposit` changes line 4.
 *
 * A what-if answers with the target's value, units and all. A sweep answers
 * with a list of the target's values across a range, the way a spreadsheet's
 * data table does, written as a sentence.
 */

/** The package-local name the what-if plugin function is registered and emitted under. */
export const WHAT_IF_FN_NAME = "whatif";

/** The package-local name the sweep plugin function is registered and emitted under. */
export const SWEEP_FN_NAME = "sweep";

/**
 * The most values one sweep may try. Each value is a full re-run of the lines
 * above the target, so the limit is what keeps a sweep an answer rather than
 * a stall; a range that would take more steps is refused by name.
 */
export const SWEEP_MAX_STEPS = 1000;

/**
 * The most line re-runs one sweep may cost: its steps times the lines each
 * step re-runs. The step limit alone does not bound the work, since a sweep
 * of a thousand values over a line near the bottom of a long document re-runs
 * every line above it a thousand times. Measured at around five microseconds a
 * line, this is about half a second of work at most.
 */
export const SWEEP_MAX_LINE_RUNS = 100_000;

/**
 * Relative slack when deciding whether the last step lands on the end of the
 * range. `3%` to `6%` by `1%` is three steps of 0.01 in binary floating point,
 * which does not sum to exactly 0.06, and the end should still be included.
 */
const STEP_LANDING_TOLERANCE = 1e-9;

/** Significant digits a stepped value is rounded to, to shed the binary noise repeated addition leaves. */
const STEP_SIGNIFICANT_DIGITS = 15;

/**
 * The refusal both forms give where there is no document: the
 * single-expression entry point has no lines to re-run.
 */
function noDocument(form: string): Value {
	return errorValue(
		"WHAT_IF_NO_DOCUMENT",
		`A ${form} only works inside a document, since it re-runs the lines above the one it names. The single-expression entry point has no document to re-run.`,
	);
}

/**
 * Open the re-run for `targetLine` after the checks both forms share, or
 * return the error that stops it.
 *
 * @param context - The asking line's execution context.
 * @param targetLine - The line whose answer is wanted.
 * @param form - "what-if" or "sweep", for the messages.
 * @returns The open session, or an error Value.
 */
function openRerun(context: LineExecutionContext | undefined, targetLine: number, form: string): LineRerun | Value {
	const rerunLines = context?.rerunLines;
	if (!rerunLines) return noDocument(form);
	if (context.lineIndex === targetLine) {
		return errorValue(
			"WHAT_IF_TARGETS_ITSELF",
			`A ${form} cannot name its own line, line ${targetLine}: it would re-run itself.`,
		);
	}
	return rerunLines(targetLine);
}

/** Whether a value is a re-run session rather than the error that stopped one opening. */
function isSession(opened: LineRerun | Value): opened is LineRerun {
	return !(opened instanceof Value);
}

/**
 * Refuse an input no line in the span mentions, which cannot change the
 * answer and is almost always a misspelling.
 *
 * @returns The refusal, or null when the name is used.
 */
function unusedInput(session: LineRerun, name: string, targetLine: number): Value | null {
	if (session.uses(name)) return null;
	return errorValue(
		"WHAT_IF_INPUT_NOT_USED",
		`No line up to line ${targetLine} uses ${name}, so changing it cannot change line ${targetLine}'s answer.`,
	);
}

/**
 * The value an input is overridden with, or the error that stops it: an input
 * that is itself an error is reported as it is, and one still waiting on live
 * data is refused, since the re-run is synchronous.
 */
function checkedInput(value: Value, name: string): Value | null {
	if (value.type === ValueType.Error) return value;
	if (value.type === ValueType.Pending) {
		return errorValue("WHAT_IF_INPUT_PENDING", `The value given for ${name} is still waiting on live data, so there is nothing to re-run with yet.`);
	}
	return null;
}

/**
 * `line N with <name> = <value> [and <name> = <value> ...]`.
 *
 * @param args - The target line number, then each override as a name (a
 * String) and its value, in the order the parselet reads them.
 * @param context - The asking line's execution context, which supplies the
 * re-run. Without a document the handler refuses by name.
 * @returns What the target line says with the overrides in force, or a
 * structured error Value.
 */
export function whatIfHandler(args: Value[], context?: LineExecutionContext): Value {
	const targetLine = args[0].toNumber();
	const overrides = new Map<string, Value>();
	for (let i = 1; i + 1 < args.length; i += 2) {
		const name = String(args[i].value);
		const value = args[i + 1];
		const refused = checkedInput(value, name);
		if (refused) return refused;
		overrides.set(name, value);
	}

	const opened = openRerun(context, targetLine, "what-if");
	if (!isSession(opened)) return opened;
	try {
		for (const name of overrides.keys()) {
			const unused = unusedInput(opened, name, targetLine);
			if (unused) return unused;
		}
		return opened.run(overrides);
	} finally {
		opened.close();
	}
}

/** The kind of value a sweep's range is written in, which each stepped value is rebuilt as. */
type RangeKind = { kind: "number" } | { kind: "percentage" } | { kind: "quantity"; unit: string };

/** Which of the three kinds a bound or step is, or null for a value a range cannot be written in. */
function kindOf(value: Value): RangeKind | null {
	switch (value.type) {
		case ValueType.Number:
			return { kind: "number" };
		case ValueType.Percentage:
			return { kind: "percentage" };
		case ValueType.Uom:
			return value.unit === undefined ? { kind: "number" } : { kind: "quantity", unit: value.unit };
		default:
			return null;
	}
}

/** The range's start, end and step as magnitudes in one unit, with the kind to rebuild values as, or the error that stops the sweep. */
function readRange(start: Value, end: Value, step: Value, name: string): { kind: RangeKind; magnitudes: [number, number, number] } | Value {
	const bounds = [start, end, step];
	for (const bound of bounds) {
		const refused = checkedInput(bound, name);
		if (refused) return refused;
	}
	const kinds = bounds.map(kindOf);
	if (kinds.some((k) => k === null)) {
		return errorValue(
			"SWEEP_RANGE_NOT_NUMERIC",
			`A sweep steps through numbers, percentages or quantities, so its start, end and step must each be one.`,
		);
	}
	const [startKind, endKind, stepKind] = kinds as RangeKind[];
	// One kind for all three, so each stepped value has an unambiguous reading:
	// `from 3% to 6% step 1` could mean one percentage point or a hundred.
	if (startKind.kind !== endKind.kind || startKind.kind !== stepKind.kind) {
		return errorValue(
			"SWEEP_RANGE_MISMATCH",
			`A sweep's start, end and step must be the same kind of value (all plain numbers, all percentages, or all quantities of one kind), so that each step reads one way.`,
		);
	}
	if (startKind.kind === "quantity") {
		// Read in the start's unit, converting the others, so `from 1 km to 1500
		// m step 250 m` steps in kilometres; two measures refuse by name.
		const unified = unifyQuantities(bounds, "stepped through together");
		if (unified instanceof Value) return unified;
		const [s, e, d] = unified.magnitudes;
		return { kind: startKind, magnitudes: [s, e, d] };
	}
	return { kind: startKind, magnitudes: [start.toNumber(), end.toNumber(), step.toNumber()] };
}

/** One stepped value, rebuilt as the kind its range was written in. */
function rangeValue(kind: RangeKind, magnitude: number): Value {
	switch (kind.kind) {
		case "percentage":
			return percentageValue(magnitude);
		case "quantity":
			return uomValue(magnitude, kind.unit);
		default:
			return numberValue(magnitude);
	}
}

/**
 * The values a sweep tries, start to end inclusive, or the error that stops it.
 *
 * The count is worked out first, from the span and the step, so a range that
 * would take too many steps is refused before any of them is built. Each value
 * is `start + i * step` rather than a running sum, so the error of repeated
 * addition never accumulates, and the last value is snapped to the end when it
 * lands within {@link STEP_LANDING_TOLERANCE} of it.
 */
function steppedValues(start: Value, end: Value, step: Value, name: string): Value[] | Value {
	const range = readRange(start, end, step, name);
	if (range instanceof Value) return range;
	const [s, e, d] = range.magnitudes;
	if (![s, e, d].every(Number.isFinite)) {
		return errorValue("SWEEP_RANGE_NOT_NUMERIC", `A sweep's start, end and step must be finite numbers.`);
	}
	if (d === 0) {
		return errorValue("SWEEP_STEP_ZERO", `A sweep's step cannot be zero: it would never reach the end of the range.`);
	}
	const span = e - s;
	if (span !== 0 && Math.sign(span) !== Math.sign(d)) {
		const direction = span > 0 ? "up" : "down";
		return errorValue(
			"SWEEP_STEP_WRONG_SIGN",
			`This sweep runs ${direction} from its start to its end, so its step must be ${span > 0 ? "positive" : "negative"}: as written it moves away from the end and never reaches it.`,
		);
	}
	const exactSteps = span / d;
	const steps = Math.floor(exactSteps + STEP_LANDING_TOLERANCE) + 1;
	if (!(steps <= SWEEP_MAX_STEPS)) {
		return errorValue(
			"SWEEP_TOO_MANY_STEPS",
			`This sweep would try ${Number.isFinite(steps) ? steps.toLocaleString("en-US") : "an unbounded number of"} values, past the limit of ${SWEEP_MAX_STEPS.toLocaleString("en-US")} for one sweep. Use a larger step or a shorter range.`,
		);
	}
	const values: Value[] = [];
	for (let i = 0; i < steps; i++) {
		let magnitude = Number((s + i * d).toPrecision(STEP_SIGNIFICANT_DIGITS));
		if (i === steps - 1 && Math.abs(magnitude - e) <= STEP_LANDING_TOLERANCE * Math.max(Math.abs(e), Math.abs(d))) {
			magnitude = e;
		}
		values.push(rangeValue(range.kind, magnitude));
	}
	return values;
}

/**
 * The kinds of answer a sweep can list. A list here is a vector of plain
 * numbers, so an answer has to have a numeric reading: a number, a
 * percentage (listed as its fraction), a quantity or money (listed as its
 * amount), a true or false (1 or 0), or a whole number in another base.
 */
const LISTABLE: ReadonlySet<ValueType> = new Set([
	ValueType.Number,
	ValueType.Percentage,
	ValueType.Uom,
	ValueType.Boolean,
	ValueType.Hex,
	ValueType.BigInt,
]);

/** An input as a reader would write it, for a message: the magnitude, then the unit or percent sign. */
function describeInput(value: Value): string {
	const magnitude = value.toNumber();
	if (value.type === ValueType.Percentage) return `${Number((magnitude * 100).toPrecision(12))}%`;
	const shown = String(Number(magnitude.toPrecision(12)));
	return value.type === ValueType.Uom && value.unit !== undefined ? `${shown} ${value.unit}` : shown;
}

/**
 * `line N for <name> from <start> to <end> step <step>`.
 *
 * @param args - The target line number, the swept name (a String), then the
 * start, end and step, in the order the parselet reads them.
 * @param context - The asking line's execution context, which supplies the
 * re-run. Without a document the handler refuses by name.
 * @returns The target line's answers across the range as a list, or a
 * structured error Value.
 */
export function sweepHandler(args: Value[], context?: LineExecutionContext): Value {
	const targetLine = args[0].toNumber();
	const name = String(args[1].value);
	const inputs = steppedValues(args[2], args[3], args[4], name);
	if (inputs instanceof Value) return inputs;

	if (Number.isFinite(targetLine) && inputs.length * targetLine > SWEEP_MAX_LINE_RUNS) {
		return errorValue(
			"SWEEP_TOO_MUCH_WORK",
			`Sweeping ${inputs.length.toLocaleString("en-US")} values through the ${targetLine.toLocaleString("en-US")} lines up to line ${targetLine} would re-run ${(inputs.length * targetLine).toLocaleString("en-US")} lines, past the limit of ${SWEEP_MAX_LINE_RUNS.toLocaleString("en-US")} for one sweep. Use a larger step or a shorter range.`,
		);
	}

	const opened = openRerun(context, targetLine, "sweep");
	if (!isSession(opened)) return opened;
	const answers: Value[] = [];
	try {
		const unused = unusedInput(opened, name, targetLine);
		if (unused) return unused;
		for (const input of inputs) {
			const answer = opened.run(new Map([[name, input]]));
			if (answer.type === ValueType.Error) {
				const message = typeof answer.unit === "string" ? answer.unit : String(answer.value);
				return errorValue("SWEEP_STEP_FAILED", `With ${name} at ${describeInput(input)}, line ${targetLine} has no answer: ${message}`);
			}
			if (!LISTABLE.has(answer.type)) {
				return errorValue(
					"SWEEP_ANSWER_NOT_NUMERIC",
					`With ${name} at ${describeInput(input)}, line ${targetLine}'s answer is not a number, and a sweep lists numbers and quantities only.`,
				);
			}
			answers.push(answer);
		}
	} finally {
		opened.close();
	}

	// A list in this engine is a vector of plain numbers, so the answers are
	// read in one unit (the first answer's) and listed as amounts in it. Two
	// answers that measure different things, or one that is not a number at
	// all, have no such reading and are refused by name.
	const unified = unifyQuantities(answers, "listed together");
	if (unified instanceof Value) return unified;
	return rowVectorValue(unified.magnitudes);
}
