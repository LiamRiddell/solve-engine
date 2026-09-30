import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ipEqual } from "@solve-js/vm/VMConversion";
import { Value, ValueType, numberValue, stringValue, colourValue, type IpCidrData } from "@solve-js/vm/Value";

/**
 * Found bug: `192.168.1.0/24 == 192.168.1.0/25` was true. Two IPv4 values fell
 * through the equality opcodes to their `toNumber()`, which is the 32-bit
 * address alone, so the prefix vanished; two IPv6 values compared address,
 * prefix and zone. Both families now compare the same way (`ipEqual`): two IP
 * values are equal when their family, address, prefix and zone all are, and an
 * IP value never equals anything else, so `192.168.1.1 == 3232235777` is false
 * as `fe80::1 == 1` already was. Ordering is unchanged: an IPv4 address still
 * orders by its 32-bit number.
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

describe("the line that exposed it", () => {
	test("192.168.1.0/24 == 192.168.1.0/25 is false, as its IPv6 counterpart is", () => {
		expect(shown("192.168.1.0/24 == 192.168.1.0/25")).toBe("false");
		expect(shown("2001:db8::/32 == 2001:db8::/48")).toBe("false");
	});
});

describe("the two families agree", () => {
	test.each([
		["192.168.1.0/24 != 192.168.1.0/25", "true"],
		["192.168.1.0/24 == 192.168.1.0/24", "true"],
		["192.168.1.1 == 192.168.1.1", "true"],
		["192.168.1.1 == 192.168.1.2", "false"],
		["192.168.1.1 == 192.168.1.1/32", "false"],
		["2001:db8::1 == 2001:db8::1/128", "false"],
		["192.168.1.1 == 3232235777", "false"],
		["192.168.1.1 != 3232235777", "true"],
		["fe80::1 == 1", "false"],
		["0.0.0.1 == ::1", "false"],
		["192.168.1.1 == ::ffff:192.168.1.1", "false"],
		["192.168.1.0/24 == #ff0000", "false"],
	])("%s is %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("ordering and arithmetic on an IPv4 address are unchanged", () => {
		expect(shown("192.168.1.1 < 192.168.1.2")).toBe("true");
		expect(shown("192.168.1.1 as number")).toBe("3,232,235,777");
		expect(shown("192.168.1.1 + 1")).toBe("3,232,235,778");
		expect(shown("192.168.1.5 in 192.168.1.0/24")).toBe("true");
	});
});

describe("ipEqual", () => {
	const block24 = ip({ addr: 0xc0a80100, prefix: 24 });
	test("ordinary: family, address, prefix and zone must all match", () => {
		expect(ipEqual(block24, ip({ addr: 0xc0a80100, prefix: 24 }))).toBe(true);
		expect(ipEqual(block24, ip({ addr: 0xc0a80100, prefix: 25 }))).toBe(false);
		expect(ipEqual(block24, ip({ addr: 0xc0a80101, prefix: 24 }))).toBe(false);
		expect(ipEqual(ip({ addr6: 1n, zone: "eth0" }), ip({ addr6: 1n, zone: "eth1" }))).toBe(false);
		expect(ipEqual(ip({ addr6: 1n, zone: "eth0" }), ip({ addr6: 1n, zone: "eth0" }))).toBe(true);
	});

	test("boundary: a bare prefix, address 0, prefix 0, and the two families at the same bits", () => {
		expect(ipEqual(ip({ prefix: 24 }), ip({ prefix: 24 }))).toBe(true);
		expect(ipEqual(ip({ prefix: 24 }), ip({ prefix: 25 }))).toBe(false);
		expect(ipEqual(ip({ addr: 0, prefix: 0 }), ip({ addr: 0, prefix: 0 }))).toBe(true);
		expect(ipEqual(ip({ addr: 1 }), ip({ addr6: 1n }))).toBe(false);
		expect(ipEqual(ip({ addr: 1 }), ip({ addr: 1, prefix: 32 }))).toBe(false);
	});

	test("hostile: a non-IP on either side is false, two non-IPs are not its business", () => {
		expect(ipEqual(block24, numberValue(0xc0a80100))).toBe(false);
		expect(ipEqual(stringValue("192.168.1.0/24"), block24)).toBe(false);
		expect(ipEqual(block24, colourValue({ r: 0, g: 0, b: 0, a: 1, format: "hex" }))).toBe(false);
		expect(ipEqual(numberValue(1), numberValue(1))).toBeNull();
		expect(ipEqual(ip({ addr: 1, zone: "constructor" }), ip({ addr: 1 }))).toBe(false);
	});
});

describe("adversarial", () => {
	test("security: prototype words holding a block, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch, incremental } = expectHonestDocument(`${word} = 10.0.0.0/8\n${word} == 10.0.0.0/16`);
				expect(batch[1]).toBe("= false");
				expect(incremental).toEqual(batch);
			}
		});
	});

	test("security: look-alike and markup-shaped text on the other side", () => {
		for (const line of fill("10.0.0.0/8 == X", TEXT_EDGES)) expectHonestLine(line);
		// A fullwidth digit in the address is not an address, and says so honestly.
		expectHonestLine("１0.0.0.0/8 == 10.0.0.0/8");
	});

	test("security: many comparisons in one document stay within budget", () => {
		const text = Array.from({ length: 1_000 }, (_, i) => `10.0.${i % 256}.0/24 == 10.0.${i % 256}.0/${16 + (i % 16)}`).join("\n");
		expectHonestDocument(text);
	});

	test("realistic: blocks from the lines above, compared and used, both passes agreeing", () => {
		const text = "office = 192.168.1.0/24\nlab = 192.168.1.0/25\noffice == lab\noffice != lab\nhosts in office";
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch.slice(2)).toEqual(["= false", "= true", "= 254"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: the numeric edges against an address are never equal to it", () => {
		for (const line of fill("0.0.0.0 == X", NUMERIC_EDGES)) {
			const outcome = expectHonestLine(line, { allowNaN: true });
			if (outcome.kind === "value") expect(outcome.text).toBe("= false");
		}
		expect(shown("0.0.0.0/0 == 0.0.0.0/0")).toBe("true");
		expect(shown("255.255.255.255/32 == 255.255.255.255/32")).toBe("true");
	});
});
