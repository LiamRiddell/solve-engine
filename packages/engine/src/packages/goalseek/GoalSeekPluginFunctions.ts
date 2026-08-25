import { Value, ValueType, numberValue, errorValue, symbolicValue } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import {
	type SymbolicNode,
	varNode,
	constNode,
	rationalFromNumber,
	rationalToNumber,
	simplifySymbolic,
} from "@solve-js/symbolic";
import { solveForVariable, type SolveOutcome } from "@solve-js/symbolic/Solve";

/**
 * Goal seek, `solve line N for <var> = <target>`.
 *
 * Inverts a line against a target: it finds the value of a variable that makes
 * a referenced line's result equal a number, the thing a forwards-only engine
 * otherwise leaves to editing an input and re-reading the answer by hand.
 *
 * Two mechanisms, chosen automatically per the issue's own framing:
 *  - Closed form. Reading the target line with the variable bound to itself
 *    (symbolically) yields an expression when the line is closed form in it,
 *    which the algebra solver inverts exactly. `2*x+10 = 30` returns `10`, no
 *    search.
 *  - Bounded numeric search. When the relationship is not closed form (a
 *    finance formula, say, whose builtin has no symbolic reading), a bisection
 *    over a fixed, non-negative domain narrows in on the input. It assumes the
 *    relationship is monotonic over that domain (one crossing of the target)
 *    and is capped hard at `config.vm.maxGoalSeekIterations` steps, so an
 *    untrusted document can never make it spin. No bracket, a non-finite
 *    sample, or exhausting the cap is a structured error, never a hang and
 *    never a guess.
 *
 * The search domain and tolerances are the deliberate v1 decisions: a positive
 * input up to a billion (deposits, rates, amounts, years are all positive, and
 * a strictly-positive floor sidesteps the finance builtins that reject a zero
 * principal), and convergence judged on the target value rather than the input,
 * so the answer is "close enough on screen" regardless of how steep the
 * relationship is. A solution outside that domain, or a non-monotonic
 * relationship with several crossings, is out of scope for this slice and
 * reported rather than half-answered.
 */

/**
 * Lowest input the numeric search will consider. Goal-seek quantities
 * (deposits, rates, amounts, durations) are positive; a strictly-positive floor
 * rather than zero also keeps the bottom endpoint valid for the finance
 * builtins that reject a zero principal, while staying small enough to read as
 * "effectively nothing" (a rate this near zero is the 0% floor).
 */
const SEARCH_LOWER_BOUND = 1e-9;
/** Highest input the numeric search will consider, far above any realistic deposit/rate/amount yet finite. */
const SEARCH_UPPER_BOUND = 1e9;
/** Fallback iteration cap when the context carries none (single-expression paths never reach the search, so this only guards a malformed context). */
const FALLBACK_MAX_ITERATIONS = 100;
/** Absolute tolerance on the target value, so a target of zero still has a floor to converge against. */
const ABSOLUTE_VALUE_TOLERANCE = 1e-9;
/** Relative tolerance on the target value, so a large target is matched to the same number of significant figures as a small one. */
const RELATIVE_VALUE_TOLERANCE = 1e-9;
/** Interval width at which the search declares the relationship discontinuous rather than continuing to halve a point. */
const INTERVAL_COLLAPSE_WIDTH = 1e-12;
/** Largest imaginary part a numerically-found root may carry and still count as real. */
const REAL_ROOT_IMAGINARY_TOLERANCE = 1e-9;

/** The package-local name the goal-seek plugin function is registered and emitted under (`solve line N for <var> = <target>`). */
export const GOAL_SEEK_FN_NAME = "goalseek";

/**
 * Solve for the variable that makes a line equal a target.
 *
 * @param args - Three values, in the order the parselet pushes them: the target
 * line number, the variable name as a String, and the target as a Number.
 * @param context - Per-line execution context. Supplies the re-evaluation
 * primitive and the iteration cap; without a document the handler returns a
 * structured error rather than guessing, since there is no line to solve.
 * @returns The solved input as a Number, or a structured error Value when there
 * is no solution in range, the search does not converge, or the target line
 * cannot be probed.
 */
