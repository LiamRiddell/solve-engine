import { Value, ValueType, numberValue, errorValue, symbolicValue, matrixValue } from "@solve-js/vm/Value";
import { valueInUnit } from "@solve-js/vm/MoneyExact";
import { canConvert, convertUnit, getMeasure } from "@solve-js/uom/UomConverter";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import {
	type SymbolicNode,
	varNode,
	constNode,
	freeVariables,
	rationalFromNumber,
	rationalToNumber,
	simplifySymbolic,
} from "@solve-js/symbolic";
import { solveForVariable, type SolveOutcome } from "@solve-js/symbolic/Solve";
import { solveNumerically, NUMERIC_ROOTS_MAX, type SearchRange } from "@solve-js/symbolic/NumericSolve";
import { describeNumber } from "@solve-js/symbolic/NumericEvaluate";

/**
 * Goal seek, `solve line N for <var> = <target>`, with an optional
 * `between <low> and <high>` after the target.
 *
 * Inverts a line against a target: it finds the value of a variable that makes
 * a referenced line's result equal a number, the thing a forwards-only engine
 * otherwise leaves to editing an input and re-reading the answer by hand.
 *
 * Three mechanisms, tried in order:
 *  - Closed form. Reading the target line with the variable bound to itself
 *    (symbolically) yields an expression when the line is closed form in it,
 *    which the algebra solver inverts exactly. `2*x+10 = 30` returns `10`, no
 *    search, and `x^2 = 4` returns both roots, `[-2, 2]`.
 *  - The symbolic reading, searched. An expression the algebra has no method
 *    for (`x + sin(x)`, `2^x`) is searched for crossings the way `solve(...)`
 *    searches, over its own function, without re-running the line; each root
 *    it finds is then checked by one re-run of the line.
 *  - A scan of the line. A line with no symbolic reading (a finance formula,
 *    whose builtin has none) is re-run at a spread of inputs of both signs,
 *    every pair of neighbouring results either side of the target is narrowed
 *    in on, and each crossing found is reported. A sample that fails or is not
 *    finite is a gap in the scan, never the answer: a finance line refuses a
 *    negative deposit, and the scan passes over those inputs.
 *
 * Without a stated range the search looks from minus to plus a billion. The
 * scan and its narrowing share one ceiling, `config.vm.maxGoalSeekIterations`
 * re-runs, and each re-run is charged to the pass as well, so an untrusted
 * document can never make it spin. Finding no crossing, a line that jumps
 * across the target rather than passing through it, and running out of steps
 * are each a structured error, never a hang and never a guess. So is a
 * crossing the scan steps over: two crossings closer together than its
 * samples, or one where the line only touches the target, are not seen, which
 * is why the refusal names the range and offers a narrower one.
 */

/** How far either side of zero the search looks when no range is stated. */
export const GOAL_SEEK_SEARCH_LIMIT = 1e9;
/** The most samples the line scan takes before narrowing in on a crossing; fewer when the iteration cap is lower. */
export const GOAL_SEEK_SCAN_SAMPLES = 40;
/** Fallback iteration cap when the context carries none (single-expression paths never reach the search, so this only guards a malformed context). */
const FALLBACK_MAX_ITERATIONS = 100;
/** Absolute tolerance on the target value, so a target of zero still has a floor to converge against. */
const ABSOLUTE_VALUE_TOLERANCE = 1e-9;
/** Relative tolerance on the target value, so a large target is matched to the same number of significant figures as a small one. */
const RELATIVE_VALUE_TOLERANCE = 1e-9;
/** A bracket this narrow, relative to its size, that still straddles the target holds a jump rather than a crossing. */
const COLLAPSE_RELATIVE_WIDTH = 1e-12;
/** Largest imaginary part a numerically-found root may carry and still count as real. */
const REAL_ROOT_IMAGINARY_TOLERANCE = 1e-9;

