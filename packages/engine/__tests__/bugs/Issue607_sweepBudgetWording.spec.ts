import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { formatValue } from "@solve-js/format/FormatEngine";
import { budgetMark, sharedBudgetRefusal, beginEvaluation, endEvaluation, chargeAllocation, chargeFunctionCall, resetAllocationTracking } from "@solve-js/vm/AllocationBudget";
import type { VM } from "@solve-js/vm/OpRegistry";

/**
 * Issue #607: a sweep's refusal blamed one step for the whole sweep's budget.
 * Every step's re-run spends the sweep line's one allocation budget, as it
 * must, so the step that crossed it was only where the running total ran out:
 * "With k at 7, line 2 has no answer", while `line 2 with k = 7` answered on
 * its own. The sweep now says the steps together reached the limit, and the
 * doubled "has no answer" is gone.
 */

function lines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		const v = line.result;
		if (v == null) return line.error ? `ERROR ${line.error}` : "";
		if (!v.isError()) return formatValue(v);
		// The incremental pass reports a line that failed as an `eval_failed`
		// value, where the batch pass reports it as the line's error.
		return v.value === "eval_failed" ? `ERROR ${String(v.errorMessage)}` : `ERROR ${String(v.value)}: ${String(v.errorMessage)}`;
	});
}

/** Both document passes over `text` with the given VM limits, which must agree. */
function both(text: string, vm: { maxAllocatedElements?: number; maxFunctionCalls?: number } = {}): string[] {
	const batch = lines(newTrackedEngine({ config: { vm } }).parseDocument(text));
	const incremental = lines(evaluateDocument(newTrackedEngine({ config: { vm } }) as unknown as ExpressionEngine, text));
	expect(incremental).toEqual(batch);
	return batch;
}

/** A VM as far as the budget module reads one. */
function vmWith(limit: number, callLimit: number): VM {
	return { getMaxAllocatedElements: () => limit, getMaxFunctionCalls: () => callLimit } as unknown as VM;
}

describe("sharedBudgetRefusal tells a shared budget from work too big on its own", () => {
	test("a refusal the work since the mark would not have met alone is shared", () => {
		resetAllocationTracking();
		beginEvaluation(vmWith(100, 10));
		try {
			chargeAllocation(80, "cells");
			const mark = budgetMark();
			expect(() => chargeAllocation(30, "cells")).toThrow();
			expect(sharedBudgetRefusal(mark)).toEqual({ budget: "elements", limit: 100 });
		} finally {
			endEvaluation();
		}
	});

	test("a refusal the work since the mark would have met alone is not", () => {
		resetAllocationTracking();
		beginEvaluation(vmWith(100, 10));
		try {
			chargeAllocation(10, "cells");
			const mark = budgetMark();
			expect(() => chargeAllocation(101, "cells")).toThrow();
			expect(sharedBudgetRefusal(mark)).toBeNull();
		} finally {
			endEvaluation();
		}
	});

	test("no refusal since the mark is no refusal", () => {
		resetAllocationTracking();
		beginEvaluation(vmWith(100, 10));
		try {
			const mark = budgetMark();
			chargeAllocation(50, "cells");
			expect(sharedBudgetRefusal(mark)).toBeNull();
		} finally {
			endEvaluation();
		}
	});

	test("the call budget is read the same way", () => {
		resetAllocationTracking();
		beginEvaluation(vmWith(100, 10));
		try {
			for (let i = 0; i < 8; i++) chargeFunctionCall();
			const mark = budgetMark();
			chargeFunctionCall();
			chargeFunctionCall();
			expect(() => chargeFunctionCall()).toThrow();
			expect(sharedBudgetRefusal(mark)).toEqual({ budget: "calls", limit: 10 });
		} finally {
			endEvaluation();
		}
	});

	test("a count that is not a number is never reported as shared", () => {
		resetAllocationTracking();
		beginEvaluation(vmWith(100, 10));
		try {
			const mark = budgetMark();
			expect(() => chargeAllocation(Number.NaN, "cells")).toThrow();
			expect(sharedBudgetRefusal(mark)).toBeNull();
		} finally {
			endEvaluation();
		}
	});
});

