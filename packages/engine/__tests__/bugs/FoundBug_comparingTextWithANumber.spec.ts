import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, boolValue, errorValue, hexValue, numberValue, stringValue, uomValue } from "@solve-js/vm/Value";
import { textAgainstOther, textOrderRefused, valuesEqual, valuesOrdered } from "@solve-js/vm/Comparisons";

/**
 * Found bug: a bare `255 == "255"` answered true, because `==` read the text
 * through `toNumber()`, while `check 255 == "255"` is refused as
 * CHECK_INCOMPARABLE. The same reading made `"abc" == 0` true (text that is
 * not a number read as 0), `"5" > 3` true, and `"a" < "b"` and `"b" > "a"`
 * both false. The conditionals page pinned none of this. A comparison now
 * treats text and a number as the two kinds of thing a check does: `==`
 * answers false and `!=` true, as they do for a length beside a mass, and an
 * order with text on either side is refused by name (TEXT_COMPARISON), with
 * the `as number` hint a check gives for text that holds a number.
 */

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

describe("the lines that exposed it", () => {
	test.each([
		["255 == \"255\"", "false"],
		["255 != \"255\"", "true"],
		["\"abc\" == 0", "false"],
		["\"\" == 0", "false"],
		["\"abc\" != 0", "true"],
		["(255 in hex) == \"0xFF\"", "false"],
		["$5 == \"5\"", "false"],
		["true == \"true\"", "false"],
		["if \"5\" == 5 then 1 else 2", "2"],
	])("%s is %s", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test.each([
		["\"5\" > 3", "TEXT_COMPARISON: \"5\" on the left is text and the other side is a number, so they cannot be put in order. To read the text as a number, write \"5\" as number."],
		["3 >= \"0xFF\"", "TEXT_COMPARISON: \"0xFF\" on the right is text and the other side is a number, so they cannot be put in order. To read the text as a number, write \"0xFF\" as number."],
		["\"abc\" < 1", "TEXT_COMPARISON: \"abc\" on the left is text and the other side is a number, so they cannot be put in order."],
		["\"a\" < \"b\"", "TEXT_COMPARISON: Text has no order: two pieces of text can only be compared with == or !=, not <."],
		["\"b\" >= \"a\"", "TEXT_COMPARISON: Text has no order: two pieces of text can only be compared with == or !=, not >=."],
		["5 km <= \"5\"", "TEXT_COMPARISON: \"5\" on the right is text and the other side is an amount in km, so they cannot be put in order. To read the text as a number, write \"5\" as number."],
	])("%s is refused by name", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test("what was right stays right, and the check agrees", () => {
		expect(outcome("\"paid\" == \"paid\"")).toBe("true");
		expect(outcome("\"paid\" != \"due\"")).toBe("true");
		expect(outcome("\"255\" as number == 255")).toBe("true");
		expect(outcome("1 m == 1 kg")).toBe("false");
		expect(outcome("check 255 == \"255\"")).toMatch(/^CHECK_INCOMPARABLE: /);
		expect(outcome("check \"a\" > \"b\"")).toMatch(/^CHECK_INCOMPARABLE: /);
	});
});

describe("textAgainstOther and textOrderRefused", () => {
	test("ordinary: text beside a number, and two texts", () => {
		expect(textAgainstOther(stringValue("1"), numberValue(1))).toBe(true);
		expect(textAgainstOther(numberValue(1), stringValue("1"))).toBe(true);
		expect(textAgainstOther(stringValue("a"), stringValue("a"))).toBe(false);
		expect(textAgainstOther(numberValue(1), numberValue(1))).toBe(false);
	});

	test("boundary: every operator, an empty text, a long text cut short, a number in a base", () => {
		for (const op of [0, 1, 2, 3] as const) expect(textOrderRefused(stringValue("1"), numberValue(1), op).errorCode).toBe("TEXT_COMPARISON");
		expect(textOrderRefused(stringValue(""), numberValue(0), 0).errorMessage).toBe("\"\" on the left is text and the other side is a number, so they cannot be put in order.");
		expect(textOrderRefused(numberValue(1), stringValue("x".repeat(100)), 2).errorMessage).toContain(`"${"x".repeat(40)}..."`);
		expect(textOrderRefused(hexValue(255, "hex"), stringValue("255"), 2).errorMessage).toContain("To read the text as a number");
	});

	test("hostile: markup and prototype words are quoted back as text", () => {
		expect(textOrderRefused(stringValue("<script>"), numberValue(1), 0).errorMessage).toContain("\"<script>\" on the left");
		expect(textOrderRefused(stringValue("__proto__"), boolValue(true), 0).errorMessage).toContain("true or false");
	});

	test("valuesEqual and valuesOrdered: text beside each other kind, and a fault still wins", () => {
		expect(valuesEqual(stringValue("5"), numberValue(5), false).value).toBe(false);
		expect(valuesEqual(stringValue("5"), numberValue(5), true).value).toBe(true);
		expect(valuesEqual(uomValue(5, "m"), stringValue("5"), false).value).toBe(false);
		expect(valuesEqual(stringValue("a"), stringValue("a"), false).value).toBe(true);
		expect(valuesOrdered(stringValue("5"), numberValue(5), 0).type).toBe(ValueType.Error);
		const fault = errorValue("X", "a fault");
		expect(valuesEqual(fault, stringValue("a"), false)).toBe(fault);
		expect(valuesOrdered(stringValue("a"), fault, 0)).toBe(fault);
	});
});

describe("adversarial", () => {
	test("security: prototype words, a long text, deep brackets and look-alike characters", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`"${word}" == 0`);
				expectHonestLine(`"${word}" < 1`);
				expectHonestDocument(`${word} = "5"\n${word} == 5\n${word} > 3`);
			}
		});
		expectHonestLine(`${RESOURCE_PROBES.longText()} > 1`, { budgetMs: 5_000 });
		expectHonestLine(`${RESOURCE_PROBES.deepParens(200)} == "1"`, { budgetMs: 5_000 });
		expect(outcome("\"５\" == 5")).toBe("false");
		expect(outcome("\"​5\" == 5")).toBe("false");
		for (const line of fill("\"X\" == 5", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("\"X\" < 5", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: text from a line above, a condition, a what-if, a check, both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("code = \"255\"\ncode == 255\ncode as number == 255\nif code == \"255\" then 1 else 0\ncode > 3\nline 2 with code = \"7\"");
		expect(batch.slice(1, 5)).toEqual(["= false", "= true", "= 1", expect.stringMatching(/^ERROR "255" on the left is text/)]);
		expect(batch[5]).toBe("= false");
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge against its own text", () => {
		for (const line of [...fill("X == \"X\"", NUMERIC_EDGES), ...fill("\"X\" != X", NUMERIC_EDGES), ...fill("X <= \"X\"", NUMERIC_EDGES)]) {
			const result = expectHonestLine(line);
			if (result.kind === "value") expect({ line, text: result.text }).toEqual({ line, text: line.includes("!=") ? "= true" : "= false" });
		}
	});
});