/**
 * Refusals that say something about the line or the pass rather than about
 * the input tried, so the search stops at the first one instead of treating
 * it as a gap and trying again: the pass's work budget, and the target line
 * being one goal seek cannot re-run at all.
 */
const STOPS_THE_SEARCH: ReadonlySet<string> = new Set([
	"PASS_WORK_BUDGET_EXCEEDED",
	"DOCUMENT_ELEMENT_LIMIT_EXCEEDED",
	"WHAT_IF_IN_GOAL_SEEK",
	"GOAL_SEEK_NESTED",
	"GOAL_SEEK_LINE_NOT_READY",
	"GOAL_SEEK_TARGET_IS_DEFINITION",
	"GOAL_SEEK_ASYNC_UNSUPPORTED",
	"GOAL_SEEK_NO_DOCUMENT",
]);

/** The package-local name the goal-seek plugin function is registered and emitted under (`solve line N for <var> = <target>`). */
export const GOAL_SEEK_FN_NAME = "goalseek";

/**
 * Solve for the variable that makes a line equal a target.
 *
 * @param args - Three or five values, in the order the parselet pushes them:
 * the target line number, the variable name as a String, the target as a
 * Number or a quantity, and optionally the two ends of the range to search.
 * @param context - Per-line execution context. Supplies the re-evaluation
 * primitive and the iteration cap; without a document the handler returns a
 * structured error rather than guessing, since there is no line to solve.
 * @returns The solved input, in the unit the unknown has in the note (a Number
 * for a plain unknown); a row of them when the line crosses the target more
 * than once; or a structured error Value when there is no solution in range,
 * the search does not converge, or the target line cannot be probed.
 */
