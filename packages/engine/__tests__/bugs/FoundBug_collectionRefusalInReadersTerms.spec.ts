import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, numberValue, stringValue, boolValue, uomValue, percentageValue, errorValue, pendingValue, matrixValue, type Value } from "@solve-js/vm/Value";
import { collectionToValues, describeNonCollection, notACollection, reduceFormCall, ReduceForm, type CollectionCall } from "@solve-js/vm/MatrixOps";

/**
 * Found bug: `sum(5)` was refused with "map/reduce requires a Matrix or Range
 * collection (e.g. "[1,2,3]" or "0:3")". The reader typed `sum`, not
 * map/reduce, and would call a Matrix a list. `prod(5)`, `map(x * 2, 5)` and
 * `reduce(acc + x, 5)` gave the same words. The refusal is raised while the
 * line runs, in `collectionToValues`, which knew nothing of the call: `sum` and
 * `prod` compile to the same `REDUCE_INVOKE` as `reduce`.
 *
 * `REDUCE_INVOKE`'s third operand, which was a 0-or-1 flag for a starting
 * value, now carries the form written (`ReduceForm`: reduce, reduce from a
 * value, sum, prod; any value but 0 still means a starting value), and the
 * refusal (`notACollection`) names the word typed, what it does with a list,
 * the two things it takes and what it was given. The code,
 * `MAP_REDUCE_REQUIRES_COLLECTION`, is unchanged.
 */

function shown(line: string, engine = newTrackedEngine()): string {
	try {
		const v = engine.evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const LIST = "a list or a range, such as [1, 2, 3] or 1:3";

describe("the lines that exposed it", () => {
	test.each([
		["sum(5)", `sum adds up the items of ${LIST}, and this is a single number; to add values one by one, list them, as in sum(5, 6).`],
		["prod(5)", `prod multiplies together the items of ${LIST}, and this is a single number.`],
		["map(x * 2, 5)", `map works through the items of ${LIST}, and this is a single number.`],
		["reduce(acc + x, 5)", `reduce folds into one the items of ${LIST}, and this is a single number.`],
		["reduce(acc + x, 5, 10)", `reduce folds into one the items of ${LIST}, and this is a single number.`],
		["reduce(max, 5)", `reduce folds into one the items of ${LIST}, and this is a single number.`],
		["sum(x, 5)", `sum adds up the items of ${LIST}, and this is a single number; to add values one by one, list them, as in sum(5, 6).`],
		["prod(x^2, 5)", `prod multiplies together the items of ${LIST}, and this is a single number.`],
		['sum("abc")', `sum adds up the items of ${LIST}, and this is text; to add values one by one, list them, as in sum(5, 6).`],
		["sum(5 m)", `sum adds up the items of ${LIST}, and this is a single quantity; to add values one by one, list them, as in sum(5, 6).`],
		["prod(true)", `prod multiplies together the items of ${LIST}, and this is true or false.`],
		["sum(50%)", `sum adds up the items of ${LIST}, and this is a single percentage; to add values one by one, list them, as in sum(5, 6).`],
	])("%s is refused in the reader's terms", (line, message) => {
		expect(shown(line)).toBe(`ERROR ${message}`);
		expect(shown(line)).not.toMatch(/map\/reduce|Matrix|Range collection/);
	});

	test("the code a host branches on is unchanged", () => {
		for (const line of ["sum(5)", "prod(5)", "map(x * 2, 5)", "reduce(acc + x, 5)"]) {
			expect(newTrackedEngine().evaluateExpression(line).value).toBe("MAP_REDUCE_REQUIRES_COLLECTION");
		}
	});

	test("every form over a list still folds, a starting value included", () => {
		expect(shown("sum(1:3)")).toBe("6");
		expect(shown("prod(1:4)")).toBe("24");
		expect(shown("sum(x^2, 1:3)")).toBe("14");
		expect(shown("prod(x, [2, 3])")).toBe("6");
		expect(shown("reduce(acc + x, [1, 2, 3])")).toBe("6");
		expect(shown("reduce(acc + x, [1, 2, 3], 10)")).toBe("16");
		expect(shown("map(x * 2, [1, 2])")).toBe("[2, 4]");
		expect(shown("sum(5, 6)")).toBe("11");
	});

	test("a fault inside the call is passed on, not reworded", () => {
		expect(shown("sum(1/0 m to kg)")).not.toContain("adds up the items");
		expect(shown("sum(undefinedthing)")).not.toContain("adds up the items");
	});
});

describe("ReduceForm and reduceFormCall", () => {
	test("ordinary: each form names its word", () => {
		expect(reduceFormCall(ReduceForm.reduce)).toBe("reduce");
		expect(reduceFormCall(ReduceForm.reduceFrom)).toBe("reduce");
		expect(reduceFormCall(ReduceForm.sum)).toBe("sum");
		expect(reduceFormCall(ReduceForm.prod)).toBe("prod");
	});

	test("boundary and hostile: a value no parselet emits is reduce", () => {
		for (const form of [4, 255, -1, 0.5, Number.NaN]) expect(reduceFormCall(form)).toBe("reduce");
		// Only the bare reduce has no starting value: the old flag's 1 is still 1.
		expect(ReduceForm.reduce).toBe(0);
		expect(ReduceForm.reduceFrom).toBe(1);
		expect(new Set(Object.values(ReduceForm)).size).toBe(4);
	});
});

describe("describeNonCollection", () => {
	test("ordinary and boundary: each kind of value in the reader's words", () => {
		expect(describeNonCollection(numberValue(5))).toBe("a single number");
		expect(describeNonCollection(numberValue(-0))).toBe("a single number");
		expect(describeNonCollection(numberValue(Number.NaN))).toBe("a single number");
		expect(describeNonCollection(uomValue(5, "m"))).toBe("a single quantity");
		expect(describeNonCollection(percentageValue(0.5))).toBe("a single percentage");
		expect(describeNonCollection(stringValue(""))).toBe("text");
		expect(describeNonCollection(boolValue(false))).toBe("true or false");
	});

	test("hostile: a kind with no word of its own is a single value, never an internal name", () => {
		const odd = errorValue("X", "y");
		expect(describeNonCollection(odd)).toBe("a single value");
		expect(describeNonCollection(odd)).not.toMatch(/Error|ValueType|undefined/);
	});
});

describe("notACollection and collectionToValues", () => {
	test("ordinary: each call's refusal", () => {
		for (const call of ["map", "reduce", "sum", "prod"] as CollectionCall[]) {
			const refused = notACollection(call, numberValue(5));
			expect(refused.type).toBe(ValueType.Error);
			expect(refused.value).toBe("MAP_REDUCE_REQUIRES_COLLECTION");
			expect(String(refused.errorMessage).startsWith(`${call} `)).toBe(true);
		}
	});

	test("boundary: collectionToValues names the call it is given, and map by default", () => {
		const refused = collectionToValues(numberValue(5), 10, "prod") as Value;
		expect(refused.errorMessage).toContain("prod multiplies");
		expect((collectionToValues(numberValue(5)) as Value).errorMessage).toContain("map works through");
		const cells = collectionToValues(matrixValue(1, 2, [1, 2]), 10, "sum");
		expect(Array.isArray(cells)).toBe(true);
	});

	test("hostile: a pending or failed collection passes through, and a prototype word as the call is not looked up", () => {
		const pending = pendingValue("q");
		expect(collectionToValues(pending, 10, "sum")).toBe(pending);
		const failed = errorValue("UPSTREAM", "upstream failed");
		expect((collectionToValues(failed, 10, "sum") as Value).value).toBe("UPSTREAM");
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const refused = notACollection(word as CollectionCall, numberValue(5));
				expect(refused.errorMessage).toContain("works through the items of");
				expect(refused.errorMessage).not.toMatch(/function|\[object/);
			}
		});
	});
});

