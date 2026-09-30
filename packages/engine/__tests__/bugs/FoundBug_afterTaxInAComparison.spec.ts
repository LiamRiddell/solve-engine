import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { PAYROLL_POSTFIX_BINDING_POWER, PayrollPostfixParselet, PayrollRateParselet } from "@solve-js/packages/payroll/parselets/PayrollParselets";
import { PAYROLL_PACKAGE } from "@solve-js/packages/payroll/PayrollPackage";

/**
 * Found bug: `check £50,000 after tax > £30,000` was refused with "a check
 * compares two things", and `£50,000 == £50,000 after tax` took the whole
 * comparison as the salary and refused a boolean for not being pounds. The
 * postfix payroll forms bound at the comparison's own power, `Conditional`: a
 * check reads each side at that power, so the left side stopped short of `after
 * tax`, and on the right of a comparison the phrase was left over for the whole
 * line. Brackets were the only way round it.
 *
 * `after tax`, `per month after tax` and `after 20% tax` now bind one step above
 * a comparison and still below a sum (`PAYROLL_POSTFIX_BINDING_POWER`), so the
 * sum before the phrase is the salary and a comparison beside it is not.
 */

function shown(line: string, engine = newTrackedEngine()): string {
	try {
		const v = engine.evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the lines that exposed it", () => {
	test.each([
		["check £50,000 after tax > £30,000", "✓"],
		["check £50,000 after tax < £30,000", "ERROR check failed: £39,519.60 is not less than £30,000.00"],
		["check £30,000 < £50,000 after tax", "✓"],
		["check £50,000 per month after tax > £3,000", "✓"],
		["check £50,000 after 20% tax == £40,000", "✓"],
		["check £50,000 after tax in Scotland > £30,000", "✓"],
		["check £50,000 after tax ≈ £39,500 within 1%", "✓ (differs by 0.05%)"],
		["£50,000 == £50,000 after tax", "false"],
		["£39,519.60 == £50,000 after tax", "true"],
		["£50,000 after tax > £30,000", "true"],
		["£50,000 after 20% tax > £30,000", "true"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("the sum before the phrase is still the salary, and brackets still work", () => {
		expect(shown("£50,000 + £2,000 after tax")).toBe("£40,717.40");
		expect(shown("2 * £50,000 after tax")).toBe("£68,557.40");
		expect(shown("£50,000 after tax * 2")).toBe("£79,039.20");
		expect(shown("check (£50,000 after tax) > £30,000")).toBe("✓");
		expect(shown("(£50,000 == £50,000) after tax")).toContain("needs a pound salary");
	});
});

describe("PAYROLL_POSTFIX_BINDING_POWER", () => {
	test("sits above a comparison and below a sum and a shift", () => {
		expect(PAYROLL_POSTFIX_BINDING_POWER).toBeGreaterThan(BindingPower.Conditional);
		expect(PAYROLL_POSTFIX_BINDING_POWER).toBeLessThan(BindingPower.Shift);
		expect(PAYROLL_POSTFIX_BINDING_POWER).toBeLessThan(BindingPower.Sum);
		expect(Number.isInteger(PAYROLL_POSTFIX_BINDING_POWER)).toBe(true);
	});

	test("every postfix payroll parselet the package registers uses it", () => {
		expect(new PayrollPostfixParselet("payrollTakeHome").bindingPower).toBe(PAYROLL_POSTFIX_BINDING_POWER);
		expect(new PayrollRateParselet("payrollTakeHomeAtRate").bindingPower).toBe(PAYROLL_POSTFIX_BINDING_POWER);
		for (const [type, parselet] of Object.entries(PAYROLL_PACKAGE.infixParselets ?? {})) {
			expect({ type, bindingPower: parselet.bindingPower }).toEqual({ type, bindingPower: PAYROLL_POSTFIX_BINDING_POWER });
		}
	});
});

describe("adversarial", () => {
	test("security: prototype words as the salary, markup after the check, a long chain of comparisons", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`check ${word} after tax > £30,000`);
				expectHonestDocument(`${word} = £50,000\ncheck ${word} after tax > £30,000`);
			}
		});
		for (const line of fill("check £50,000 after tax > £30,000 X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine(Array.from({ length: 500 }, () => "£50,000 after tax").join(" > "), { budgetMs: 5_000 });
		expectHonestLine(`check ${RESOURCE_PROBES.longSum(1_000)} after tax > £30,000`, { budgetMs: 5_000 });
	});

	test("realistic: a salary from the line above, a what-if through the check, and both passes", () => {
		const { batch, incremental } = expectHonestDocument("salary = £50,000\ncheck salary after tax > £30,000\ncheck salary after tax > £45,000\nline 2 with salary = £20,000");
		expect(batch.slice(0, 2)).toEqual(["= £50,000.00", "= ✓"]);
		expect(batch[2]).toContain("£39,519.60 is not more than £45,000.00");
		expect(incremental).toEqual(batch);
		// A typo in the phrase is not a take-home form, and a dollar salary is refused by name.
		expect(shown("check £50,000 after taxx > £30,000")).not.toMatch(/^✓/);
		expect(shown("check $50,000 after tax > $30,000")).toContain("say nothing about USD");
	});

	test("edge: every numeric edge as the salary and as the other side", () => {
		for (const line of fill("check £X after tax > £30,000", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("check £50,000 after tax > £X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("£X after tax == £X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
