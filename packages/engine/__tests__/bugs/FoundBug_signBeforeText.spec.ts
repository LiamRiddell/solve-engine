import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, RESOURCE_PROBES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { textSignRefused } from "@solve-js/vm/PlainNumberForms";

/**
 * Found bug: a minus sign before text read the text through `toNumber()`, so
 * `-"abc"` answered 0, and `-"0xFF" as number` answered 0 too: the minus binds
 * before `as`, so the line negated the text (0) and then converted the 0. A
 * plus sign did the same (`+"abc"` was 0). Text is refused in arithmetic by
 * name, and a sign is arithmetic, so both are now refused with
 * `TEXT_ARITHMETIC`, and text that holds a number is pointed at the
 * conversion in brackets, `-("0xFF" as number)`, which still works.
 */

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

const MINUS_GENERAL = "TEXT_ARITHMETIC: Text cannot be negated: a minus sign works on numbers and quantities, not text. To negate a number held as text, convert it first with \"as number\", in brackets.";
const minusFor = (text: string): string => `TEXT_ARITHMETIC: Text cannot be negated: a minus sign works on numbers and quantities, not text. To negate the number "${text}" holds, convert it first, in brackets: -("${text}" as number).`;

describe("the lines that exposed it", () => {
	test.each([
		["-\"abc\"", MINUS_GENERAL],
		["-\"0xFF\" as number", minusFor("0xFF")],
		["-\"5\"", minusFor("5")],
		["- \"1,234.5\"", minusFor("1,234.5")],
		["-\"\"", MINUS_GENERAL],
		["+\"abc\"", "TEXT_ARITHMETIC: Text has no sign: a plus sign works on numbers and quantities, not text. To read a number held as text, convert it with \"as number\"."],
		["+\"5\"", "TEXT_ARITHMETIC: Text has no sign: a plus sign works on numbers and quantities, not text. To read the number \"5\" holds, write \"5\" as number."],
	])("%s is refused by name", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test("the conversion in brackets works, and the other signed forms are unchanged", () => {
		expect(outcome("-(\"0xFF\" as number)")).toBe("-255");
		expect(outcome("-(\"5\" as number) * 2")).toBe("-10");
		expect(outcome("\"-5\" as number")).toBe("-5");
		expect(outcome("-5")).toBe("-5");
		expect(outcome("-$5")).toBe("-$5.00");
		expect(outcome("-10%")).toBe("-10.00%");
		expect(outcome("+5 km")).toBe("5.00 km");
		expect(outcome("\"a\" + \"b\"")).toBe("ab");
	});
});

describe("textSignRefused", () => {
	test("ordinary: text that holds a number is pointed at its conversion, other text at the general one", () => {
		expect(textSignRefused("5", "minus").errorMessage).toContain("-(\"5\" as number)");
		expect(textSignRefused("0b101", "minus").errorMessage).toContain("-(\"0b101\" as number)");
		expect(textSignRefused("abc", "minus").errorMessage).toContain("convert it first with \"as number\", in brackets.");
		expect(textSignRefused("5", "plus").errorMessage).toContain("write \"5\" as number.");
		expect(textSignRefused("abc", "plus").errorCode).toBe("TEXT_ARITHMETIC");
	});

	test("boundary: empty and blank text, a malformed base, padding", () => {
		expect(textSignRefused("", "minus").errorMessage).toBe(MINUS_GENERAL.replace("TEXT_ARITHMETIC: ", ""));
		expect(textSignRefused("   ", "plus").errorMessage).not.toContain("holds");
		expect(textSignRefused("0xZZ", "minus").errorMessage).not.toContain("holds");
		expect(textSignRefused(" 7 ", "minus").errorMessage).toContain("-(\" 7 \" as number)");
	});

	test("hostile: long text is quoted short, markup is quoted as text", () => {
		const long = "9".repeat(100);
		expect(textSignRefused(long, "minus").errorMessage).toContain(`"${"9".repeat(40)}..."`);
		expect(textSignRefused("<script>", "minus").errorMessage).toBe(MINUS_GENERAL.replace("TEXT_ARITHMETIC: ", ""));
		expect(textSignRefused("constructor", "plus").isError()).toBe(true);
	});
});

describe("adversarial", () => {
	test("security: prototype words as text and as a name holding text, long text, look-alike digits", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(outcome(`-"${word}"`)).toBe(MINUS_GENERAL);
				expectHonestDocument(`${word} = "5"\n-${word}\n-(${word} as number)`);
			}
		});
		expectHonestLine(`-${RESOURCE_PROBES.longText()}`, { budgetMs: 2_000 });
		expectHonestLine("-".repeat(2_000) + "\"5\"", { budgetMs: 5_000 });
		expect(outcome("-\"５\"")).toBe(MINUS_GENERAL);
		expect(outcome("-\"٥\"")).toBe(MINUS_GENERAL);
		for (const line of fill("-\"X\"", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: text from a line above, a total and a check over it, both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("code = \"0x1F\"\n-code\n-(code as number)\n-(code as number) * 2\ncheck -(code as number) == -31");
		expect(batch.slice(1)).toEqual([`ERROR ${minusFor("0x1F").replace("TEXT_ARITHMETIC: ", "")}`, "= -31", "= -62", "= ✓"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge written as text after a sign is refused by name", () => {
		for (const edge of NUMERIC_EDGES) {
			const minus = expectHonestLine(`-"${edge}"`);
			const plus = expectHonestLine(`+"${edge}"`);
			expect(minus.kind === "error" && minus.code).toBe("TEXT_ARITHMETIC");
			expect(plus.kind === "error" && plus.code).toBe("TEXT_ARITHMETIC");
		}
	});
});