export function goalSeekHandler(args: Value[], context?: LineExecutionContext): Value {
	const probe = context?.evaluateLineWithBinding;
	const getLineReads = context?.getLineReads;
	if (!probe || !getLineReads) {
		// Two callers reach here, and the message says which (#617): the batch
		// pass has a document (it can count its lines) but evaluates each line
		// once, and the single-expression entry point has no document at all.
		// It used to give both the second sentence, which was wrong for the first.
		return errorValue(
			"GOAL_SEEK_NO_DOCUMENT",
			context?.getLineCount
				? "Goal seek re-runs another line, which the batch pass (parseDocument) cannot do: it evaluates each line once. evaluateDocument and a live editor can solve it."
				: "Goal seek only works inside a document, since it re-runs another line. The single-expression entry point has no document to solve against.",
		);
	}

	const targetLine = args[0].toNumber();
	const varName = typeof args[1].value === "string" ? (args[1].value as string) : String(args[1].value);
	const targetArg = args[2];
	if (targetArg.type !== ValueType.Number && targetArg.type !== ValueType.Uom) {
		return errorValue("GOAL_SEEK_TARGET_NOT_NUMERIC", `Goal seek's target must be a number, as in "solve line ${targetLine} for ${varName} = 900".`);
	}
	// The line is solved in its own unit, so a target written in another unit
	// of the same measure is read in that one first: 3,000 m against a line in
	// kilometres is 3 (#835). The line's answer as the note stands says which
	// unit that is.
	const lineUnit = unitOf(context?.getLineResult?.(targetLine));
	const target = targetInLineUnit(targetArg, lineUnit, targetLine);
	if (target instanceof Value) return target;
	if (!Number.isFinite(target)) {
		return errorValue("GOAL_SEEK_TARGET_NOT_NUMERIC", "Goal seek's target is not a finite number.");
	}

	// A seek that names its own line would re-run itself. Refused by name,
	// rather than reported as a line that does not use the variable, which is
	// true of it and not the point.
	if (context?.lineIndex === targetLine) {
		return errorValue("GOAL_SEEK_NESTED", "A goal-seek line cannot target itself, since it already re-runs its target many times.");
	}

	// Refuse before any searching when the target line does not read the
	// variable: nothing about changing it could move that line's result, and a
	// silent "no solution" would be a confusing way to say so.
	const reads = getLineReads(targetLine);
	if (reads === undefined) {
		return errorValue("GOAL_SEEK_LINE_NOT_READY", `Line ${targetLine} has no evaluated expression to solve (forward reference, out of range, or not an expression).`);
	}
	if (!reads.includes(varName)) {
		return errorValue("GOAL_SEEK_VARIABLE_NOT_USED", `Line ${targetLine} does not use ${varName}, so changing ${varName} cannot move its result toward ${describeNumber(target)}.`);
	}

	// The unknown keeps the unit the note gives it: a price in pounds is solved
	// as an amount of pounds, and its answer is one (#835).
	const unknownUnit = unitOf(context?.getVariable?.(varName));
	const stated = args.length >= 5 ? readGoalSeekRange(args[3], args[4], unknownUnit) : undefined;
	if (stated instanceof Value) return stated;

	const seek: Seek = {
		probe,
		targetLine,
		variable: varName,
		target,
		unknownUnit,
		lineUnit,
		range: stated ?? { lower: -GOAL_SEEK_SEARCH_LIMIT, upper: GOAL_SEEK_SEARCH_LIMIT },
		stated: stated !== undefined,
		budget: Math.max(1, Math.floor(context.goalSeekMaxIterations ?? FALLBACK_MAX_ITERATIONS)),
		spent: 0,
	};

	// ── Closed form, and the symbolic reading searched ──
	// Bind the variable to itself and read the line back symbolically. A closed
	// form comes back as an expression the algebra solver inverts exactly; a
	// line with no symbolic reading (its builtin has none) comes back as an
	// error Value, and the scan below takes over.
	const symbolic = probe(targetLine, varName, symbolicValue(varNode(varName)), true);
	if (symbolic.type === ValueType.Error && STOPS_THE_SEARCH.has(String(symbolic.value))) return symbolic;
	if (symbolic.type === ValueType.Symbolic) {
		const tree = symbolic.value as SymbolicNode;
		const exact = solveClosedForm(tree, target, varName);
		if (exact !== null) {
			const inside = exact.filter((root) => inRange(root, seek.range));
			if (inside.length === 0 && seek.stated) return noSolution(seek, "none of the values that make it so lies in that range");
			const checked = checkRoots(seek, inside);
			if (checked !== null) return checked;
		}
		const searched = searchSymbolic(seek, tree);
		if (searched !== null) return searched;
	}

	// ── The line, scanned ──
	return scanLine(seek);
}

/** One goal seek in progress: what it solves, where it looks, and what it has spent. */
interface Seek {
	readonly probe: NonNullable<LineExecutionContext["evaluateLineWithBinding"]>;
	readonly targetLine: number;
	readonly variable: string;
	readonly target: number;
	readonly unknownUnit: string | undefined;
	readonly lineUnit: string | undefined;
	readonly range: SearchRange;
	readonly stated: boolean;
	/** The most re-runs of the target line this seek may make. */
	readonly budget: number;
	/** The re-runs made so far. */
	spent: number;
}

/**
 * The unit a value carries, or undefined for a plain number or no value.
 *
 * @param v - The value, which may be absent.
 */
export function unitOf(v: Value | undefined): string | undefined {
	return v?.type === ValueType.Uom && typeof v.unit === "string" && v.unit !== "" ? v.unit : undefined;
}

/**
 * The goal-seek answer in the unit its unknown is in: an amount of money stays
 * exact to the cent, a quantity is a quantity, and a plain unknown a number.
 *
 * @param n - The solved magnitude.
 * @param unit - The unknown's unit, or undefined when it is a plain number.
 */
export function inUnknownUnit(n: number, unit: string | undefined): Value {
	return unit === undefined ? numberValue(n) : valueInUnit(numberValue(n), unit);
}

/** Whether a unit is a currency, which only an exchange rate converts. */
function isCurrency(unit: string): boolean {
	return getMeasure(unit) === "currency";
}

