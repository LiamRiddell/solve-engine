import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import { PAYROLL_PACKAGE, PayrollErrorCodes, negativeSalaryRefusal } from "@solve-js/packages/payroll/PayrollPackage";

/**
 * Found bug: `-£50,000 after tax` answered `-£50,000.00`. Every band charges
 * nothing below its threshold (`taxThroughBands` owes nothing on a negative
 * income, `pensionContribution` takes nothing from one), so a negative salary
 * went through the arithmetic untouched and came back as a take-home no one
 * has. The same was true of `per month after tax`, `after 20% tax` and `hourly
 * for`.
 *
 * A salary below zero is now refused by every payroll form with
 * `PAYROLL_NEGATIVE_SALARY` (`negativeSalaryRefusal`), after the pound gate, so
 * a dollar salary is still refused for its currency first. Zero is a salary (a
 * year unpaid) and keeps its answer of nothing.
 */

const REFUSAL = "a salary is what someone is paid, so it cannot be below zero: write the pay as zero or more, such as £50,000";

function shown(line: string, engine = newTrackedEngine()): string {
	try {
		const v = engine.evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function codeOf(line: string): unknown {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? v.value : undefined;
}

describe("the lines that exposed it", () => {
	test.each([
		"-£50,000 after tax",
		"£-50,000 after tax",
		"-£50,000 per month after tax",
		"-£50,000 monthly after tax",
		"-£50,000 after tax in Scotland",
		"-£50,000 after tax with plan 2 student loan",
		"-£50,000 after tax with 5% pension",
		"take home on -£50,000",
		"-£50,000 after 20% tax",
		"-50,000 after 20% tax",
		"-$50,000 after 20% tax",
		"hourly for -£50,000",
		"-£0.01 after tax",
	])("%s is refused by name", (line) => {
		expect(shown(line)).toBe(`ERROR ${REFUSAL}`);
		expect(codeOf(line)).toBe(PayrollErrorCodes.PAYROLL_NEGATIVE_SALARY);
	});

	test("zero and above keep their answers", () => {
		expect(shown("£0 after tax")).toBe("£0.00");
		expect(shown("-£0 after tax")).toBe("£0.00");
		expect(shown("£0 after 20% tax")).toBe("£0.00");
		expect(shown("hourly for £0")).toBe("£0.00");
		expect(shown("£50,000 after tax")).toBe("£39,519.60");
		expect(shown("£50,000 after 20% tax")).toBe("£40,000.00");
		expect(shown("£12,570 after tax")).toBe("£12,570.00");
	});

	test("the pound gate and the other refusals still come first where they did", () => {
		expect(shown("-$50,000 after tax")).toContain("say nothing about USD");
		expect(shown("-50,000 after tax")).toContain("needs a pound salary");
		expect(shown("-£50,000 after 120% tax")).toContain("a tax rate is a percentage between 0 and 100");
		// A clause refusal is about the clause; the salary is refused first, as it is the first thing wrong.
		expect(shown("-£50,000 after tax with student loan")).toBe(`ERROR ${REFUSAL}`);
	});

	test("a salary that is the result of a sum is the salary the sign applies to", () => {
		expect(shown("£10,000 - £60,000 after tax")).toBe(`ERROR ${REFUSAL}`);
		expect(shown("(£60,000 - £10,000) after tax")).toBe("£39,519.60");
		expect(shown("-(£50,000 after tax)")).toBe("-£39,519.60");
	});
});

describe("negativeSalaryRefusal", () => {
	test("ordinary: a salary below zero is refused, zero and above are not", () => {
		const refused = negativeSalaryRefusal(-50_000);
		expect(refused?.type).toBe(ValueType.Error);
		expect(refused?.value).toBe(PayrollErrorCodes.PAYROLL_NEGATIVE_SALARY);
		expect(refused?.errorMessage).toBe(REFUSAL);
		expect(negativeSalaryRefusal(50_000)).toBeNull();
		expect(negativeSalaryRefusal(0)).toBeNull();
	});

	test("boundary: negative zero, the smallest negative, and the largest doubles", () => {
		expect(negativeSalaryRefusal(-0)).toBeNull();
		expect(negativeSalaryRefusal(-Number.MIN_VALUE)?.value).toBe(PayrollErrorCodes.PAYROLL_NEGATIVE_SALARY);
		expect(negativeSalaryRefusal(-Number.MAX_VALUE)?.value).toBe(PayrollErrorCodes.PAYROLL_NEGATIVE_SALARY);
		expect(negativeSalaryRefusal(Number.MAX_VALUE)).toBeNull();
		expect(negativeSalaryRefusal(Number.MIN_VALUE)).toBeNull();
	});

	test("hostile: NaN is left to the arithmetic, an infinity below zero is refused", () => {
		expect(negativeSalaryRefusal(Number.NaN)).toBeNull();
		expect(negativeSalaryRefusal(Number.NEGATIVE_INFINITY)?.value).toBe(PayrollErrorCodes.PAYROLL_NEGATIVE_SALARY);
		expect(negativeSalaryRefusal(Number.POSITIVE_INFINITY)).toBeNull();
	});

	test("the message names nothing internal", () => {
		expect(REFUSAL).not.toMatch(/PAYROLL|gross|NaN|undefined|—/);
	});

	test("every plugin function of the package applies it", () => {
		const fns = PAYROLL_PACKAGE.pluginFunctions ?? {};
		const salary = newTrackedEngine().evaluateExpression("-£50,000");
		for (const name of ["payrollTakeHome", "payrollTakeHomeMonthly", "payrollHourly"]) {
			const result = fns[name]([salary]) as ReturnType<typeof negativeSalaryRefusal>;
			expect({ name, code: result?.value }).toEqual({ name, code: PayrollErrorCodes.PAYROLL_NEGATIVE_SALARY });
		}
		const atRate = fns.payrollTakeHomeAtRate([salary, newTrackedEngine().evaluateExpression("20")]) as ReturnType<typeof negativeSalaryRefusal>;
		expect(atRate?.value).toBe(PayrollErrorCodes.PAYROLL_NEGATIVE_SALARY);
	});
});

describe("adversarial", () => {
	test("security: prototype words as the salary, a long negative sum, markup around the line", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`-${word} after tax`);
				expectHonestDocument(`${word} = -£50,000\n${word} after tax\nhourly for ${word}`);
			}
		});
		// A sum below zero within the line limit is refused by name, and one past it is refused for its length.
		expect(shown(`£0 - (${RESOURCE_PROBES.longSum(100).replace(/(\d+)/g, "£$1")}) after tax`)).toBe(`ERROR ${REFUSAL}`);
		expectHonestLine(`£0 - ${RESOURCE_PROBES.longSum(1_000).replace(/(\d+)/g, "£$1")} after tax`, { budgetMs: 5_000 });
		expectHonestLine(`-${RESOURCE_PROBES.deepParens(200)} after tax`, { budgetMs: 5_000 });
		for (const line of fill("-£50,000 after tax X", TEXT_EDGES)) expectHonestLine(line);
		// A minus that only looks like one is not a sign: the line must still be honest.
		for (const minus of ["−", "‒", "–", "﹣", "－"]) expectHonestLine(`${minus}£50,000 after tax`);
	});

	test("realistic: a salary from the line above, a what-if through it, a check, and both passes", () => {
		const { batch, incremental } = expectHonestDocument("salary = £50,000\nsalary after tax\nline 2 with salary = -£10,000\ncheck salary after tax > £30,000");
		expect(batch[1]).toBe("= £39,519.60");
		expect(batch[2]).toContain("cannot be below zero");
		expect(batch[3]).toBe("= ✓");
		expect(incremental).toEqual(batch);
		const debt = expectHonestDocument("loss = -£5,000\nloss after tax\nloss + £60,000 after tax");
		expect(debt.batch[1]).toContain("cannot be below zero");
		expect(debt.batch[2]).toBe("= £42,457.40");
		expect(debt.incremental).toEqual(debt.batch);
		expect(shown("check -£50,000 after tax > £0")).toContain("cannot be below zero");
		// A typo in the phrase is not a take-home form, and must not answer as one.
		expect(shown("-£50,000 after taxx")).not.toBe("-£50,000.00");
	});

	test("edge: every numeric edge as the salary, negated and not", () => {
		for (const line of fill("-£X after tax", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("£X per month after tax", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("-(X) after 20% tax", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("hourly for -£X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("-£1e308 after tax")).toBe(`ERROR ${REFUSAL}`);
		expect(shown("£-1/0 after tax")).not.toMatch(/^-?£?∞/);
	});
});
