/**
 * What the solver does when it cannot finish.
 *
 * The numerical stage is robust enough that no equation a person types is
 * expected to defeat it, which is exactly why this is pinned with the stage
 * replaced rather than with an input chosen to break it. The branch that
 * reports a shortfall is the one branch whose whole job is to run on a day
 * nobody predicted, and a branch that has never executed is a branch that has
 * never been shown to work.
 *
 * `NumericRoots.ts` is mocked to decline for the whole file, so `solve` reaches
 * the reporting path for any equation with no closed form. What is asserted is
 * the contract a caller depends on:
 *
 *  - the outcome is `incomplete`, a different shape from `roots`, so a partial
 *    answer cannot be read as a whole one by a caller that only checks for
 *    roots;
 *  - it counts what is missing, as a number rather than as prose;
 *  - the exact roots it did find are still carried, so nothing correct is
 *    thrown away;
 *  - and at the engine surface it becomes an Error value with its own code,
 *    which is what stops it reaching a document as a row of numbers.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("@solve-js/symbolic/NumericRoots", () => ({
	approximateRoots: () => null,
}));

import { solveForVariable } from "@solve-js/symbolic/Solve";
import { solveEquationValues } from "@solve-js/vm/SymbolicOps";
import { ValueType, numberValue, symbolicValue } from "@solve-js/vm/Value";
import { simplifySymbolic, formatSymbolic, constNode } from "@solve-js/symbolic";
import { poly } from "@tools/symbolicTestUtils";

/** `x^5+x+1 = 0`, which has no rational root and no closed form, so it needs the numerical stage. */
const noClosedForm = [1, 0, 0, 0, 1, 1];

/**
 * `x^8-1 = 0`, whose rational roots come out exactly before the numerical stage
 * is reached.
 *
 * Degree eight rather than six on purpose: `x^6-1` leaves a quartic, and a
 * quartic has a closed form here, so the numerical stage would never be asked.
 */
const partlyExact = [1, 0, 0, 0, 0, 0, 0, 0, -1];

describe("when the numerical stage declines", () => {
	test("the outcome is not a roots outcome", () => {
		// The distinction is structural rather than a message, so a caller
		// switching on `kind` cannot fall into the roots branch by accident.
		expect(solveForVariable(poly(noClosedForm), constNode(0), "x").kind).toBe("incomplete");
	});

	test("it counts how many roots are missing", () => {
		const outcome = solveForVariable(poly(noClosedForm), constNode(0), "x");
		if (outcome.kind !== "incomplete") throw new Error(`expected incomplete, got ${outcome.kind}`);
		expect(outcome.missing).toBe(5);
	});

	test("and says why, in a sentence fit to show a reader", () => {
		const outcome = solveForVariable(poly(noClosedForm), constNode(0), "x");
		if (outcome.kind !== "incomplete") throw new Error(`expected incomplete, got ${outcome.kind}`);
		expect(outcome.reason).toMatch(/degree-5 factor/);
	});

	test("the exact roots it did find are kept rather than discarded", () => {
		// x^8-1 has -1 and 1 exactly, and six more roots the mocked stage cannot
		// reach. Throwing away the two that are known would be a second wrong
		// answer on top of the first.
		const outcome = solveForVariable(poly(partlyExact), constNode(0), "x");
		if (outcome.kind !== "incomplete") throw new Error(`expected incomplete, got ${outcome.kind}`);
		expect(outcome.exact.map(root => formatSymbolic(simplifySymbolic(root))).sort()).toEqual(["-1", "1"]);
	});

	test("and the count of missing roots is the degree of the factor left, not of the equation", () => {
		const outcome = solveForVariable(poly(partlyExact), constNode(0), "x");
		if (outcome.kind !== "incomplete") throw new Error(`expected incomplete, got ${outcome.kind}`);
		expect(outcome.missing).toBe(6);
	});

	test("at the engine surface it is an error rather than a row of numbers", () => {
		const value = solveEquationValues(symbolicValue(poly(partlyExact)), numberValue(0), "x");
		expect(value.type).toBe(ValueType.Error);
	});

	test("carrying its own code, so a caller can tell it from a refusal to try", () => {
		const value = solveEquationValues(symbolicValue(poly(partlyExact)), numberValue(0), "x");
		expect(String(value.value)).toBe("SYMBOLIC_SOLVE_INCOMPLETE");
	});

	test("and a message naming both counts, so a reader is told the size of the gap", () => {
		// `errorValue` carries the code in `value` and the message in `unit`.
		const value = solveEquationValues(symbolicValue(poly(partlyExact)), numberValue(0), "x");
		expect(String(value.unit)).toMatch(/Only 2 of this equation's 8 roots could be found/);
	});

	test("an equation the exact methods finish is unaffected by the stage being gone", () => {
		// The guard on this file: if the mock somehow disabled solving altogether,
		// every assertion above would still pass while proving nothing.
		const outcome = solveForVariable(poly([1, -6, 11, -6]), constNode(0), "x");
		expect(outcome.kind).toBe("roots");
	});
});