/**
 * The target as a number in the target line's unit, or the refusal when the
 * two cannot be compared.
 *
 * A plain target, or a line with no unit, is read as written. A target in the
 * line's unit is its magnitude, and one in another unit of the same measure is
 * converted (`3,000 m` against a line in kilometres is 3). A target that
 * measures something else, or is money in another currency, is refused with
 * `GOAL_SEEK_TARGET_UNIT_MISMATCH` rather than compared by magnitude, which
 * would solve for the wrong number.
 *
 * @param target - The target as the goal-seek line wrote it.
 * @param lineUnit - The unit the target line answers in, or undefined.
 * @param targetLine - The target line's number, for the message.
 */
export function targetInLineUnit(target: Value, lineUnit: string | undefined, targetLine: number): number | Value {
	const targetUnit = unitOf(target);
	if (targetUnit === undefined || lineUnit === undefined || targetUnit === lineUnit) return target.toNumber();
	if (!isCurrency(targetUnit) && !isCurrency(lineUnit) && canConvert(targetUnit, lineUnit)) {
		return convertUnit(target.toNumber(), targetUnit, lineUnit);
	}
	return errorValue(
		"GOAL_SEEK_TARGET_UNIT_MISMATCH",
		`Line ${targetLine} answers in ${lineUnit} and the target is in ${targetUnit}, so the two cannot be compared. Write the target in ${lineUnit}.`,
	);
}

/**
 * A probe's answer as a number in the line's unit, converting a quantity that
 * came back in another unit of the same measure.
 *
 * @param result - The probe's answer, already known to be a number or a quantity.
 * @param lineUnit - The unit the target was read in, or undefined.
 */
function magnitudeInLineUnit(result: Value, lineUnit: string | undefined): number {
	const resultUnit = unitOf(result);
	if (resultUnit === undefined || lineUnit === undefined || resultUnit === lineUnit) return result.toNumber();
	if (!isCurrency(resultUnit) && !isCurrency(lineUnit) && canConvert(resultUnit, lineUnit)) {
		return convertUnit(result.toNumber(), resultUnit, lineUnit);
	}
	return result.toNumber();
}

/**
 * The stated range of a goal seek, `between <low> and <high>`, as plain
 * magnitudes in the unknown's unit.
 *
 * Each end is a plain number, or a quantity in the unknown's own measure
 * (converted into its unit), or money in its own currency. The ends may come in
 * either order, and must be finite and different.
 *
 * @param lowValue - The first end as written.
 * @param highValue - The second end as written.
 * @param unknownUnit - The unit the unknown is in, or undefined for a plain number.
 * @returns The range, lowest end first, or a `GOAL_SEEK_RANGE_INVALID` refusal.
 */
export function readGoalSeekRange(lowValue: Value, highValue: Value, unknownUnit: string | undefined): SearchRange | Value {
	const ends: number[] = [];
	for (const end of [lowValue, highValue]) {
		if (end.type === ValueType.Error || end.type === ValueType.Pending) return end;
		if (end.type !== ValueType.Number && end.type !== ValueType.Uom) {
			return errorValue("GOAL_SEEK_RANGE_INVALID", `Goal seek's range needs two numbers, as in "between 0 and 100".`);
		}
		const endUnit = unitOf(end);
		let magnitude = end.toNumber();
		if (endUnit !== undefined && unknownUnit !== undefined && endUnit !== unknownUnit) {
			if (isCurrency(endUnit) || isCurrency(unknownUnit) || !canConvert(endUnit, unknownUnit)) {
				return errorValue("GOAL_SEEK_RANGE_INVALID", `The unknown is in ${unknownUnit} and the range is in ${endUnit}, so the range cannot be read. Write the range in ${unknownUnit}.`);
			}
			magnitude = convertUnit(magnitude, endUnit, unknownUnit);
		}
		if (!Number.isFinite(magnitude)) {
			return errorValue("GOAL_SEEK_RANGE_INVALID", "Goal seek's range must have two finite ends.");
		}
		ends.push(magnitude);
	}
	if (ends[0] === ends[1]) {
		return errorValue("GOAL_SEEK_RANGE_INVALID", "Goal seek's range must have two different ends.");
	}
	return { lower: Math.min(ends[0], ends[1]), upper: Math.max(ends[0], ends[1]) };
}