export function goalSeekHandler(args: Value[], context?: LineExecutionContext): Value {
	const probe = context?.evaluateLineWithBinding;
	const getLineReads = context?.getLineReads;
	if (!probe || !getLineReads) {
		return errorValue(
			"GOAL_SEEK_NO_DOCUMENT",
			"Goal seek only works inside a document, since it re-runs another line. The single-expression entry point has no document to solve against.",
		);
	}

	const targetLine = args[0].toNumber();
	const varName = typeof args[1].value === "string" ? (args[1].value as string) : String(args[1].value);
	const targetArg = args[2];
	if (targetArg.type !== ValueType.Number && targetArg.type !== ValueType.Uom) {
		return errorValue("GOAL_SEEK_TARGET_NOT_NUMERIC", `Goal seek's target must be a number, as in "solve line ${targetLine} for ${varName} = 900".`);
	}
	const target = targetArg.toNumber();
	if (!Number.isFinite(target)) {
		return errorValue("GOAL_SEEK_TARGET_NOT_NUMERIC", "Goal seek's target is not a finite number.");
	}

	// Refuse before any searching when the target line does not read the
	// variable: nothing about changing it could move that line's result, and a
	// silent "no solution" would be a confusing way to say so.
	const reads = getLineReads(targetLine);
	if (reads === undefined) {
		return errorValue("GOAL_SEEK_LINE_NOT_READY", `Line ${targetLine} has no evaluated expression to solve (forward reference, out of range, or not an expression).`);
	}
	if (!reads.includes(varName)) {
		return errorValue("GOAL_SEEK_VARIABLE_NOT_USED", `Line ${targetLine} does not use ${varName}, so changing ${varName} cannot move its result toward ${target}.`);
	}

	// ── Closed-form fast path ──
	// Bind the variable to itself and read the line back symbolically. A closed
	// form comes back as an expression the algebra solver inverts exactly; a
	// non-closed-form line (its builtin has no symbolic reading) comes back as an
	// error Value, and the numeric search below takes over.
	const symbolic = probe(targetLine, varName, symbolicValue(varNode(varName)), true);
	if (symbolic.type === ValueType.Symbolic) {
		const exact = solveClosedForm(symbolic.value as SymbolicNode, target, varName);
		if (exact !== null) return numberValue(exact);
	}

	// ── Bounded numeric search ──
	const maxIterations = context.goalSeekMaxIterations ?? FALLBACK_MAX_ITERATIONS;
	return bisect(probe, targetLine, varName, target, maxIterations);
}

/**
 * Inverts a closed-form relationship exactly, or returns null so the caller
 * falls back to the numeric search.
 *
 * Returns null rather than an error for every case it cannot answer cleanly (an
 * unsolvable or partial outcome, only complex or irrational roots, no finite
 * root), because those are not failures of goal seek, they are simply where the
 * numeric search is the better tool.
 *
 * @param lhs - The line read back as an expression in the variable.
 * @param target - The value the line should equal.
 * @param variable - The unknown being solved for.
 * @returns A finite real root, preferring one inside the numeric search domain, or null.
 */
function solveClosedForm(lhs: SymbolicNode, target: number, variable: string): number | null {
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
		// return; a surd or complex root is left to the numeric search.
		const simplified = simplifySymbolic(node);
		if (simplified.kind === "const") {
			const value = rationalToNumber(simplified.value);
			if (Number.isFinite(value)) candidates.push(value);
		}
	}
	for (const root of outcome.approximate) {
		if (Math.abs(root.im) <= REAL_ROOT_IMAGINARY_TOLERANCE && Number.isFinite(root.re)) candidates.push(root.re);
	}
	if (candidates.length === 0) return null;

	// Prefer a root inside the numeric search domain, then the one nearest zero,
	// so a quadratic with two roots returns the "sensible" small non-negative one
	// rather than an arbitrary pick.
	const inDomain = candidates.filter((c) => c >= SEARCH_LOWER_BOUND && c <= SEARCH_UPPER_BOUND);
	const pool = inDomain.length > 0 ? inDomain : candidates;
	pool.sort((a, b) => Math.abs(a) - Math.abs(b));
	return pool[0];
}

