import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { identityCheck } from "@solve-js/packages/conditionals/CheckFunctions";
import { hasExactSide } from "@solve-js/vm/Comparisons";
import { Value, ValueType, colourValue, hexValue, numberValue, numberValueRational, stringValue, type IpCidrData } from "@solve-js/vm/Value";
import { rational } from "@solve-js/symbolic";

/**
 * Found bug: `check #ff0000 == rgb(255, 0, 0)` and `check 192.168.1.0/24 !=
 * 192.168.1.0/25` were refused with "cannot be compared", while `==` and `!=`
 * answered both. A check read only numbers, quantities, text and booleans, and
 * a colour or an IP value is none of them. `identityCheck` now decides a check
 * between two colours or two IP values the way the operators do: equality on
 * channels, or on family, address, prefix and zone; order for addresses of one
 * family; and a refusal by name for a colour's order, an order across
 * families, and a margin. A number written in a base is checked on its digits
 * as well, since `check (2^100 + 1) in hex > 2^100` was refused the same way.
 */

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `${String(v.errorCode)}: ${String(v.errorMessage)}` : formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

const ip = (data: IpCidrData): Value => new Value(ValueType.IpCidr, data);
const red = colourValue({ r: 255, g: 0, b: 0, a: 1, format: "hex" });
const green = colourValue({ r: 0, g: 255, b: 0, a: 1, format: "hex" });

describe("the lines that exposed it", () => {
	test("two colours and two blocks are checked as == and != answer them", () => {
		expect(shown("check #ff0000 == rgb(255, 0, 0)")).toBe("✓");
		expect(shown("check 192.168.1.0/24 != 192.168.1.0/25")).toBe("✓");
	});
});

describe("check agrees with the operators", () => {
	test.each([
		["#ff0000 == #ff0000", "✓"],
		["#ff0000 != #00ff00", "✓"],
		["#ff0000 == #00ff00", "CHECK_FAILED: check failed: #ff0000 is not equal to #00ff00"],
		["#ff0000 != #ff0000", "CHECK_FAILED: check failed: #ff0000 is equal to #ff0000"],
		["192.168.1.0/24 == 192.168.1.0/24", "✓"],
		["192.168.1.0/24 == 192.168.1.0/25", "CHECK_FAILED: check failed: 192.168.1.0/24 is not equal to 192.168.1.0/25"],
		["192.168.1.1 < 192.168.1.2", "✓"],
		["192.168.1.2 < 192.168.1.1", "CHECK_FAILED: check failed: 192.168.1.2 is not less than 192.168.1.1"],
		["192.168.1.1 >= 192.168.1.1", "✓"],
		["fe80::1 == fe80::1", "✓"],
		["fe80::1 < fe80::2", "✓"],
		["fe80::2 <= fe80::1", "CHECK_FAILED: check failed: fe80::2 is more than fe80::1"],
		["fe80::1%eth0 == fe80::1", "CHECK_FAILED: check failed: fe80::1%eth0 is not equal to fe80::1"],
		["192.168.1.1 == fe80::1", "CHECK_FAILED: check failed: 192.168.1.1 is not equal to fe80::1"],
	])("check %s is %s", (comparison, answer) => {
		expect(shown(`check ${comparison}`)).toBe(answer);
		// The operator answers the same question the same way.
		const operator = shown(comparison);
		expect(operator).toBe(answer === "✓" ? "true" : "false");
	});

	test("ordering where there is none is still refused, by name", () => {
		expect(shown("check #ff0000 < #00ff00")).toBe("CHECK_INCOMPARABLE: check: a colour has no order, so two colours can only be compared with == or !=, not <");
		expect(shown("check 192.168.1.1 < fe80::1")).toBe("CHECK_INCOMPARABLE: check: an IPv4 and an IPv6 address have no order between them, so they can only be compared with == or !=, not <");
		expect(shown("check #ff0000 ≈ #ff0000")).toMatch(/^CHECK_INCOMPARABLE: .*not with ≈$/);
		expect(shown("check 192.168.1.1 == 192.168.1.1 within 1")).toMatch(/^CHECK_INCOMPARABLE: .*not with a tolerance$/);
	});

	test("a colour or an address against a number stays incomparable", () => {
		expect(shown("check #ff0000 == 5")).toBe("CHECK_INCOMPARABLE: check: #ff0000 and 5 cannot be compared");
		expect(shown("check 192.168.1.1 == 3232235777")).toMatch(/^CHECK_INCOMPARABLE: /);
	});

	test("a number written in a base is checked on its digits", () => {
		expect(shown("check ((2^100+1) in hex) > 2^100")).toBe("✓");
		expect(shown("check ((2^100+1) in hex) == 2^100")).toMatch(/^CHECK_FAILED: /);
		expect(shown("check (255 in hex) == 255")).toBe("✓");
	});
});