/** Whether a value lies in a range, ends included. */
function inRange(x: number, range: SearchRange): boolean {
	return x >= range.lower && x <= range.upper;
}

/** `between -1000000000 and 1000000000`, for a message. */
function describeRange(range: SearchRange): string {
	return `between ${describeNumber(range.lower)} and ${describeNumber(range.upper)}`;
}

/** How close a line's result must come to the target to count as reaching it. */
function toleranceFor(target: number): number {
	return Math.max(ABSOLUTE_VALUE_TOLERANCE, Math.abs(target) * RELATIVE_VALUE_TOLERANCE);
}

/**
 * The answer for a set of inputs that each make the line reach the target.
 *
 * One is the answer, in the unknown's unit. Several are reported as a row, as
 * `solve(...)` reports them (`[-2, 2]`), rather than one picked. A row does not
 * carry a unit, so an unknown in one is refused with each value named instead,
 * and the reader chooses with a range. More than `NUMERIC_ROOTS_MAX` is
 * declined, since that is what a line that repeats forever looks like.
 *
 * @param seek - The goal seek.
 * @param roots - The inputs found, in any order.
 */
function report(seek: Seek, roots: readonly number[]): Value {
	const sorted = [...new Set(roots.map((r) => r + 0))].sort((a, b) => a - b);
	if (sorted.length === 1) return inUnknownUnit(sorted[0], seek.unknownUnit);
	if (sorted.length > NUMERIC_ROOTS_MAX) return tooManySolutions(seek);
	if (seek.unknownUnit === undefined) return matrixValue(1, sorted.length, sorted);
	const shown = sorted.map((r) => formatValue(inUnknownUnit(r, seek.unknownUnit)).replace(/^=\s*/, ""));
	return errorValue(
		"GOAL_SEEK_SEVERAL_SOLUTIONS",
		`${sorted.length} values of ${seek.variable} make line ${seek.targetLine} equal ${describeNumber(seek.target)}: ${shown.join(", ")}. Name a range after the target to choose one, as in "solve line ${seek.targetLine} for ${seek.variable} = ${describeNumber(seek.target)} between 0 and ${describeNumber(Math.max(1, Math.ceil(Math.abs(sorted[sorted.length - 1]) * 2)))}".`,
	);
}

/**
 * The refusal for a line that meets the target more often than a list of
 * answers should run to.
 *
 * @param range - The range the roots were counted in, when it is not the seek's own.
 */
function tooManySolutions(seek: Seek, range: SearchRange = seek.range): Value {
	return errorValue(
		"GOAL_SEEK_TOO_MANY_SOLUTIONS",
		`More than ${NUMERIC_ROOTS_MAX} values of ${seek.variable} ${describeRange(range)} make line ${seek.targetLine} equal ${describeNumber(seek.target)}, as a line that repeats does. Name a narrower range after the target, as in "solve line ${seek.targetLine} for ${seek.variable} = ${describeNumber(seek.target)} between 0 and 1".`,
	);
}

/** The refusal for a search that found no input reaching the target, with the reason it gives. */
function noSolution(seek: Seek, why: string): Value {
	const hint = seek.stated ? "" : ` To search elsewhere, name a range after the target, as in "solve line ${seek.targetLine} for ${seek.variable} = ${describeNumber(seek.target)} between 0 and 100".`;
	return errorValue(
		"GOAL_SEEK_NO_SOLUTION",
		`No value of ${seek.variable} ${describeRange(seek.range)} was found that makes line ${seek.targetLine} equal ${describeNumber(seek.target)}: ${why}.${hint}`,
	);
}

