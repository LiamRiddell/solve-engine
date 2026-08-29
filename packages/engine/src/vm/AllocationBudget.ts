/**
 * The ceiling on how much memory one evaluation is allowed to ask for.
 *
 * The VM's other two counters bound how many opcodes run and how deep the value
 * stack gets, and both are checked BETWEEN opcodes. That leaves a hole the size
 * of a single opcode: whatever one opcode allocates in a loop of its own is
 * invisible to both, so twenty-four characters of input (`map(10*x,
 * 0:2000000000)`) could allocate until V8 aborted the process, which no
 * `try`/`catch` in the host can contain. Per-site caps close one hole each and
 * do not compose: two collections that are individually legal are legal
 * together, and an operation whose result is the PRODUCT of two legal inputs (a
 * matrix multiply) is bounded by neither of them.
 *
 * This is the counter that composes. Everything an evaluation materialises is
 * charged against one running tally, so the bound is on the total rather than
 * on any single step, and a new opcode inherits it by allocating through
 * {@link chargedArray} or by building a Value through a constructor that
 * already charges ({@link matrixValue}).
 *
 * The tally is module state rather than something threaded through every
 * signature. `executeBytecode()` opens an evaluation and every charge inside
 * that window lands on it, which is what lets a helper five call levels down
 * (`vm/MatrixOps.ts`'s `collectionToValues()`) charge without the four frames
 * in between passing a parameter along, and what keeps a charge down to an add
 * and a compare. This mirrors the value arena in `vm/Value.ts`, which is
 * ambient for the same reason and rests on the same fact: `executeBytecode()`
 * is synchronous, so exactly one evaluation is ever in flight in a realm.
 *
 * An "element" is one thing a user's input caused to exist: a `Value` in an
 * expanded collection, a cell in a matrix. They are counted rather than
 * measured in bytes, because a count is the quantity every call site already
 * has in hand before it allocates, and asking V8 how big something is costs
 * more than the allocation being guarded.
 *
 * A second tally lives here for the same structural reason and not because it
 * counts the same thing: {@link chargeFunctionCall} bounds how many
 * user-defined-function calls one evaluation may make in total. Surviving
 * reentry is the whole property both need, and this module is where reentry is
 * already tracked.
 *
 * @module AllocationBudget
 */

import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { VM } from "@solve-js/vm/OpRegistry";

/**
 * How deep the evaluation is: 0 outside one, higher inside a reentrant call.
 *
 * `executeBytecode()` re-enters itself for a user-defined function call, a map
 * or reduce transform body, and an algebra verb's bound-unknown body. Only the
 * outermost entry clears the tally, so a runaway recursion cannot refresh its
 * own allowance the way it can refresh `maxInstructions` (each reentrant call
 * gets a fresh local instruction count, which is why function recursion needed
 * a separate guard of its own).
 */
let depth = 0;

/** Elements charged so far in the evaluation currently in flight. */
let used = 0;

/** The in-flight evaluation's ceiling, read from its VM when the evaluation opened. */
let limit = Number.POSITIVE_INFINITY;

/** User-defined-function calls made so far in the evaluation currently in flight. */
let calls = 0;

/** The in-flight evaluation's call ceiling, read from its VM when the evaluation opened. */
let callLimit = Number.POSITIVE_INFINITY;

/**
 * The refusal itself, built in one place so the wording of the engine's most
 * likely "this is too big" message is not reinvented per site.
 */
function exceeded(requested: number, what: string, alreadyUsed: number): Error {
	return ErrorFactory.execution({
		code: "ALLOCATION_LIMIT_EXCEEDED",
		message:
			`Evaluating this expression would materialise ${requested.toLocaleString("en-US")} ${what}, ` +
			`past the limit of ${limit.toLocaleString("en-US")} elements for one evaluation`,
		expected: `at most ${limit.toLocaleString("en-US")} elements materialised while evaluating one expression`,
		found: `a request for ${requested.toLocaleString("en-US")} more ${what}, on top of ${alreadyUsed.toLocaleString("en-US")} already materialised`,
		suggestion: "use a smaller collection or matrix, or raise the engine's vm.maxAllocatedElements setting",
		context: { requested, what, used: alreadyUsed, limit },
	});
}

/**
 * Open an evaluation, taking its ceiling from the VM about to run it.
 *
 * @param vm - The VM running this program. Only consulted on the outermost
 * entry, so a reentrant call costs one increment.
 */
export function beginEvaluation(vm: VM): void {
	if (depth++ === 0) {
		used = 0;
		limit = vm.getMaxAllocatedElements();
		calls = 0;
		callLimit = vm.getMaxFunctionCalls();
	}
}

/** Close the innermost evaluation. Always call from a `finally`, so a throw cannot leave one open. */
export function endEvaluation(): void {
	if (depth > 0) depth--;
}

