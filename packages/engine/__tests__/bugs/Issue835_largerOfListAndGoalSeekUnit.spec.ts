import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { unitOf, inUnknownUnit, targetInLineUnit } from "@solve-js/packages/goalseek/GoalSeekPluginFunctions";
import { ValueType, Value, numberValue, uomValue, stringValue, percentageValue } from "@solve-js/vm/Value";

/**
 * Issue #835: `larger of 10 and 4 and 12` was 16, since the phrase read two
 * values and a third `and` became the addition it also is; and goal seek
 * answered a bare number for an unknown that was an amount of money, so
 * `solve line 3 for price = £1,500` dropped the pound sign. The phrase now
 * takes a list, and goal seek answers in the unit its unknown has, reading a
 * target in another unit of the line's measure in the line's unit first.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** Each line's answer through the incremental pass, the one that solves a goal seek. */
function solved(lines: string[]): string[] {
	return evaluateDocument(newTrackedEngine(), lines.join("\n"), { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

describe("larger of, smaller of, gcd of and lcm of take a list", () => {
	test.each([
		["larger of 10 and 4", "10"],
		["larger of 10 and 4 and 12", "12"],
		["larger of 10 and 4 and 12 and 20", "20"],
		["larger of 12 and 4 and 10", "12"],
		["smaller of 10 and 4", "4"],
		["smaller of 10 and 4 and 12", "4"],
		["smaller of 10 and 40 and 12 and 2", "2"],
		["greater of 1 and 2 and 3", "3"],
		["lesser of 3 and 2 and 1", "1"],
		["gcd of 12 and 18", "6"],
		["gcd of 12 and 18 and 8", "2"],
		["lcm of 2 and 3 and 4", "12"],
		["larger of 1 + 1 and 3", "3"],
		["larger of 1 and 2 + 5 and 3", "7"],
		["larger of 5 km and 3000 m and 4 km", "5.00 km"],
		["larger of $5 and $10 and $7", "$10.00"],
	])("%s is %s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("a third value is never added: each list agrees with the call form", () => {
		expect(show("larger of 10 and 4 and 12")).toBe(show("max(10, 4, 12)"));
		expect(show("smaller of 10 and 4 and 12")).toBe(show("min(10, 4, 12)"));
	});

	test("a value from the line above, and the phrase inside an expression", () => {
		const lines = newTrackedEngine().parseDocument("a = 10\nb = 4\nlarger of a and b and 12\n(larger of 1 and 2 and 3) * 2").lines;
		expect(lines.map((l) => formatValue(l.result!))).toEqual(["= 10", "= 4", "= 12", "= 6"]);
	});

	test("a dangling and is refused, not read as zero", () => {
		expect(show("larger of 10 and 4 and")).toMatch(/^THROWS /);
		expect(show("larger of 10")).toMatch(/^THROWS /);
	});
});

describe("goal seek answers in the unit its unknown has", () => {
	test("money, through the closed form", () => {
		expect(solved([":price = £200", ":qty = 3", "price * qty", "solve line 3 for price = £1,500"])[3]).toBe("£500.00");
		expect(solved([":price = $200", "price + $10", "solve line 2 for price = $50"])[2]).toBe("$40.00");
	});

	test("money, through the numeric search", () => {
		expect(solved([":deposit = £100000", ":rate = 4%", "monthly repayment on deposit over 25 years at rate", "solve line 3 for deposit = £900"])[3]).toBe("£170,507.23");
	});

	test("a plain unknown stays plain, whatever the target's unit", () => {
		expect(solved([":price = £200", ":qty = 3", "price * qty", "solve line 3 for qty = £1,500"])[3]).toBe("7.50");
		expect(solved([":x = 4", "x * 2 + 10", "solve line 2 for x = 30"])[2]).toBe("10");
		expect(solved([":price = £200", "price * 3", "solve line 2 for price = 1500"])[2]).toBe("£500.00");
	});

	test("a unit line: the answer is a quantity, and the target is read in the line's unit", () => {
		expect(solved([":d = 5 km", "d * 2", "solve line 2 for d = 30 km"])[2]).toBe("15.00 km");
		expect(solved([":d = 5 km", "d * 2", "solve line 2 for d = 3000 m"])[2]).toBe("1.50 km");
		expect(solved([":d = 5 km", ":t = 2 h", "d / t", "solve line 3 for d = 10 km/h"])[3]).toBe("20.00 km");
	});

	test("a target that measures something else, or is another currency, is refused by name", () => {
		expect(solved([":d = 5 km", "d * 2", "solve line 2 for d = 3 kg"])[2]).toBe("Line 2 answers in km and the target is in kg, so the two cannot be compared. Write the target in km.");
		expect(solved([":price = £200", "price * 3", "solve line 2 for price = $1500"])[2]).toBe("Line 2 answers in GBP and the target is in USD, so the two cannot be compared. Write the target in GBP.");
	});

	test("the batch pass and the single line still refuse, as every goal seek is refused there", () => {
		const text = ":price = £200\n:qty = 3\nprice * qty\nsolve line 3 for price = £1,500";
		const batch = newTrackedEngine().parseDocument(text).lines[3].result!;
		expect(batch.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
		expect(newTrackedEngine().evaluateExpression("solve line 3 for price = £1,500").errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
	});
});

describe("the parts", () => {
	test("unitOf reads a quantity's unit and nothing else", () => {
		expect(unitOf(uomValue(5, "km"))).toBe("km");
		expect(unitOf(uomValue(5, "GBP"))).toBe("GBP");
		expect(unitOf(numberValue(5))).toBeUndefined();
		expect(unitOf(percentageValue(0.5))).toBeUndefined();
		expect(unitOf(stringValue("km"))).toBeUndefined();
		expect(unitOf(undefined)).toBeUndefined();
	});

	test("inUnknownUnit: a plain number, a quantity and exact money", () => {
		expect(inUnknownUnit(10, undefined).type).toBe(ValueType.Number);
		expect(formatValue(inUnknownUnit(1.5, "km"))).toBe("= 1.50 km");
		expect(formatValue(inUnknownUnit(500, "GBP"))).toBe("= £500.00");
		expect(formatValue(inUnknownUnit(-0, "GBP"))).toMatch(/£0\.00/);
		expect(formatValue(inUnknownUnit(Number.MAX_SAFE_INTEGER, undefined))).toBe("= 9,007,199,254,740,991");
	});

	test("targetInLineUnit: as written, converted, or refused", () => {
		expect(targetInLineUnit(numberValue(30), "km", 2)).toBe(30);
		expect(targetInLineUnit(uomValue(30, "km"), undefined, 2)).toBe(30);
		expect(targetInLineUnit(uomValue(30, "km"), "km", 2)).toBe(30);
		expect(targetInLineUnit(uomValue(3000, "m"), "km", 2)).toBe(3);
		expect(targetInLineUnit(uomValue(0, "m"), "km", 2)).toBe(0);
		const mass = targetInLineUnit(uomValue(3, "kg"), "km", 2);
		expect(mass instanceof Value && mass.errorCode).toBe("GOAL_SEEK_TARGET_UNIT_MISMATCH");
		const currency = targetInLineUnit(uomValue(3, "USD"), "GBP", 4);
		expect(currency instanceof Value && currency.errorMessage).toBe("Line 4 answers in GBP and the target is in USD, so the two cannot be compared. Write the target in GBP.");
		const hostile = targetInLineUnit(uomValue(3, "constructor"), "km", 2);
		expect(hostile instanceof Value && hostile.errorCode).toBe("GOAL_SEEK_TARGET_UNIT_MISMATCH");
	});
});

describe("adversarial", () => {
	test("security: prototype words as the unknown, the list's values and the target's unit", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`larger of ${word} and 4 and 12`);
				expectHonestLine(`larger of 10 and 4 and ${word}`);
				expectHonestDocument(`:${word} = £200\n${word} * 3\nsolve line 2 for ${word} = £1,500`, { agree: false });
				expectHonestDocument(`:price = £200\nprice * 3\nsolve line 2 for price = 1500 ${word}`, { agree: false });
			}
		});
	});

	test("security: a long list is answered in time", () => {
		const many = Array.from({ length: 250 }, (_, i) => String(i)).join(" and ");
		expect(show(`larger of ${many}`)).toBe("249");
		expect(show(`smaller of ${many}`)).toBe("0");
		expectHonestLine(`smaller of ${many}`, { budgetMs: 5_000 });
		expectHonestLine(`larger of ${RESOURCE_PROBES.deepParens(500)} and 2 and 3`);
	});

	test("realistic: a goal seek over a money line through an edit and a what-if", () => {
		expectHonestDocument(":price = £200\n:qty = 3\nprice * qty\nsolve line 3 for price = £1,500\nline 3 with qty = 5", { agree: false });
		expect(solved([":price = £200", ":qty = 3", "price * qty", "solve line 3 for price = £1,500", "line 3 with qty = 5"])).toEqual(["£200.00", "3", "£600.00", "£500.00", "£1,000.00"]);
		// The seek's answer reads back as money.
		expect(solved([":price = £200", ":qty = 3", "price * qty", "solve line 3 for price = £1,500", "line 4 + £1"])[4]).toBe("£501.00");
	});

	test("edge cases: the numeric corpus through the list and the target", () => {
		for (const line of fill("larger of X and 4 and 12", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		for (const text of fill(":price = £200\nprice * 3\nsolve line 2 for price = £X", NUMERIC_EDGES)) {
			expectHonestDocument(text, { agree: false, allowNaN: text.includes("0/0") });
		}
		expect(solved([":price = £200", "price * 3", "solve line 2 for price = £0"])[2]).toMatch(/£0\.00|No value/);
	});
});