/**
 * Inverts a closed-form relationship exactly, or returns null so the caller
 * falls back to a search.
 *
 * Returns null rather than an error for every case it cannot answer cleanly (an
 * unsolvable or partial outcome, only complex or irrational roots, no finite
 * root), because those are not failures of goal seek, they are simply where the
 * search is the better tool.
 *
 * @param lhs - The line read back as an expression in the variable.
 * @param target - The value the line should equal.
 * @param variable - The unknown being solved for.
 * @returns Every finite real root, or null.
 */
export function solveClosedForm(lhs: SymbolicNode, target: number, variable: string): number[] | null {
	const rhs = constNode(rationalFromNumber(target));
	let outcome: SolveOutcome;
	try {
		outcome = solveForVariable(lhs, rhs, variable);
	} catch {
		return null;
	}
	if (outcome.kind !== "roots") return null;

	const candidates: number[] = [];
	for (const node of outcome.exact) {
		// Only a root that simplifies to a bare rational has a numeric value to
		// return; a surd or complex root is left to the search.
		const simplified = simplifySymbolic(node);
		if (simplified.kind === "const") {
			const value = rationalToNumber(simplified.value);
			if (Number.isFinite(value)) candidates.push(value);
		}
	}
	for (const root of outcome.approximate) {
		if (Math.abs(root.im) <= REAL_ROOT_IMAGINARY_TOLERANCE && Number.isFinite(root.re)) candidates.push(root.re);
	}
	return candidates.length === 0 ? null : candidates;
}

/** One re-run of the target line: its result in the line's unit, a gap (the line failed or is not finite there), or a refusal that ends the search. */
type Sample = { readonly value: number } | { readonly gap: Value } | { readonly stop: Value };

/**
 * Re-runs the target line with the unknown set to `candidate`, counting the
 * re-run against the seek's budget.
 */
function sample(seek: Seek, candidate: number): Sample {
	seek.spent++;
	const result = seek.probe(seek.targetLine, seek.variable, inUnknownUnit(candidate, seek.unknownUnit), false);
	if (result.type === ValueType.Error) {
		return STOPS_THE_SEARCH.has(String(result.value)) ? { stop: result } : { gap: result };
	}
	if (result.type === ValueType.Pending) return { stop: errorValue("GOAL_SEEK_ASYNC_UNSUPPORTED", `Line ${seek.targetLine} is waiting for live data, which a re-run cannot fetch.`) };
	if (result.type !== ValueType.Number && result.type !== ValueType.Uom) {
		return { gap: errorValue("GOAL_SEEK_TARGET_NOT_NUMERIC", `Line ${seek.targetLine} did not produce a number when ${seek.variable} was set to ${describeNumber(candidate)}, so goal seek cannot compare it to the target.`) };
	}
	const numeric = magnitudeInLineUnit(result, seek.lineUnit);
	if (!Number.isFinite(numeric)) return { gap: errorValue("GOAL_SEEK_NON_FINITE", `Line ${seek.targetLine}'s result is not finite when ${seek.variable} is ${describeNumber(candidate)}.`) };
	return { value: numeric };
}

/**
 * Searches the line's symbolic reading for crossings, as `solve(...)` does,
 * and checks each one by re-running the line.
 *
 * @returns The answer, or null when the reading cannot be searched, the search
 * found nothing, or a root it found is not one the line itself reaches; the
 * scan of the line then decides.
 */
function searchSymbolic(seek: Seek, tree: SymbolicNode): Value | null {
	// Another unknown in the reading has no value to search with.
	const free = freeVariables(tree);
	if (free.size !== 1 || !free.has(seek.variable)) return null;
	const outcome = solveNumerically(tree, constNode(rationalFromNumber(seek.target)), seek.variable, seek.stated ? seek.range : undefined);
	if (outcome.kind === "tooMany") return tooManySolutions(seek, outcome.range);
	if (outcome.kind !== "roots") return null;
	return checkRoots(seek, outcome.roots);
}

