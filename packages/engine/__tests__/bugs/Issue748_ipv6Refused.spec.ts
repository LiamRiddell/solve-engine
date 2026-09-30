import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { readIpv6Shape, MAX_IPV6_TEXT } from "@solve-js/packages/ip/Ipv6Shape";
import { ipv6NormalizerRule } from "@solve-js/packages/ip/normalizer/Ipv6NormalizerRule";
import { ipv6Address } from "@solve-js/packages/ip/IpPluginFunctions";
import { stringValue } from "@solve-js/vm/Value";
import type { Token } from "@solve-js/lexer/Token";

/**
 * Issue #748: an IPv6 address answered a number built from its last group.
 * `fe80::1` read as the label `fe80:` and the expression `1`, and `fe80::1:2`
 * as a clock time. The address shape is now recognised before either reading
 * and answers `IPV6_NOT_SUPPORTED`, a refusal that names IPv6. Step 2 of the
 * issue (128-bit values and the subnet forms) is not part of this change.
 */

const REFUSAL = (address: string): string =>
	`"${address}" is an IPv6 address, and only IPv4 addresses and subnets are covered so far.`;

/** How a line comes out: `CODE: message` for an error value, the answer otherwise, `THROWS ...` for a parse error. */
function show(line: string): string {
	try {
		const value = newTrackedEngine().evaluateExpression(line);
		if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
		return formatValue(value).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** The raw tokens of one line, as the normaliser receives them. */
function tokensOf(line: string): Token[] {
	return newTrackedEngine().getLexer().getHighlightTokenObjects(line, 0);
}

describe("an IPv6 address is refused by name", () => {
	test.each([
		["fe80::1", "fe80::1"],
		["2001:db8:85a3::8a2e:370:7334", "2001:db8:85a3::8a2e:370:7334"],
		["fe80::1 + 2", "fe80::1"],
		["fe80::1 in binary", "fe80::1"],
		["fe80::1:2", "fe80::1:2"],
		["::1", "::1"],
		["2001:db8::/32", "2001:db8::/32"],
		["abc::7", "abc::7"],
		["cafe::1", "cafe::1"],
	])("%s", (line, address) => {
		expect(show(line)).toBe(`IPV6_NOT_SUPPORTED: ${REFUSAL(address)}`);
	});

	test.each([
		// RFC 4291 and RFC 5952 textual forms: full, leading zeros, compressed at
		// either end, an embedded IPv4 quad, a zone index, upper case and a prefix.
		"2001:0db8:0000:0000:0000:ff00:0042:8329",
		"2001:db8:0:0:0:ff00:42:8329",
		"1:2:3:4:5:6:7:8",
		"1::",
		"::ffff:192.168.1.1",
		"64:ff9b::192.0.2.33",
		"fe80::1%eth0",
		"fe80::1%2",
		"FE80::1",
		"2001:DB8::1/64",
		"::1/128",
	])("the RFC form %s", (address) => {
		expect(show(address)).toBe(`IPV6_NOT_SUPPORTED: ${REFUSAL(address)}`);
	});

	test("the address is named whole, not only up to the lexer's first split", () => {
		expect(show("2001:db8:85a3::8a2e:370:7334 * 3")).toBe(`IPV6_NOT_SUPPORTED: ${REFUSAL("2001:db8:85a3::8a2e:370:7334")}`);
	});

	test("a subtraction after an address is not read as its zone", () => {
		expect(show("fe80::1-2")).toBe(`IPV6_NOT_SUPPORTED: ${REFUSAL("fe80::1")}`);
	});
});

describe("the near misses keep their meaning", () => {
	test("a clock time, a timecode and a time out of range are unchanged", () => {
		expect(show("12:30")).toMatch(/12:30:00 PM$/);
		expect(show("9:60")).toBe('THROWS "9:60" is not a valid time');
		expect(show("01:02:03:04")).toMatch(/^THROWS A video timecode must specify a frame rate/);
	});

	test("a label, a word label before a double colon and a colon definition are unchanged", () => {
		expect(show("Note: 5")).toBe("5");
		// The boundary the issue names: a word that is not hex keeps today's reading.
		expect(show("note::5")).toBe("5");
		const doc = newTrackedEngine().parseDocument(":x = 5\nx + 1\ninput value: :y = 2\ny", { inputType: "markdown" });
		expect(doc.lines.map((l) => (l.result ? formatValue(l.result).replace(/^=\s*/, "") : l.error))).toEqual(["5", "6", "2", "2"]);
	});

	test("an IPv4 address and subnet are unchanged", () => {
		expect(show("192.168.1.0/24")).toBe("192.168.1.0/24");
		expect(show("hosts in 192.168.1.0/24")).toBe("254");
	});

	test("a spaced colon form and too many groups are not an address", () => {
		expect(show("fe80 :: 1")).not.toMatch(/IPV6_NOT_SUPPORTED/);
		expect(show("1:2:3:4:5:6:7:8:9")).not.toMatch(/IPV6_NOT_SUPPORTED/);
		expect(show("::1::2")).not.toMatch(/IPV6_NOT_SUPPORTED/);
	});

	test("an address after a label is refused, not read as the label and a number", () => {
		expect(show("Server: fe80::1")).toBe(`IPV6_NOT_SUPPORTED: ${REFUSAL("fe80::1")}`);
	});
});

describe("readIpv6Shape", () => {
	test("reads the address, the zone and the prefix", () => {
		expect(readIpv6Shape("fe80::1")).toEqual({ address: "fe80::1" });
		expect(readIpv6Shape("fe80::1%eth0")).toEqual({ address: "fe80::1", zone: "eth0" });
		expect(readIpv6Shape("2001:db8::/32")).toEqual({ address: "2001:db8::", prefix: 32 });
		expect(readIpv6Shape("fe80::1%eth0/64")).toEqual({ address: "fe80::1", zone: "eth0", prefix: 64 });
		expect(readIpv6Shape("::ffff:192.168.1.1")).toEqual({ address: "::ffff:192.168.1.1" });
	});

	test("the boundaries of a group count and a prefix", () => {
		expect(readIpv6Shape("1:2:3:4:5:6:7:8")).not.toBeNull();
		expect(readIpv6Shape("1:2:3:4:5:6:7")).toBeNull();
		expect(readIpv6Shape("1:2:3:4:5:6::7")).not.toBeNull();
		expect(readIpv6Shape("1:2:3:4:5:6:7::8")).toBeNull();
		expect(readIpv6Shape("1:2:3:4:5:6:1.2.3.4")).not.toBeNull();
		expect(readIpv6Shape("::/128")).toBeNull();
		expect(readIpv6Shape("::1/128")).not.toBeNull();
		expect(readIpv6Shape("::1/129")).toBeNull();
		expect(readIpv6Shape("::1/")).toBeNull();
		expect(readIpv6Shape("ffff::1")).not.toBeNull();
		expect(readIpv6Shape("fffff::1")).toBeNull();
	});

	test("refuses what is not an address", () => {
		for (const text of ["", "::", ":::", "1:::2", "::1::2", "12:30", "1:2:3:4", "note::5", "g::1", ":1::2", "1::2:", "::256.1.1.1", "::1.2.3", "::1.2.3.4:5", "fe80::1%", "fe80::1%<b>", "fe80::1/x"]) {
			expect({ text, shape: readIpv6Shape(text) }).toEqual({ text, shape: null });
		}
	});

	test("hostile text is refused in one comparison, and look-alike characters are not hex", () => {
		expect(readIpv6Shape(`${"1:".repeat(10_000)}:1`)).toBeNull();
		expect(readIpv6Shape("a".repeat(MAX_IPV6_TEXT + 1))).toBeNull();
		expect(readIpv6Shape("fe80::１")).toBeNull();
		expect(readIpv6Shape("fe80::​1")).toBeNull();
		expect(readIpv6Shape("fe80::٥")).toBeNull();
		for (const word of PROTOTYPE_WORDS) expect(readIpv6Shape(`${word}::1`)).toBeNull();
	});
});

describe("ipv6NormalizerRule", () => {
	const rule = ipv6NormalizerRule();

	test("fuses the whole contiguous run into one token", () => {
		const tokens = tokensOf("2001:db8:85a3::8a2e:370:7334 + 1");
		const match = rule.match(tokens, 0);
		expect(match?.replacement.map((t) => [t.type, t.value])).toEqual([["IPV6_ADDRESS", "2001:db8:85a3::8a2e:370:7334"]]);
		expect(tokens[(match?.consumed ?? 0)].type).toBe("PLUS");
	});

	test("does not start inside a run that began earlier", () => {
		const tokens = tokensOf("note::5");
		expect(rule.match(tokens, 0)).toBeNull();
		expect(rule.match(tokens, 1)).toBeNull();
	});

	test("does not match a clock time, a label or a lone token", () => {
		expect(rule.match(tokensOf("12:30"), 0)).toBeNull();
		expect(rule.match(tokensOf("Note: 5"), 0)).toBeNull();
		expect(rule.match(tokensOf("fe80"), 0)).toBeNull();
		expect(rule.match([], 0)).toBeNull();
		expect(rule.match(tokensOf("fe80::1"), 99)).toBeNull();
	});

	test("a long run of colons is refused after a bounded walk", () => {
		const tokens = tokensOf(`1${":1".repeat(5_000)}`);
		const started = performance.now();
		expect(rule.match(tokens, 0)).toBeNull();
		expect(performance.now() - started).toBeLessThan(200);
	});
});

describe("ipv6Address", () => {
	test("answers the coded refusal naming the address", () => {
		const value = ipv6Address([stringValue("fe80::1")]);
		expect(value.isError()).toBe(true);
		expect(value.errorCode).toBe("IPV6_NOT_SUPPORTED");
		expect(value.errorMessage).toBe(REFUSAL("fe80::1"));
	});

	test("a missing argument and markup-shaped text are read as text", () => {
		expect(ipv6Address([]).errorCode).toBe("IPV6_NOT_SUPPORTED");
		expect(ipv6Address([stringValue("<script>")]).errorMessage).toContain("<script>");
	});
});

describe("adversarial", () => {
	test("text edges beside an address stay honest", () => {
		for (const line of fill("fe80::1 X", TEXT_EDGES)) expectHonestLine(line);
		for (const line of fill("X fe80::1", TEXT_EDGES)) expectHonestLine(line);
	});

	test("a prototype word before a double colon is an ordinary word", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word}::1`);
				expect(show(`${word}::1`)).not.toMatch(/IPV6_NOT_SUPPORTED/);
			}
		});
	});

	test("look-alike characters inside an address do not make it one", () => {
		expect(show("fe80::​1")).not.toMatch(/IPV6_NOT_SUPPORTED/);
		expect(show("fe80::１")).not.toMatch(/IPV6_NOT_SUPPORTED/);
		expectHonestLine("fe80::‮1");
	});

	test("a long run of colons is answered or refused in time", () => {
		expectHonestLine(`1${":1".repeat(2_000)}`, { budgetMs: 2_000 });
		expectHonestLine(":".repeat(5_000), { budgetMs: 2_000 });
		expectHonestLine(`${"fe80::1 + ".repeat(500)}1`, { budgetMs: 4_000 });
	});

	test("an address in a document: a line reference, a total and both passes", () => {
		const { batch } = expectHonestDocument("fe80::1\n10\nline 1 + 1\ntotal above");
		expect(batch[0]).toBe(`ERROR ${REFUSAL("fe80::1")}`);
		expect(batch[1]).toBe("= 10");
		expectHonestDocument("addr = fe80::1\naddr + 1\n2001:db8::/32\r\n::1\n");
		expectHonestDocument(RESOURCE_PROBES.manyLines(300, "fe80::1"));
	});
});
