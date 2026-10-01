import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { floatOf, intOfText } from "@solve-js/vm/PlainNumberForms";
import { stringValue } from "@solve-js/vm/Value";

/**
 * Found bug: `int("0xFF")` and `float("0xFF")` were refused as not a number,
 * though `"0xFF" as number` reads 255: `int` and `float` read decimal text
 * only. Both now read the base prefixes `as number` reads (`0x`, `0b`, `0o`,
 * in either case, after a sign) through `numberFromBaseText`, keeping every
 * digit of a large one, and refuse a malformed one the way `as number` does,
 * with `TEXT_NOT_A_NUMBER` and the digits the base has.
 */

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

const HEX_DIGITS = "after 0x, a hexadecimal number has only the digits 0 to 9 and the letters A to F.";

describe("the lines that exposed it", () => {
	test.each([
		["int(\"0xFF\")", "255"],
		["float(\"0xFF\")", "255"],
		["int(\"0XFF\")", "255"],
		["int(\"-0b101\")", "-5"],
		["float(\" 0o17 \")", "15"],
		["int(\"0x20000000000001\")", "9,007,199,254,740,993"],
		["float(\"0x20000000000001\")", "9,007,199,254,740,993"],
		["int(\"0xFF\") + 1", "256"],
		["int(\"0xFF\") in hex", "0xFF"],
	])("%s is %s", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test.each([
		["int(\"0xZZ\")", `TEXT_NOT_A_NUMBER: "0xZZ" is not a number: ${HEX_DIGITS}`],
		["float(\"0xZZ\")", `TEXT_NOT_A_NUMBER: "0xZZ" is not a number: ${HEX_DIGITS}`],
		["int(\"0x\")", "TEXT_NOT_A_NUMBER: \"0x\" is not a number: 0x starts a hexadecimal number, and no digits follow it."],
		["float(\"0b102\")", "TEXT_NOT_A_NUMBER: \"0b102\" is not a number: after 0b, a binary number has only the digits 0 and 1."],
		["int(\"0xFF.8\")", `TEXT_NOT_A_NUMBER: "0xFF.8" is not a number: ${HEX_DIGITS}`],
	])("%s is refused as as number refuses it", (line, expected) => {
		expect(outcome(line)).toBe(expected);
		const text = /\("(.*)"\)/.exec(line)![1];
		expect(outcome(`"${text}" as number`)).toBe(expected);
	});

	test("what was right stays right", () => {
		expect(outcome("int(\"2.7\")")).toBe("2");
		expect(outcome("float(\"2.5\")")).toBe("2.50");
		expect(outcome("int(\"abc\")")).toBe("TEXT_NOT_A_NUMBER: \"abc\" is not a number: int reads text that is a number and nothing else.");
		expect(outcome("float(\"abc\")")).toBe("FLOAT_TAKES_NUMBER: float takes a number, or text that is a number, and \"abc\" is not one.");
		expect(outcome("int(0xFF)")).toBe("255");
	});
});

describe("intOfText and floatOf", () => {
	test("ordinary: each prefix", () => {
		expect(intOfText("0xff").toNumber()).toBe(255);
		expect(intOfText("0b11").toNumber()).toBe(3);
		expect(intOfText("0o10").toNumber()).toBe(8);
		expect(floatOf(stringValue("0x10")).toNumber()).toBe(16);
		expect(floatOf(stringValue("+0b1")).toNumber()).toBe(1);
	});

	test("boundary: zero, negative zero, leading zeros, 2^53 + 1 exact and past the largest double", () => {
		expect(intOfText("0x0").toNumber()).toBe(0);
		expect(Object.is(intOfText("-0x0").toNumber(), 0)).toBe(true);
		expect(intOfText(`0x${"0".repeat(300)}1`).toNumber()).toBe(1);
		expect(intOfText("0x20000000000001").rational?.n).toBe(9007199254740993n);
		expect(floatOf(stringValue(`0x1${"0".repeat(256)}`)).toNumber()).toBe(Number.POSITIVE_INFINITY);
		expect(floatOf(stringValue(`-0x1${"0".repeat(256)}`)).toNumber()).toBe(Number.NEGATIVE_INFINITY);
	});

	test("hostile: markup, a prototype word after a prefix, a million digits sized before they are read", () => {
		expect(intOfText("0x<script>").errorCode).toBe("TEXT_NOT_A_NUMBER");
		expect(floatOf(stringValue("0xconstructor")).errorCode).toBe("TEXT_NOT_A_NUMBER");
		const started = Date.now();
		expect(intOfText(`0x${"F".repeat(1_000_000)}`).toNumber()).toBe(Number.POSITIVE_INFINITY);
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(intOfText(`0x${"Z".repeat(100)}`).errorMessage).toContain("...\"");
	});
});

describe("adversarial", () => {
	test("security: prototype words, look-alike digits, text edges", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`int("0x${word}")`);
				expectHonestLine(`float("0b${word}")`);
				expectHonestDocument(`${word} = "0xFF"\nint(${word})\nfloat(${word}) / 5`);
			}
		});
		expect(outcome("int(\"0x１F\")")).toMatch(/^TEXT_NOT_A_NUMBER: /);
		expect(outcome("float(\"0x​FF\")")).toMatch(/^TEXT_NOT_A_NUMBER: /);
		for (const line of [...fill("int(\"0xX\")", TEXT_EDGES), ...fill("float(\"0xX\")", TEXT_EDGES)]) expectHonestLine(line);
		expectHonestLine(`int("0x${"F".repeat(100_000)}")`, { budgetMs: 5_000 });
	});

	test("realistic: text from a line above, a what-if and a check, both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("code = \"0x1F\"\nint(code)\nfloat(code) / 2\nline 2 with code = \"0b11\"\ncheck int(code) == code as number");
		expect(batch.slice(1)).toEqual(["= 31", "= 15.50", "= 3", "= ✓"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge typed after a prefix is a number or a refusal by name", () => {
		for (const line of [...fill("int(\"0xX\")", NUMERIC_EDGES), ...fill("float(\"-0bX\")", NUMERIC_EDGES)]) {
			const result = expectHonestLine(line);
			if (result.kind === "error") expect(result.code).toBe("TEXT_NOT_A_NUMBER");
		}
	});
});