/**
 * The answer for roots found from the line's symbolic reading, once one
 * re-run of the line at each has confirmed it reaches the target there.
 *
 * The reading is the line with its unknown bound to itself, which can differ
 * from the line as it runs: a reading has no units, so `price^2` reads as a
 * polynomial where the line itself refuses to square money. A root the line
 * does not reach there is not an answer.
 *
 * @returns The answer, a refusal that ends the search, or null when a root
 * failed its check or there is none, and the scan of the line decides.
 */
function checkRoots(seek: Seek, roots: readonly number[]): Value | null {
	if (roots.length === 0 || roots.length > NUMERIC_ROOTS_MAX) return null;
	// A looser check than the search's own tolerance: the reading is exact and
	// the line computes in doubles, so they agree to rounding, not to the bit.
	const tolerance = Math.max(toleranceFor(seek.target), Math.abs(seek.target) * 1e-6);
	for (const root of roots) {
		if (seek.spent >= seek.budget) return null;
		const check = sample(seek, root);
		if ("stop" in check) return check.stop;
		if (!("value" in check) || Math.abs(check.value - seek.target) > tolerance) return null;
	}
	return report(seek, roots);
}

/**
 * The inputs the line scan samples: the stated range evenly, or the default
 * range spread evenly in `asinh(x)`, dense near zero and sparse far out, with
 * zero and both ends sampled exactly.
 *
 * @param range - Where to look.
 * @param stated - Whether the reader named the range.
 * @param count - How many samples, at least three.
 */
export function scanGrid(range: SearchRange, stated: boolean, count: number): number[] {
	const n = Number.isFinite(count) ? Math.max(3, Math.floor(count)) : 3;
	const xs: number[] = [];
	if (stated) {
		const width = range.upper - range.lower;
		for (let i = 0; i < n; i++) xs.push(range.lower + (width * i) / (n - 1));
		xs[n - 1] = range.upper;
		return xs;
	}
	const low = Math.asinh(range.lower);
	const high = Math.asinh(range.upper);
	for (let i = 0; i < n; i++) xs.push(Math.sinh(low + ((high - low) * i) / (n - 1)));
	xs[0] = range.lower;
	xs[n - 1] = range.upper;
	// Zero is where many a target is met (a balance, a difference), so it is
	// sampled exactly when the range spans it.
	if (range.lower < 0 && range.upper > 0) {
		let nearest = 0;
		for (let i = 1; i < n; i++) if (Math.abs(xs[i]) < Math.abs(xs[nearest])) nearest = i;
		xs[nearest] = 0;
	}
	return xs;
}

/**
 * Scans the line across the range, then narrows in on each crossing.
 *
 * @returns The answer, or the refusal that says why there is none.
 */