describe("a sweep says the steps together reached the budget", () => {
	test("the survey's note, at the engine's own limit of 2,000,000 elements", () => {
		const out = both(":k = 1\nsum(x, map(x*1, 1:99999)) * k\nline 2 for k from 1 to 20 step 1\nline 2 with k = 7");
		expect(out[2]).toBe(
			"ERROR SWEEP_OVER_BUDGET: This sweep stopped with k at 7: this sweep's re-runs of line 2 share this line's limit of 2,000,000 materialised elements, and together they reached it. Use a larger step or a shorter range.",
		);
		// The step the sweep stopped at answers on its own.
		expect(out[3]).toBe("= 34,999,650,000");
	});

	test("the budget crossed on a middle step", () => {
		const out = both(":k = 1\nsum(x, map(x*k, 1:99))\nline 2 for k from 1 to 20 step 1\nline 2 with k = 4", { maxAllocatedElements: 1000 });
		expect(out[2]).toBe(
			"ERROR SWEEP_OVER_BUDGET: This sweep stopped with k at 4: this sweep's re-runs of line 2 share this line's limit of 1,000 materialised elements, and together they reached it. Use a larger step or a shorter range.",
		);
		expect(out[3]).toBe("= 19,800");
	});

	test("the budget crossed at the final list", () => {
		const out = both(":k = 1\nsum(x, map(x*k, 1:40))\nline 2 for k from 1 to 3 step 1", { maxAllocatedElements: 362 });
		expect(out[2]).toBe(
			"ERROR SWEEP_OVER_BUDGET: This sweep's re-runs of line 2 share this line's limit of 362 materialised elements, and together they left no room for the list of its 3 answers. Use a larger step or a shorter range.",
		);
		// One more element of budget and the list fits.
		expect(both(":k = 1\nsum(x, map(x*k, 1:40))\nline 2 for k from 1 to 3 step 1", { maxAllocatedElements: 364 })[2]).toBe("= [820, 1,640, 2,460]");
	});

	test("the function-call budget crossed by a user-defined function across steps", () => {
		const calls = Array(10).fill("f(k)").join(" + ");
		const out = both(`f(n) = n + 1\n:k = 1\n${calls}\nline 3 for k from 1 to 20 step 1\nline 3 with k = 6`, { maxFunctionCalls: 50 });
		expect(out[3]).toBe(
			"ERROR SWEEP_OVER_BUDGET: This sweep stopped with k at 6: this sweep's re-runs of line 3 share this line's limit of 50 user-defined-function calls, and together they reached it. Use a larger step or a shorter range.",
		);
		expect(out[4]).toBe("= 70");
	});
});

describe("adversarial: a step too big on its own is still the step's own failure, said once", () => {
	test("the budget crossed on the first step by that step alone", () => {
		const out = both(":k = 1\nsum(x, map(x*k, 1:600)) + sum(x, map(x*k, 1:600))\nline 2 for k from 1 to 20 step 1", { maxAllocatedElements: 1000 });
		expect(out[2]).toBe(
			"ERROR SWEEP_STEP_FAILED: With k at 1, line 2 has no answer with these inputs: Evaluating this expression would materialise 600 matrix cells, past the limit of 1,000 elements for one evaluation",
		);
	});

	test("a step whose line fails says 'has no answer' once", () => {
		const out = both(":k = 1\nk * zz\nline 2 for k from 1 to 3 step 1");
		expect(out[2]).toBe("ERROR SWEEP_STEP_FAILED: With k at 1, line 2 has no answer with these inputs: Undefined variable: zz");
	});

	test("a step whose answer is an error value names it after the line", () => {
		const out = both(":k = 1\nsum(x, map(x*1, 1:(k*1000000)))\nline 2 for k from 1 to 3 step 1");
		expect(out[2]).toBe(
			"ERROR SWEEP_STEP_FAILED: With k at 1, line 2 has no answer: This collection has 1000000 elements, past the limit of 100000 (see the engine's vm.maxCollectionSize setting).",
		);
	});

	test("a sweep within the budget is unchanged", () => {
		expect(both(":k = 1\nsum(x, 1:99999) * k\nline 2 for k from 1 to 3 step 1")[2]).toBe("= [4,999,950,000, 9,999,900,000, 14,999,850,000]");
	});

	test("a single what-if keeps its own message", () => {
		const out = both(":k = 1\nk * zz\nline 2 with k = 3");
		expect(out[2]).toBe("ERROR WHAT_IF_TARGET_ERROR: Line 2 has no answer with these inputs: Undefined variable: zz");
	});
});
