import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { checkComparison } from "@solve-js/packages/conditionals/CheckFunctions";
import { boolValue, numberValue, stringValue, ValueType } from "@solve-js/vm/Value";

/**
 * Found bug: `check` could not compare two booleans. `check !(1 > 2) == true`
 * said "true and true cannot be compared": the check read its sides as
 * numbers or text, and a yes-or-no answer is neither. Two booleans now compare
 * as equal or not, as two pieces of text do. A boolean has no order, so `<`
 * and its kin are refused by name, and a boolean against a number is still
 * incomparable rather than read as 1 or 0.
 */

function shown(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function check(left: boolean, right: boolean, op: string) {
	return checkComparison([boolValue(left), boolValue(right), stringValue(op)]);
}

describe("the lines that exposed it", () => {
	test.each([
		["check !(1 > 2) == true", "✓"],
		["check true == true", "✓"],
		["check (1 > 2) == false", "✓"],
		["check true != false", "✓"],
		["check (2 > 1) == (3 > 2)", "✓"],
		["check true == false", "check failed: true is not equal to false"],
		["check true != true", "check failed: true is equal to true"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("an order between booleans, or a boolean against a number, is refused by name", () => {
		expect(shown("check true < false")).toBe("check: true and false can only be compared with == or !=, not <");
		expect(shown("check true == 1")).toBe("check: true and 1 cannot be compared");
	});
});

describe("checkComparison over two booleans, the part that refused them", () => {
	test("every operator, both ways round", () => {
		for (const [l, r] of [[true, true], [true, false], [false, true], [false, false]] as const) {
			expect(check(l, r, "==").type === ValueType.String).toBe(l === r);
			expect(check(l, r, "!=").type === ValueType.String).toBe(l !== r);
			expect(check(l, r, "≈").type === ValueType.String).toBe(l === r);
			for (const op of ["<", "<=", ">", ">="]) expect(check(l, r, op).errorCode).toBe("CHECK_INCOMPARABLE");
		}
	});

	test("hostile operator text is refused, not evaluated", () => {
		expect(check(true, true, "constructor").errorCode).toBe("CHECK_INCOMPARABLE");
		expect(check(true, true, "").errorCode).toBe("CHECK_INCOMPARABLE");
		expect(checkComparison([boolValue(true), numberValue(1), stringValue("==")]).errorCode).toBe("CHECK_INCOMPARABLE");
	});
});

describe("adversarial", () => {
	test("security: prototype words as a side, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectHonestLine(`check ${word} == true`);
		});
	});

	test("security: look-alike and markup-shaped text", () => {
		for (const line of fill("check true == X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine(`check ${"!".repeat(500)}true == true`);
	});

	test("realistic: answers from lines above, counted as checks, through both passes", () => {
		const text = "late = 2010 > 1950\ncheck late == true\ncheck late == false";
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch[1]).toBe("= ✓");
		expect(batch[2]).toBe("ERROR check failed: true is not equal to false");
		expect(incremental).toEqual(batch);
		expect(newTrackedEngine().parseDocument(text).checks).toEqual(expect.objectContaining({ passed: 1, failed: 1 }));
	});

	test("edge: a comparison that is itself a check of two booleans, and a boolean from and", () => {
		expect(shown("check (1 < 2 and 3 < 4) == true")).toBe("✓");
		expect(shown("check (not true) == false")).toBe("✓");
	});
});