function scanLine(seek: Seek): Value {
	const tolerance = toleranceFor(seek.target);
	// Half the budget, at most, goes on the scan, so there are steps left to
	// narrow in with; a very low cap still scans three points.
	const count = Math.min(GOAL_SEEK_SCAN_SAMPLES, Math.max(3, Math.floor(seek.budget / 2)));
	const xs = scanGrid(seek.range, seek.stated, count);
	const ys: (number | null)[] = [];
	let firstGap: Value | null = null;
	const roots: number[] = [];
	for (let i = 0; i < xs.length; i++) {
		const s = sample(seek, xs[i]);
		if ("stop" in s) return s.stop;
		if ("gap" in s) {
			firstGap ??= s.gap;
			ys.push(null);
			continue;
		}
		const f = s.value - seek.target;
		ys.push(f);
		// A sample on the target is an answer, except at an end of the default
		// range, where a line that only approaches the target (`1/x` towards
		// zero) comes within the tolerance without reaching it.
		const atDefaultEnd = !seek.stated && (i === 0 || i === xs.length - 1);
		if (Math.abs(f) <= tolerance && (!atDefaultEnd || f === 0)) roots.push(xs[i]);
	}

	if (ys.every((y) => y === null)) {
		// Every input tried failed. When they failed for a reason of the line's
		// own, that reason is the answer; a line that is never finite says so.
		if (firstGap !== null && firstGap.value !== "GOAL_SEEK_NON_FINITE") return firstGap;
		return errorValue("GOAL_SEEK_NON_FINITE", `Line ${seek.targetLine}'s result is not finite for any value of ${seek.variable} goal seek tried ${describeRange(seek.range)}.`);
	}

	let jumped: number | null = null;
	let exhausted = false;
	for (let i = 1; i < xs.length; i++) {
		const a = ys[i - 1];
		const b = ys[i];
		if (a === null || b === null || a === 0 || b === 0 || (a < 0) === (b < 0)) continue;
		if (Math.abs(a) <= tolerance || Math.abs(b) <= tolerance) continue;
		const narrowed = narrow(seek, xs[i - 1], a, xs[i], b, tolerance);
		if ("stop" in narrowed) return narrowed.stop;
		if ("root" in narrowed) roots.push(narrowed.root);
		else if ("jump" in narrowed) jumped ??= narrowed.jump;
		else exhausted = true;
		if (roots.length > NUMERIC_ROOTS_MAX) break;
	}

	if (roots.length > 0) return report(seek, roots);
	if (exhausted) {
		return errorValue(
			"GOAL_SEEK_DID_NOT_CONVERGE",
			`Goal seek did not bring line ${seek.targetLine} within tolerance of ${describeNumber(seek.target)} by varying ${seek.variable} in ${seek.budget} steps.`,
		);
	}
	if (jumped !== null) {
		return errorValue(
			"GOAL_SEEK_DID_NOT_CONVERGE",
			`Goal seek narrowed ${seek.variable} to a single point near ${describeNumber(jumped)} without line ${seek.targetLine} reaching ${describeNumber(seek.target)}: the relationship jumps across the target rather than passing through it.`,
		);
	}
	return noSolution(seek, "wherever goal seek could work it out, its result stays on one side of the target");
}

/** What narrowing one bracket found: a root, a jump across the target, the budget spent first, or a refusal that ends the search. */
type Narrowed = { readonly root: number } | { readonly jump: number } | { readonly exhausted: true } | { readonly stop: Value };

/**
 * Narrows in on a crossing between two inputs whose results lie either side of
 * the target, by the Illinois method: a straight line through the two ends
 * picks the next input, and an end kept twice running has its weight halved,
 * so a curved line cannot pin one end in place.
 *
 * A step that lands on a gap, or a bracket that closes to two neighbouring
 * doubles without the line reaching the target, is a jump or a pole (`1/x`
 * changes sign at zero without being zero), never a root.
 *
 * @param a - The lower input, with `fa` its result less the target.
 * @param b - The upper input, with `fb` its result less the target.
 */
function narrow(seek: Seek, a: number, fa: number, b: number, fb: number, tolerance: number): Narrowed {
	let side = 0;
	while (seek.spent < seek.budget) {
		let c = (a * fb - b * fa) / (fb - fa);
		if (!(c > a && c < b)) c = a + (b - a) / 2;
		if (!(c > a && c < b)) return { jump: a };
		const s = sample(seek, c);
		if ("stop" in s) return s;
		if ("gap" in s) return { jump: c };
		const fc = s.value - seek.target;
		if (Math.abs(fc) <= tolerance) return { root: c };
		if ((fc < 0) === (fb < 0)) {
			b = c;
			fb = fc;
			if (side === -1) fa /= 2;
			side = -1;
		} else {
			a = c;
			fa = fc;
			if (side === 1) fb /= 2;
			side = 1;
		}
		// Closed to a width too narrow to matter, and still either side of
		// the target: a jump rather than a crossing.
		if (b - a <= COLLAPSE_RELATIVE_WIDTH * Math.max(1, Math.abs(a), Math.abs(b))) return { jump: c };
	}
	return { exhausted: true };
}