describe("identityCheck", () => {
	test("ordinary: equality and order decided as the operators decide them", () => {
		expect(identityCheck(red, red, "==")?.value).toBe("✓");
		expect(identityCheck(red, green, "!=")?.value).toBe("✓");
		expect(identityCheck(ip({ addr: 1 }), ip({ addr: 2 }), "<")?.value).toBe("✓");
		expect(identityCheck(ip({ addr6: 2n }), ip({ addr6: 1n }), ">")?.value).toBe("✓");
		expect(identityCheck(ip({ addr: 2 }), ip({ addr: 1 }), "<=")?.errorCode).toBe("CHECK_FAILED");
	});

	test("boundary: equal addresses at each ordering operator, prefix 0, and a bare prefix", () => {
		const a = ip({ addr: 5 });
		expect(identityCheck(a, a, "<")?.errorCode).toBe("CHECK_FAILED");
		expect(identityCheck(a, a, "<=")?.value).toBe("✓");
		expect(identityCheck(a, a, ">")?.errorCode).toBe("CHECK_FAILED");
		expect(identityCheck(a, a, ">=")?.value).toBe("✓");
		expect(identityCheck(ip({ addr: 0, prefix: 0 }), ip({ addr: 0, prefix: 0 }), "==")?.value).toBe("✓");
		expect(identityCheck(ip({ prefix: 24 }), ip({ prefix: 25 }), "!=")?.value).toBe("✓");
	});

	test("hostile: other pairs are not its business, and an unknown operator is named", () => {
		expect(identityCheck(numberValue(1), numberValue(1), "==")).toBeNull();
		expect(identityCheck(red, numberValue(0), "==")).toBeNull();
		expect(identityCheck(ip({ addr: 1 }), stringValue("1"), "==")).toBeNull();
		expect(identityCheck(red, ip({ addr: 1 }), "==")).toBeNull();
		expect(identityCheck(red, red, "constructor")?.errorCode).toBe("CHECK_EXPECTED_COMPARISON");
		expect(identityCheck(ip({ addr: 1 }), ip({ addr: 1 }), "__proto__")?.errorCode).toBe("CHECK_EXPECTED_COMPARISON");
		expect(identityCheck(ip({ addr: 1, zone: "toString" }), ip({ addr: 1 }), "==")?.errorCode).toBe("CHECK_FAILED");
		expect(identityCheck(red, red, "==", numberValue(1))?.errorCode).toBe("CHECK_INCOMPARABLE");
	});
});

describe("hasExactSide", () => {
	test("ordinary: a fraction, a decimal and a large number in a base each count", () => {
		expect(hasExactSide(numberValueRational(1 / 3, rational(1n, 3n)), numberValue(1))).toBe(true);
		expect(hasExactSide(numberValue(1), hexValue((1n << 100n) + 1n))).toBe(true);
	});

	test("boundary: a number in a base within 2^53 and two plain doubles do not", () => {
		expect(hasExactSide(hexValue(255), numberValue(1))).toBe(false);
		expect(hasExactSide(hexValue(BigInt(Number.MAX_SAFE_INTEGER)), numberValue(1))).toBe(false);
		expect(hasExactSide(hexValue(BigInt(Number.MAX_SAFE_INTEGER) + 1n), numberValue(1))).toBe(true);
		expect(hasExactSide(numberValue(0.5), numberValue(2))).toBe(false);
	});

	test("hostile: text, a colour and an infinity carry nothing exact", () => {
		expect(hasExactSide(stringValue("__proto__"), red)).toBe(false);
		expect(hasExactSide(numberValue(Infinity), numberValue(NaN))).toBe(false);
	});
});

describe("adversarial", () => {
	test("security: prototype words holding colours and blocks, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch, incremental } = expectHonestDocument(`${word} = 10.0.0.0/8\ncheck ${word} == 10.0.0.0/8\ncheck ${word} != #ff0000`);
				expect(batch[1]).toBe("= ✓");
				expect(incremental).toEqual(batch);
			}
		});
	});

	test("security: look-alike and markup-shaped text against a colour, and many checks in one document", () => {
		for (const line of fill("check #ff0000 == X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine("check #ff0000 == #ff0000​");
		const text = Array.from({ length: 1_000 }, (_, i) => `check 10.0.${i % 256}.0/24 != 10.0.${i % 256}.0/${16 + (i % 8)}`).join("\n");
		const { batch } = expectHonestDocument(text);
		expect(batch.every((line) => line === "= ✓")).toBe(true);
		expectHonestLine(`check (${RESOURCE_PROBES.longSum(200)}) in hex == 1`);
	});

	test("realistic: values from the lines above, a failed check beneath a total, both passes agreeing", () => {
		const text = "brand = #3366cc\nsite = rgb(51, 102, 204)\ncheck brand == site\noffice = 192.168.1.0/24\nlab = 192.168.1.0/25\ncheck office != lab\ncheck network of lab == 192.168.1.0";
		const { batch, incremental } = expectHonestDocument(text);
		expect([batch[2], batch[5], batch[6]]).toEqual(["= ✓", "= ✓", "= ✓"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: the numeric edges against an address and in a colour's channel stay honest", () => {
		for (const line of fill("check 0.0.0.0 == X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("check rgb(X, 0, 0) == #ff0000", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(shown("check 0.0.0.0/0 == 0.0.0.0/0")).toBe("✓");
		expect(shown("check 255.255.255.255 > 0.0.0.0")).toBe("✓");
		expect(shown("check ::1 < ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe("✓");
	});
});
