import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, RESOURCE_PROBES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { pastSafeBaseLiteralDigits } from "@solve-js/parser/WholeLiteral";
import { numberFromBaseText } from "@solve-js/vm/PlainNumberForms";

/**
 * Found bug: a typed hex, binary or octal literal past 2^53 was read with
 * `parseInt` into the nearest double, so `0xFFFFFFFFFFFFFFFFFFFF` showed
 * 1,208,925,819,614,629,200,000,000 with its last digits invented, while
 * `"0xFFFFFFFFFFFFFFFFFFFF" as number` already gave every digit. Such a literal
 * is now compiled from its exact digits (`pastSafeBaseLiteralDigits`) to the
 * PUSH_DECIMAL opcode a long decimal literal takes, so it keeps its exact
 * integer, as `9007199254740993` does.
 */

function outcome(line: string): string {
	const v = newTrackedEngine().evaluateExpression(line);
	return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
}

describe("the lines that exposed it", () => {
	test.each([
		["0xFFFFFFFFFFFFFFFFFFFF", "1,208,925,819,614,629,174,706,175"],
		["0x20000000000001", "9,007,199,254,740,993"],
		["0X20000000000001", "9,007,199,254,740,993"],
		["0b100000000000000000000000000000000000000000000000000001", "9,007,199,254,740,993"],
		["0o400000000000000001", "9,007,199,254,740,993"],
		["0O400000000000000001", "9,007,199,254,740,993"],
		["-0xFFFFFFFFFFFFFFFFFFFF", "-1,208,925,819,614,629,174,706,175"],
		["0xFFFFFFFFFFFFFFFFFFFF + 1", "1,208,925,819,614,629,174,706,176"],
		["0x20000000000001 - 0x20000000000000", "1"],
		["0x20000000000001 * 3", "27,021,597,764,222,979"],
		["0xFFFFFFFFFFFFFFFFFFFF in hex", "0xFFFFFFFFFFFFFFFFFFFF"],
	])("%s is %s", (line, expected) => {
		expect(outcome(line)).toBe(expected);
	});

	test("the typed literal and the same text read by as number agree", () => {
		for (const digits of ["FFFFFFFFFFFFFFFFFFFF", "20000000000001", "1FFFFFFFFFFFFF", "123456789ABCDEF0123"]) {
			expect(outcome(`0x${digits}`)).toBe(outcome(`"0x${digits}" as number`));
		}
	});

	test("what was right stays right", () => {
		expect(outcome("0xFF")).toBe("255");
		expect(outcome("0x1FFFFFFFFFFFFF")).toBe("9,007,199,254,740,991");
		expect(outcome("0b101 + 1")).toBe("6");
		expect(outcome("9007199254740993")).toBe("9,007,199,254,740,993");
	});
});

describe("pastSafeBaseLiteralDigits", () => {
	test("ordinary: a literal past 2^53 in each base gives its decimal digits", () => {
		expect(pastSafeBaseLiteralDigits("0x20000000000001", 2 ** 53)).toBe("9007199254740993");
		expect(pastSafeBaseLiteralDigits("0b1" + "0".repeat(52) + "1", 2 ** 53)).toBe("9007199254740993");
		expect(pastSafeBaseLiteralDigits("0o400000000000000001", 2 ** 53)).toBe("9007199254740993");
		expect(pastSafeBaseLiteralDigits("0XFF" + "F".repeat(16), 2 ** 72)).toBe(BigInt(`0x${"F".repeat(18)}`).toString());
	});

	test("boundary: 2^53 - 1 and below need nothing, 2^53 itself does, and Infinity is left alone", () => {
		expect(pastSafeBaseLiteralDigits("0x1FFFFFFFFFFFFF", Number.MAX_SAFE_INTEGER)).toBeNull();
		expect(pastSafeBaseLiteralDigits("0x0", 0)).toBeNull();
		expect(pastSafeBaseLiteralDigits("0x20000000000000", 2 ** 53)).toBe("9007199254740992");
		expect(pastSafeBaseLiteralDigits(`0x1${"0".repeat(256)}`, Number.POSITIVE_INFINITY)).toBeNull();
		expect(pastSafeBaseLiteralDigits("0x1", Number.NaN)).toBeNull();
	});

	test("hostile: anything that is not a whole base literal is refused without building a bigint", () => {
		expect(pastSafeBaseLiteralDigits("9007199254740993", 2 ** 53)).toBeNull();
		expect(pastSafeBaseLiteralDigits("0xZZ", 2 ** 60)).toBeNull();
		expect(pastSafeBaseLiteralDigits("0b102", 2 ** 60)).toBeNull();
		expect(pastSafeBaseLiteralDigits("0x", 2 ** 60)).toBeNull();
		expect(pastSafeBaseLiteralDigits("0x1F.8", 2 ** 60)).toBeNull();
		expect(pastSafeBaseLiteralDigits("constructor", 2 ** 60)).toBeNull();
		expect(pastSafeBaseLiteralDigits("0x<script>", 2 ** 60)).toBeNull();
	});

	test("it agrees with numberFromBaseText on every literal it handles", () => {
		for (const raw of ["0x20000000000001", "0xFFFFFFFFFFFFFFFFFFFF", "0b" + "1".repeat(60), "0o" + "7".repeat(30)]) {
			const typed = pastSafeBaseLiteralDigits(raw, Number(BigInt(raw)));
			expect(typed).toBe(numberFromBaseText(raw, raw)!.rational?.n.toString());
		}
	});
});

describe("adversarial", () => {
	test("security: prototype words beside a long literal, a literal sized to the double's limit, look-alike digits", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`0xFFFFFFFFFFFFFFFFFFFF + ${word}`);
				expectHonestDocument(`${word} = 0xFFFFFFFFFFFFFFFFFFFF\n${word} + 1`);
			}
		});
		expect(outcome(`0x${"F".repeat(256)}`)).toBe("∞");
		expectHonestLine(`0x${"F".repeat(255)}`, { budgetMs: 2_000 });
		expectHonestLine(`0x${"F".repeat(10_000)}`, { budgetMs: 5_000, allowNaN: false });
		expectHonestLine(RESOURCE_PROBES.longSum(500).replace(/\d+/g, "0xFFFFFFFFFFFFFFFFFFFF"), { budgetMs: 10_000 });
		for (const line of fill("0xFFFFFFFFFFFFFFFFFFFF + X", TEXT_EDGES.filter((t) => t.trim() !== ""))) expectHonestLine(line);
		expectHonestLine("0x２0000000000001");
	});

	test("realistic: a literal from a line above, a what-if, a check and a base conversion, both passes agree", () => {
		const { batch, incremental } = expectHonestDocument("id = 0xFFFFFFFFFFFFFFFFFFFF\nid + 1\nid in hex\ncheck id == \"0xFFFFFFFFFFFFFFFFFFFF\" as number\nline 2 with id = 0x20000000000001");
		expect(batch.slice(1)).toEqual(["= 1,208,925,819,614,629,174,706,176", "= 0xFFFFFFFFFFFFFFFFFFFF", "= ✓", "= 9,007,199,254,740,994"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge added to a long literal, and the literal in each base and sign", () => {
		for (const line of fill("0xFFFFFFFFFFFFFFFFFFFF + X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: line.includes("0/0") });
		expect(outcome("-0b" + "1".repeat(64))).toBe("-18,446,744,073,709,551,615");
		expect(outcome("0o" + "7".repeat(22))).toBe(BigInt(`0o${"7".repeat(22)}`).toLocaleString("en-US"));
		expect(outcome("0x0000000000000000000001")).toBe("1");
	});
});