describe("adversarial", () => {
	test("security: prototype words as the collection, long and deep arguments, markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`sum(${word})`);
				expectHonestLine(`map(x * 2, ${word})`);
				expectHonestDocument(`${word} = 5\nsum(${word})\nprod(${word})\nreduce(acc + x, ${word})`);
			}
		});
		expect(shown(`sum(${RESOURCE_PROBES.longSum(100)})`)).toContain("sum adds up the items");
		expectHonestLine(`sum(${RESOURCE_PROBES.longSum(1_000)})`, { budgetMs: 5_000 });
		expectHonestLine(`prod(${RESOURCE_PROBES.deepParens(200)})`, { budgetMs: 5_000 });
		expect(shown(`sum(${RESOURCE_PROBES.hugeRange()})`)).toContain("past the limit");
		for (const line of fill("sum(X)", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("map(x * 2, X)", TEXT_EDGES)) expectHonestLine(line);
		expect(shown('sum("<script>alert(1)</script>")')).toContain("and this is text");
	});

	test("realistic: a value from the line above, a what-if that makes it a list, and both passes", () => {
		const { batch, incremental } = expectHonestDocument("xs = 5\nsum(xs)\nline 2 with xs = [1, 2, 3]\nprod(xs)");
		expect(batch[1]).toContain("sum adds up the items");
		expect(batch[2]).toBe("= 6");
		expect(batch[3]).toContain("prod multiplies together");
		expect(incremental).toEqual(batch);
		expect(shown("summ(5)")).not.toContain("map/reduce");
		expect(shown("sum(5")).toMatch(/^THROWS/);
	});

	test("edge: every numeric edge as the collection of each call", () => {
		for (const template of ["sum(X)", "prod(X)", "map(x * 2, X)", "reduce(acc + x, X)", "sum(x, X)"]) {
			for (const line of fill(template, NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		}
		expect(shown("sum(0)")).toContain("a single number");
		expect(shown("sum(-0)")).toContain("a single number");
	});
});
