import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberFromBaseText } from "@solve-js/vm/PlainNumberForms";

/**
 * Found bug: `"0xFF" as number` was refused as TEXT_NOT_A_NUMBER, though
 * `0xFF` typed as a number is 255. `as number` read decimal digits only. It
 * now reads the prefixes a typed number reads (`0x`, `0b`, `0o`, in either
 * case, after an optional sign) through `numberFromBaseText`, keeping every
 * digit of a large one, and refuses a prefix with no digits or with a digit
 * its base does not have by name, saying which digits the base has. A check
 * against such text now offers the `as number` it points at.
 */

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

describe("the lines that exposed it", () => {
	test.each([
		["\"0xFF\" as number", "255"],
		["\"0XFF\" as number", "255"],
		["\"0xff\" as number", "255"],
		["\"0b101\" as number", "5"],
		["\"0B101\" as number", "5"],
		["\"0o17\" as number", "15"],
		["\"0O17\" as number", "15"],
		["\"-0xff\" as number", "-255"],
		["\"+0b1\" as number", "1"],
		["\" 0x1F \" as number", "31"],
		["\"0x20000000000001\" as number", "9,007,199,254,740,993"],
		["\"0xFF\" as number + 1", "256"],
		["(\"0xFF\" as number) in hex", "0xFF"],
	])("%s is %s", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test.each([
		["\"0x\" as number", "\"0x\" is not a number: 0x starts a hexadecimal number, and no digits follow it."],
		["\"0b\" as number", "\"0b\" is not a number: 0b starts a binary number, and no digits follow it."],
		["\"0xZZ\" as number", "\"0xZZ\" is not a number: after 0x, a hexadecimal number has only the digits 0 to 9 and the letters A to F."],
		["\"0b102\" as number", "\"0b102\" is not a number: after 0b, a binary number has only the digits 0 and 1."],
		["\"0o19\" as number", "\"0o19\" is not a number: after 0o, an octal number has only the digits 0 to 7."],
		["\"0xFF.8\" as number", "\"0xFF.8\" is not a number: after 0x, a hexadecimal number has only the digits 0 to 9 and the letters A to F."],
		["\"0x F\" as number", "\"0x F\" is not a number: after 0x, a hexadecimal number has only the digits 0 to 9 and the letters A to F."],
	])("%s is refused by name", (line, message) => {
		expect(outcome(line)).toBe(`TEXT_NOT_A_NUMBER: ${message}`);
	});

	test("what was right stays right, and a check now offers the conversion", () => {
		expect(outcome("\"255\" as number")).toBe("255");
		expect(outcome("\"1,234.5\" as number")).toBe("1,234.50");
		expect(outcome("\"0255\" as number")).toBe("255");
		expect(outcome("\"x0FF\" as number")).toMatch(/^TEXT_NOT_A_NUMBER: "x0FF" is not a number: "as number" reads/);
		expect(outcome("check (255 in hex) == \"0xFF\"")).toMatch(/To read the text as a number, write "0xFF" as number$/);
		expect(outcome("check \"0xFF\" as number == 255")).toBe("✓");
	});
});

describe("numberFromBaseText", () => {
	test("ordinary: each prefix, and text with none is left alone", () => {
		expect(numberFromBaseText("0xFF", "0xFF")!.value).toBe(255);
		expect(numberFromBaseText("0b11", "0b11")!.value).toBe(3);
		expect(numberFromBaseText("0o10", "0o10")!.value).toBe(8);
		expect(numberFromBaseText("255", "255")).toBeNull();
		expect(numberFromBaseText("", "")).toBeNull();
		expect(numberFromBaseText("x0FF", "x0FF")).toBeNull();
	});

	test("boundary: zero, leading zeros, 2^53 + 1 exact, the largest double and past it", () => {
		expect(numberFromBaseText("0x0", "0x0")!.value).toBe(0);
		expect(Object.is(numberFromBaseText("-0x0", "-0x0")!.value, 0)).toBe(true);
		expect(numberFromBaseText(`0x${"0".repeat(500)}1`, "")!.value).toBe(1);
		expect(numberFromBaseText("0x20000000000001", "")!.rational?.n).toBe(9007199254740993n);
		expect(numberFromBaseText(`0x${"F".repeat(13)}${"F".repeat(243)}`, "")!.value).toBe(Number.POSITIVE_INFINITY);
		expect(numberFromBaseText(`0x1${"0".repeat(256)}`, "")!.value).toBe(Number.POSITIVE_INFINITY);
		expect(numberFromBaseText(`0x1${"0".repeat(255)}`, "")!.value).toBe(2 ** 1020);
		expect(numberFromBaseText(`0x${"F".repeat(255)}`, "")!.value).toBeLessThan(Number.POSITIVE_INFINITY);
		expect(numberFromBaseText(`-0b1${"0".repeat(2000)}`, "")!.value).toBe(Number.NEGATIVE_INFINITY);
	});

	test("hostile: a long text is quoted short, and a huge one is sized before it is read", () => {
		const long = `0x${"Z".repeat(100)}`;
		expect(numberFromBaseText(long, long)!.errorMessage).toContain(`"${long.slice(0, 40)}..."`);
		const huge = `0x${"F".repeat(1_000_000)}`;
		const started = Date.now();
		expect(numberFromBaseText(huge, huge)!.value).toBe(Number.POSITIVE_INFINITY);
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(numberFromBaseText("0x<script>", "0x<script>")!.errorCode).toBe("TEXT_NOT_A_NUMBER");
	});
});

describe("adversarial", () => {
	test("security: prototype words, look-alike digits and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`"0x${word}" as number`);
				expectHonestDocument(`${word} = "0xFF"\n${word} as number\n${word} as number + 1`);
			}
		});
		expect(outcome("\"0x１F\" as number")).toMatch(/^TEXT_NOT_A_NUMBER: /);
		expect(outcome("\"0x​FF\" as number")).toMatch(/^TEXT_NOT_A_NUMBER: /);
		expect(outcome("\"٠xFF\" as number")).toMatch(/^TEXT_NOT_A_NUMBER: /);
		for (const line of fill("\"0xX\" as number", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine(`"0x${"F".repeat(100_000)}" as number`, { budgetMs: 5_000 });
	});

	test("realistic: text from a line above, a what-if, arithmetic and a check, both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("code = \"0x1F\"\ncode as number\ncode as number * 2\nline 2 with code = \"0b11\"\ncheck code as number == 31");
		expect(batch.slice(1)).toEqual(["= 31", "= 62", "= 3", "= ✓"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge typed after a prefix is a number or a refusal by name", () => {
		for (const line of [...fill("\"0xX\" as number", NUMERIC_EDGES), ...fill("\"0bX\" as number", NUMERIC_EDGES), ...fill("\"-0oX\" as number", NUMERIC_EDGES)]) {
			const result = expectHonestLine(line);
			if (result.kind === "error") expect(result.code).toBe("TEXT_NOT_A_NUMBER");
		}
	});
});
