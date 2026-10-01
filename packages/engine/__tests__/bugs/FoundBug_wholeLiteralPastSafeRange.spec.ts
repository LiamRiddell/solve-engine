import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { isPastSafeWholeLiteral } from "@solve-js/parser/WholeLiteral";
import { exactWholeLiteral } from "@solve-js/vm/ExactIntegers";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";

/**
 * Found bug: the typed literal `9007199254740993` answered
 * `9,007,199,254,740,992`, a confident wrong number. A double holds every whole
 * number up to 2^53 - 1 and only some past it, and the parser read every
 * integer literal as a double, so the digits the reader typed were rounded
 * before the engine saw them, while `2^53 + 1` (a result) already kept its
 * exact integer.
 *
 * A whole number written in plain digits past the safe range is now compiled to
 * PUSH_DECIMAL with its digits (`isPastSafeWholeLiteral`), and the VM pushes it
 * as a Number carrying its exact integer (`exactWholeLiteral`), the sidecar the
 * exact-integer arithmetic already reads.
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
		["9007199254740993", "9,007,199,254,740,993"],
		["9007199254740993 + 1", "9,007,199,254,740,994"],
		["9007199254740993 - 1", "9,007,199,254,740,992"],
		["9007199254740993 == 9007199254740992", "false"],
		["-9007199254740993", "-9,007,199,254,740,993"],
		["9007199254740993 * 2", "18,014,398,509,481,986"],
		["9007199254740993 / 3", "3,002,399,751,580,331"],
		["9,007,199,254,740,993", "9,007,199,254,740,993"],
		["12345678901234567890", "12,345,678,901,234,567,890"],
		["99999999999999999999 + 1", "100,000,000,000,000,000,000"],
		["$9007199254740993", "$9,007,199,254,740,993.00"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("within the safe range nothing changes, and scientific notation stays a double", () => {
		expect(shown("9007199254740991")).toBe("9,007,199,254,740,991");
		expect(shown("9007199254740991 + 2")).toBe("9,007,199,254,740,993");
		expect(shown("1e16 + 1 - 1e16")).toBe("0");
		expect(shown("10^16 + 1 - 10^16")).toBe("1");
	});

	test("the boundary: past 2^53 a fraction or a unit reads the nearest double, as 2^53 + 1 already does", () => {
		expect(shown("9007199254740993 * 0.5")).toBe(shown("(2^53 + 1) * 0.5"));
		expect(shown("9007199254740993 m")).toBe(shown("(2^53 + 1) m"));
	});

	test("the chained-dot grouping under a locale that groups with dots", () => {
		const de = new ExpressionEngine({ locale: "de", packages: BUILTIN_PACKAGES });
		try {
			expect(shown("9.007.199.254.740.993 + 0", de)).toBe(shown("9007199254740993", de));
		} finally {
			de.clear();
		}
	});
});

describe("isPastSafeWholeLiteral", () => {
	test("plain digits past 2^53 - 1, and not within it", () => {
		expect(isPastSafeWholeLiteral("9007199254740993")).toBe(true);
		expect(isPastSafeWholeLiteral("9007199254740992")).toBe(true);
		expect(isPastSafeWholeLiteral("12345678901234567890")).toBe(true);
		expect(isPastSafeWholeLiteral("9007199254740991")).toBe(false);
		expect(isPastSafeWholeLiteral("0")).toBe(false);
		expect(isPastSafeWholeLiteral("0000000000000000000000001")).toBe(false);
	});

	test("anything that is not plain digits, and a literal too large for any double", () => {
		for (const text of ["", "1e16", "-9007199254740993", "9007199254740993.0", "0x20000000000001", "9 007 199 254 740 993", "９００７１９９２５４７４０９９３", "9007199254740993n"]) {
			expect({ text, past: isPastSafeWholeLiteral(text) }).toEqual({ text, past: false });
		}
		expect(isPastSafeWholeLiteral("9".repeat(400))).toBe(false);
	});

	test("prototype words are not digits", () => {
		for (const word of PROTOTYPE_WORDS) expect(isPastSafeWholeLiteral(word)).toBe(false);
	});
});

describe("exactWholeLiteral", () => {
	test("a Number carrying its exact integer", () => {
		const v = exactWholeLiteral("9007199254740993")!;
		expect(formatValue(v)).toBe("= 9,007,199,254,740,993");
		expect(v.rational?.n).toBe(9007199254740993n);
		expect(exactWholeLiteral("0")?.toNumber()).toBe(0);
	});

	test("text that is not plain digits is null rather than a throw from BigInt", () => {
		for (const text of ["", "1.5", "-1", "1e3", "abc", "0x10", " 12", ...PROTOTYPE_WORDS]) {
			expect({ text, value: exactWholeLiteral(text) }).toEqual({ text, value: null });
		}
	});
});

describe("adversarial", () => {
	test("security: a literal past any double is Infinity as before and builds no bigint, and one past the line limit is refused by name", () => {
		const out = expectHonestLine("9".repeat(400), { budgetMs: 2_000 });
		expect(out.kind === "value" ? out.text : out.kind).toBe("= ∞");
		const long = expectHonestLine("9".repeat(5_000), { budgetMs: 2_000 });
		expect(long.kind === "thrown" ? long.message : long.kind).toContain("exceeds max length");
		expectHonestLine(RESOURCE_PROBES.longSum(2_000).replace(/\d+/g, "9007199254740993"), { budgetMs: 5_000 });
	});

	test("security: digits from other scripts and zero-width characters are not read as the literal", () => {
		for (const line of ["９００７１９９２５４７４０９９３", "9007199254740993​", "‮9007199254740993"]) expectHonestLine(line);
		for (const line of fill("9007199254740993 X", TEXT_EDGES)) expectHonestLine(line);
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectHonestLine(`9007199254740993 + ${word}`);
		});
	});

	test("realistic: the literal from the line above, a check of it and a total, through both passes", () => {
		const { batch, incremental } = expectHonestDocument("a = 9007199254740993\na + 1\ncheck a > 9007199254740992\ntotal above");
		expect(batch.slice(0, 3)).toEqual(["= 9,007,199,254,740,993", "= 9,007,199,254,740,994", "= ✓"]);
		expect(incremental).toEqual(batch);
		expect(formatValue(newTrackedEngine().evaluateLine(1, "9007199254740993 + 1"))).toBe("= 9,007,199,254,740,994");
	});

	test("edge: every numeric edge beside the literal", () => {
		for (const line of fill("9007199254740993 + X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("X * 9007199254740993", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});
});
