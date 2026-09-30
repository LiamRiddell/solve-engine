import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { salaryFlourishAt, salaryWordNormalizerRule } from "@solve-js/packages/payroll/normalizer/SalaryWordNormalizerRule";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";

/**
 * Found bug: `salary = £50,000` then `salary after tax` failed with "Expected a
 * value". The payroll package fused `salary after tax` (and `salary per month
 * after tax`) as whole phrases, so the word was claimed wherever it stood, and a
 * variable the reader named `salary` was swallowed into the phrase, leaving the
 * form nothing to take home from.
 *
 * The phrases are now `after tax` and `per month after tax` alone, and
 * `salaryWordNormalizerRule` drops `salary` as a flourish only where it follows
 * an amount (`£50,000 salary after tax`), so a `salary` that starts a value is
 * the variable it is.
 */

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text).lines.map((l) => (l.result == null ? `ERROR ${l.error}` : l.result.isError() ? `ERROR ${l.result.errorMessage}` : formatValue(l.result)));
}

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v);
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test("a variable named salary, after tax, monthly and per month", () => {
		expect(doc("salary = £50,000\nsalary after tax\nsalary per month after tax\nsalary monthly after tax\n:net = salary after tax\nnet")).toEqual([
			"= £50,000.00",
			"= £39,519.60",
			"= £3,293.30",
			"= £3,293.30",
			"= £39,519.60",
			"= £39,519.60",
		]);
	});

	test("the flourish after an amount still reads as it did", () => {
		expect(shown("£50,000 salary after tax")).toBe("= £39,519.60");
		expect(shown("£50,000 salary per month after tax")).toBe("= £3,293.30");
		expect(shown("£50,000 after tax")).toBe("= £39,519.60");
	});

	test("a capitalised name, a bracketed one, and one inside arithmetic", () => {
		expect(doc("Salary = £50,000\nSalary after tax")).toEqual(["= £50,000.00", "= £39,519.60"]);
		expect(doc("salary = £50,000\n(salary) after tax\nsalary * 2 after tax")).toEqual(["= £50,000.00", "= £39,519.60", "= £68,557.40"]);
	});

	test("an undefined salary is named as undefined, not a missing value", () => {
		expect(shown("salary after tax")).toBe("THROWS Undefined variable: salary");
	});
});

// ── The parts ────────────────────────────────────────────────────────────

function tokens(...spec: Array<[string, string]>): Token[] {
	let offset = 0;
	return spec.map(([type, value]) => {
		const token = { type, typeId: tokenTypeId(type), value, text: value, offset } as Token;
		offset += value.length + 1;
		return token;
	});
}

describe("salaryFlourishAt", () => {
	test("after an amount: a number, a closing bracket, a percentage, a word", () => {
		for (const type of ["NUMBER", "RPAREN", "PERCENT", "IDENT", "UNIT"]) {
			expect({ type, kind: salaryFlourishAt(tokens([type, "x"], ["IDENT", "salary"], ["AFTER_TAX", "after tax"]), 0) }).toEqual({ type, kind: "after" });
		}
		expect(salaryFlourishAt(tokens(["NUMBER", "5"], ["IDENT", "Salary"], ["AFTER_TAX_MONTHLY", "per month after tax"]), 0)).toBe("after");
	});

	test("the multiplication the normaliser inserted before the word, and never one at the start", () => {
		const t = tokens(["NUMBER", "5"], ["STAR", "*"], ["IDENT", "salary"], ["AFTER_TAX", "after tax"]);
		t[1] = { ...t[1], offset: t[2].offset };
		expect(salaryFlourishAt(t, 1)).toBe("star");
		const atStart = tokens(["STAR", "*"], ["IDENT", "salary"], ["AFTER_TAX", "after tax"]);
		atStart[0] = { ...atStart[0], offset: atStart[1].offset };
		expect(salaryFlourishAt(atStart, 0)).toBeNull();
	});

	test("not after a typed operator, an equals or a colon, nor before anything but a take-home form", () => {
		for (const type of ["PLUS", "EQUALS", "COLON", "STAR"]) {
			expect({ type, kind: salaryFlourishAt(tokens([type, "x"], ["IDENT", "salary"], ["AFTER_TAX", "after tax"]), 0) }).toEqual({ type, kind: null });
		}
		expect(salaryFlourishAt(tokens(["NUMBER", "5"], ["IDENT", "salary"], ["PLUS", "+"]), 0)).toBeNull();
		expect(salaryFlourishAt(tokens(["NUMBER", "5"], ["IDENT", "wage"], ["AFTER_TAX", "after tax"]), 0)).toBeNull();
	});

	test("boundary and hostile positions: past the end, an empty stream, prototype words as the word", () => {
		expect(salaryFlourishAt([], 0)).toBeNull();
		expect(salaryFlourishAt(tokens(["NUMBER", "5"]), 5)).toBeNull();
		expect(salaryFlourishAt(tokens(["NUMBER", "5"], ["IDENT", "salary"]), 0)).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(salaryFlourishAt(tokens(["NUMBER", "5"], ["IDENT", word], ["AFTER_TAX", "after tax"]), 0)).toBeNull();
	});

	test("the rule drops the word, and keeps the amount before it", () => {
		const rule = salaryWordNormalizerRule();
		const t = tokens(["NUMBER", "5"], ["IDENT", "salary"], ["AFTER_TAX", "after tax"]);
		expect(rule.match(t, 0)).toEqual({ consumed: 2, replacement: [t[0]], ruleName: "payroll:salary-word" });
		expect(rule.match(tokens(["IDENT", "salary"], ["AFTER_TAX", "after tax"]), 0)).toBeNull();
	});
});

describe("adversarial", () => {
	test("security: prototype words as the variable, markup after the phrase, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectHonestDocument(`${word} = £50,000\n${word} after tax`);
		});
		for (const line of fill("£50,000 salary after tax X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine(Array.from({ length: 500 }, () => "salary").join(" ") + " after tax");
	});

	test("realistic: a salary from the line above, a check over it, a what-if and both passes", () => {
		// The check brackets the form here; since FoundBug_afterTaxInAComparison
		// the brackets are optional, and that spec covers the unbracketed line.
		const { batch, incremental } = expectHonestDocument("salary = £50,000\nsalary after tax\ncheck (salary after tax) > £30,000\nline 2 with salary = £60,000");
		expect(batch.slice(0, 4)).toEqual(["= £50,000.00", "= £39,519.60", "= ✓", "= £45,357.40"]);
		expect(shown("£60,000 after tax")).toBe("= £45,357.40");
		expect(incremental).toEqual(batch);
		expect(shown("salary = £50,000")).toBe("= £50,000.00");
	});

	test("edge: a zero, a negative and a non-pound salary are answered or refused by name", () => {
		expectHonestDocument("salary = £0\nsalary after tax");
		expectHonestDocument("salary = -£5\nsalary after tax");
		const { batch } = expectHonestDocument("salary = 50000\nsalary after tax");
		expect(batch[1]).toContain("needs a pound salary");
	});
});