/**
 * Record elements materialised by the evaluation in flight.
 *
 * Each thing is charged exactly once, where it comes into existence: a matrix
 * in `matrixValue()`, an expanded collection where it is expanded. A site that
 * knows a size in advance and whose result will be charged on birth uses
 * {@link checkAllocation} instead, so that refusing early does not mean
 * counting twice.
 *
 * Outside an evaluation this is a plain no-op rather than an error:
 * `matrixValue()` and the `vm/MatrixOps.ts` helpers are exported and get called
 * by tests, by the formatter and by hosts with no evaluation in flight, and
 * none of those is user input being executed.
 *
 * @param count - How many elements now exist.
 * @param what - What they are, in the plural and in a user's words ("matrix
 * cells", "collection elements"). Quoted verbatim in the error, so it should
 * name the thing rather than the code that makes it.
 * @throws `ALLOCATION_LIMIT_EXCEEDED` when this evaluation has had enough.
 * Recoverable: it describes this expression, not the engine.
 */
export function chargeAllocation(count: number, what: string): void {
	if (depth === 0) return;
	// Written as a negated `>=` so that NaN takes this branch. A NaN count would
	// otherwise be added to the tally and make every later `used > limit`
	// comparison false, silently switching the guard off for the rest of the
	// evaluation, which is the one failure mode a safety limit must not have.
	if (!(count >= 0)) throw exceeded(count, what, used);
	used += count;
	if (used > limit) throw exceeded(count, what, used - count);
}

/**
 * Refuse an allocation this evaluation cannot afford, without recording it.
 *
 * For the sites that know how big a result will be BEFORE building it and whose
 * result is charged later, when it is born. A matrix product is the case that
 * matters: its size is the product of two operands that are each affordable, so
 * it has to be refused from the shapes alone, before `matrixMultiply()` takes
 * the memory. Charging here as well as at birth would bill every matrix twice
 * and halve the ceiling the host asked for.
 *
 * @param count - How many elements the result would have.
 * @param what - What they are, in the plural. See {@link chargeAllocation}.
 * @throws `ALLOCATION_LIMIT_EXCEEDED` when the evaluation could not afford them.
 */
export function checkAllocation(count: number, what: string): void {
	if (depth === 0) return;
	if (!(count >= 0) || used + count > limit) throw exceeded(count, what, used);
}

/**
 * Check that an array is affordable, then allocate it.
 *
 * The intended way to build any user-sized array inside the VM whose contents
 * end up inside a Value that charges on birth, so that "ask before you take" is
 * a property of the allocator rather than something each new opcode has to be
 * told.
 *
 * @param count - Element count, checked before a single element exists.
 * @param what - What the elements are, in the plural. See {@link chargeAllocation}.
 * @returns An empty array of that length.
 * @throws `ALLOCATION_LIMIT_EXCEEDED` before allocating anything, when the
 * evaluation cannot afford it.
 */
export function checkedArray<T>(count: number, what: string): T[] {
	checkAllocation(count, what);
	return new Array<T>(count);
}

/**
 * Record one user-defined-function call, and refuse the one past the ceiling.
 *
 * Lives in this module rather than in the VM for the single reason the element
 * tally does: it has to survive `executeBytecode()` re-entering itself. A call
 * count kept per invocation would be reset by the very calls it is counting,
 * which is exactly what happens to `maxInstructions` and exactly why counting
 * instructions could never bound this.
 *
 * The thing being bounded is BREADTH, which no existing guard could see.
 * `maxFunctionRecursionDepth` bounds nesting, and a doubling chain
 * (`f22(v) = f21(v) + f21(v)`, twenty-two lines of it) nests only twenty-two
 * deep while making 2,097,152 calls, which was a fatal heap abort in under a
 * second. Depth 22 against a limit of 50 is comfortably legal, and it was.
 *
 * @throws `FUNCTION_CALL_LIMIT_EXCEEDED` when this evaluation has made
 * enough. Recoverable: the engine is fine, this line is not.
 */
export function chargeFunctionCall(): void {
	if (depth === 0) return;
	if (++calls > callLimit) {
		throw ErrorFactory.execution({
			code: "FUNCTION_CALL_LIMIT_EXCEEDED",
			message:
				`Evaluating this expression would make more than ${callLimit.toLocaleString("en-US")} ` +
				`user-defined-function calls, which is the limit for one evaluation`,
			expected: `at most ${callLimit.toLocaleString("en-US")} function calls while evaluating one expression`,
			found: "a call past that limit, from a chain of functions that each call others more than once",
			suggestion: "check for a function that calls itself (or a chain of them) more times than intended, or raise the engine's vm.maxFunctionCalls setting",
			context: { calls, callLimit },
		});
	}
}

/**
 * Elements charged so far in the evaluation in flight, or in the one that just
 * finished. For tests and for a host reporting on a refusal.
 *
 * @returns The running tally.
 */
export function allocationUsed(): number {
	return used;
}

/**
 * Drop all in-flight evaluation state.
 *
 * For tests that need a known starting point, and as a repair for a host that
 * somehow lost an `endEvaluation()`. Ordinary execution never needs it:
 * `executeBytecode()` pairs its own begin and end in a `finally`, and the
 * outermost begin clears the tally regardless of what came before.
 */
export function resetAllocationTracking(): void {
	depth = 0;
	used = 0;
	limit = Number.POSITIVE_INFINITY;
	calls = 0;
	callLimit = Number.POSITIVE_INFINITY;
}