/** One numeric sample of the target line, or an error Value if it could not be read as a finite number. */
type Sample = { value: number } | { error: Value };

/**
 * Bisects for the input that makes the target line equal the target value.
 *
 * Assumes the relationship is monotonic over the search domain (a single
 * crossing), the assumption stated in the module doc. It requires the endpoints
 * to bracket the target (their results straddle it); without that there is no
 * crossing to find and it reports no solution. It stops on the first of three
 * things: the value converging, the interval collapsing (a discontinuity, not a
 * smooth crossing), or the hard iteration cap.
 *
 * @param probe - Re-evaluates the target line with the variable set to a candidate.
 * @param targetLine - The line whose result is being driven to the target.
 * @param variable - The unknown being varied.
 * @param target - The value the line should reach.
 * @param maxIterations - The hard ceiling on bisection steps.
 * @returns The solved input as a Number, or a structured error Value.
 */
function bisect(
	probe: NonNullable<LineExecutionContext["evaluateLineWithBinding"]>,
	targetLine: number,
	variable: string,
	target: number,
	maxIterations: number,
): Value {
	const sample = (candidate: number): Sample => {
		const result = probe(targetLine, variable, numberValue(candidate), false);
		if (result.type === ValueType.Error) return { error: result };
		if (result.type !== ValueType.Number && result.type !== ValueType.Uom) {
			return { error: errorValue("GOAL_SEEK_TARGET_NOT_NUMERIC", `Line ${targetLine} did not produce a number when ${variable} was set to ${candidate}, so goal seek cannot compare it to the target.`) };
		}
		const numeric = result.toNumber();
		if (!Number.isFinite(numeric)) return { error: errorValue("GOAL_SEEK_NON_FINITE", `Line ${targetLine}'s result is not finite when ${variable} is ${candidate}.`) };
		return { value: numeric };
	};

	let lo = SEARCH_LOWER_BOUND;
	let hi = SEARCH_UPPER_BOUND;
	const loSample = sample(lo);
	if ("error" in loSample) return loSample.error;
	const hiSample = sample(hi);
	if ("error" in hiSample) return hiSample.error;

	const tolerance = Math.max(ABSOLUTE_VALUE_TOLERANCE, Math.abs(target) * RELATIVE_VALUE_TOLERANCE);
	let flo = loSample.value - target;
	const fhi = hiSample.value - target;
	if (Math.abs(flo) <= tolerance) return numberValue(lo);
	if (Math.abs(fhi) <= tolerance) return numberValue(hi);
	if (Math.sign(flo) === Math.sign(fhi)) {
		return errorValue(
			"GOAL_SEEK_NO_SOLUTION",
			`No value of ${variable} between ${lo} and ${hi} makes line ${targetLine} equal ${target}: across that whole range its result stays on one side of the target.`,
		);
	}

	for (let step = 0; step < maxIterations; step++) {
		const mid = (lo + hi) / 2;
		const midSample = sample(mid);
		if ("error" in midSample) return midSample.error;
		const fmid = midSample.value - target;
		if (Math.abs(fmid) <= tolerance) return numberValue(mid);
		if (hi - lo <= INTERVAL_COLLAPSE_WIDTH) {
			return errorValue(
				"GOAL_SEEK_DID_NOT_CONVERGE",
				`Goal seek narrowed ${variable} to a single point near ${mid} without line ${targetLine} reaching ${target}: the relationship jumps across the target rather than passing through it.`,
			);
		}
		// Keep the endpoint whose side of the target the midpoint shares, so the
		// bracket always still straddles the target.
		if (Math.sign(fmid) === Math.sign(flo)) {
			lo = mid;
			flo = fmid;
		} else {
			hi = mid;
		}
	}

	return errorValue(
		"GOAL_SEEK_DID_NOT_CONVERGE",
		`Goal seek did not bring line ${targetLine} within tolerance of ${target} by varying ${variable} in ${maxIterations} steps.`,
	);
}
