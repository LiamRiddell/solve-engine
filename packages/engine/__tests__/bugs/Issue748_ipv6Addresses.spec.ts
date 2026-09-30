import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { serializeValue } from "@solve-js/worker/serialize";
import {
	formatIpv6,
	ipv6AddressCount,
	ipv6InBlock,
	ipv6LastAddress,
	ipv6Netmask,
	ipv6Network,
	parseIpv6,
} from "@solve-js/packages/ip/Ipv6Math";
import { readAddress } from "@solve-js/packages/ip/normalizer/Ipv6NormalizerRule";
import {
	broadcastOf,
	hostsIn,
	ipAsInt,
	ipInCidr,
	ipLiteral,
	ipv6Literal,
	isIpv6Payload,
	lastAddressOf,
	netmaskOf,
	networkOf,
} from "@solve-js/packages/ip/IpPluginFunctions";
import {
	ipv6ArithmeticRefused,
	ipv6Comparison,
	ipv6Equal,
	ipv6Order,
	ipv6Refused,
	ipv6WholeNumber,
	isIpv6Value,
} from "@solve-js/vm/VMConversion";
import { ipv6ArgumentRefused } from "@solve-js/vm/VMBuiltins";
import { baseConversionOperand } from "@solve-js/vm/ExactIntegers";
import { Value, ValueType, bigIntValue, ipCidrValue, numberValue, stringValue, type IpCidrData } from "@solve-js/vm/Value";

/**
 * Issue #748, step 2: full IPv6 support. An IPv6 address is a 128-bit value
 * (held as a bigint), shown in the canonical text of RFC 5952, with a prefix
 * from /0 to /128, and answers the networking page's questions: `hosts in`,
 * `netmask of`, `network of`, `last address of` and membership `in`. An
 * IPv4-mapped address keeps its dotted quad and a zone (`fe80::1%eth0`) is
 * kept with the address. Arithmetic straight on an address is refused by name
 * (`IPV6_ARITHMETIC`), since no double holds 128 bits; `as int` gives the exact
 * whole number. Step 1's `IPV6_NOT_SUPPORTED` is retired, since nothing
 * refuses an address for being IPv6 any more.
 */

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

/** The error code a line answers, or `-` when it answers a value. */
function codeOf(line: string): string {
	const value = newTrackedEngine().evaluateExpression(line);
	return value.isError() ? String(value.errorCode) : "-";
}

/** An IPv6 value, for the unit tests of the helpers. */
function v6(addr6: bigint, prefix?: number, zone?: string): Value {
	return ipCidrValue({ addr6, ...(prefix !== undefined ? { prefix } : {}), ...(zone !== undefined ? { zone } : {}) });
}

/** The payload of an IP value. */
function payload(value: Value): IpCidrData {
	expect(value.type).toBe(ValueType.IpCidr);
	return value.value as IpCidrData;
}

const ARITHMETIC = (done: string): string =>
	`IPV6_ARITHMETIC: An IPv6 address cannot be ${done}: its 128 bits are more than a number holds exactly. For the address as one whole number, write "as int".`;

describe("the issue's lines answer the address", () => {
	test.each([
		["fe80::1", "fe80::1"],
		["2001:db8:85a3::8a2e:370:7334", "2001:db8:85a3::8a2e:370:7334"],
		["fe80::1 + 2", ARITHMETIC("added")],
		["fe80::1 in binary", `0b1111111010${"0".repeat(117)}1`],
		["fe80::1:2", "fe80::1:2"],
		["::1", "::1"],
		["2001:db8::/32", "2001:db8::/32"],
		["abc::7", "abc::7"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});
});

describe("an address is shown in the canonical text of RFC 5952", () => {
	test.each([
		// Lower case, leading zeros dropped, the longest zero run compressed.
		["2001:0DB8:0000:0000:0000:ff00:0042:8329", "2001:db8::ff00:42:8329"],
		["FE80::ABCD", "fe80::abcd"],
		["fe80:0:0:0:0:0:0:1", "fe80::1"],
		// The first run of two when two are equally long (section 4.2.3).
		["2001:db8:0:0:1:0:0:1", "2001:db8::1:0:0:1"],
		// The longer run when they differ.
		["2001:0:0:1:0:0:0:1", "2001:0:0:1::1"],
		// A single zero group is never `::` (section 4.2.2).
		["2001:db8:0:1:1:1:1:1", "2001:db8:0:1:1:1:1:1"],
		// A run at either end.
		["0:0:0:0:0:0:0:1", "::1"],
		["1:0:0:0:0:0:0:0", "1::"],
		// An IPv4-mapped address keeps its dotted quad (section 5), however written.
		["::ffff:192.168.1.1", "::ffff:192.168.1.1"],
		["::ffff:c0a8:101", "::ffff:192.168.1.1"],
		// Other embedded forms are shown in hexadecimal.
		["64:ff9b::192.0.2.33", "64:ff9b::c000:221"],
		["::192.168.1.1", "::c0a8:101"],
		// A zone and a prefix are kept.
		["fe80::1%eth0", "fe80::1%eth0"],
		["fe80::1%eth0/64", "fe80::1%eth0/64"],
		["2001:DB8::1/64", "2001:db8::1/64"],
		["::/0", "::/0"],
	])("%s is %s", (line, canonical) => {
		expect(show(line)).toBe(canonical);
	});

	test("two spellings of one address are equal, and a different prefix or zone is not", () => {
		expect(show("fe80::1 == fe80:0:0:0:0:0:0:1")).toBe("true");
		expect(show("2001:db8::1 == 2001:0DB8::0001")).toBe("true");
		expect(show("fe80::1 == fe80::2")).toBe("false");
		expect(show("fe80::1 != fe80::2")).toBe("true");
		expect(show("fe80::1 == fe80::1/64")).toBe("false");
		expect(show("fe80::1 == fe80::1%eth0")).toBe("false");
		expect(show("fe80::1 == 5")).toBe("false");
		expect(show("::ffff:192.168.1.1 == 192.168.1.1")).toBe("false");
	});

	test("two addresses order by their bits", () => {
		expect(show("fe80::1 < fe80::2")).toBe("true");
		expect(show("fe80::2 <= fe80::2")).toBe("true");
		expect(show("2001:db8:: > fe80::")).toBe("false");
		expect(show("ffff:: >= ::1")).toBe("true");
		expect(show("fe80::1 > 5")).toBe(ARITHMETIC("compared with a number"));
	});
});

describe("the subnet forms", () => {
	test.each([
		["hosts in 2001:db8::/64", "18446744073709551616"],
		["hosts in 2001:db8::/32", "79228162514264337593543950336"],
		["hosts in ::/0", "340282366920938463463374607431768211456"],
		["hosts in 2001:db8::/120", "256"],
		["hosts in 2001:db8::/127", "2"],
		["hosts in ::1/128", "1"],
		["hosts in /64", "18446744073709551616"],
		["netmask of /64", "ffff:ffff:ffff:ffff::"],
		["netmask of /33", "ffff:ffff:8000::"],
		["netmask of /128", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
		["netmask of 2001:db8::/32", "ffff:ffff::"],
		["netmask of ::/0", "::"],
		["network of 2001:db8:85a3::8a2e:370:7334/64", "2001:db8:85a3::"],
		["network of fe80::1%eth0/64", "fe80::"],
		["last address of 2001:db8::/32", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"],
		["last address of ::/0", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
		["last address of 2001:db8::5/128", "2001:db8::5"],
		["2001:db8::1 in 2001:db8::/32", "true"],
		["2001:db9::1 in 2001:db8::/32", "false"],
		["fe80::1%eth0 in fe80::/10", "true"],
		["::ffff:192.168.1.1 in ::ffff:0:0/96", "true"],
		["::1 in ::/0", "true"],
		["network of 2001:db8::/32 == 2001:db8::", "true"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("the IPv4 forms are unchanged, and the new ones answer for IPv4 too", () => {
		expect(show("hosts in 192.168.1.0/24")).toBe("254");
		expect(show("netmask of /24")).toBe("255.255.255.0");
		expect(show("broadcast of 192.168.1.0/24")).toBe("192.168.1.255");
		expect(show("192.168.1.10 in 10.0.0.0/8")).toBe("false");
		expect(show("network of 192.168.1.10/24")).toBe("192.168.1.0");
		expect(show("last address of 192.168.1.10/24")).toBe("192.168.1.255");
		expect(show("10.0.0.0/8 as int")).toBe("167,772,160");
	});

	test("a bare prefix longer than 32 is IPv6, where it used to answer a wrong IPv4 mask", () => {
		// Before: `netmask of /33` answered 128.0.0.0 and `/64` 255.255.255.255.
		expect(show("netmask of /33")).toBe("ffff:ffff:8000::");
		expect(show("netmask of /32")).toBe("255.255.255.255");
	});

	test("the refusals name what is wrong", () => {
		expect(show("broadcast of 2001:db8::/32")).toBe(
			`IPV6_NO_BROADCAST: An IPv6 block has no broadcast address: IPv6 reaches a group of machines another way (multicast). For the block's last address, write "last address of".`,
		);
		expect(codeOf("192.168.1.1 in 2001:db8::/32")).toBe("IP_FAMILY_MISMATCH");
		expect(codeOf("2001:db8::1 in 10.0.0.0/8")).toBe("IP_FAMILY_MISMATCH");
		expect(codeOf("2001:db8::1 in 2001:db8::1")).toBe("IP_EXPECTED_BLOCK");
		expect(codeOf("network of 2001:db8::1")).toBe("IP_NEEDS_ADDRESS_AND_PREFIX");
		expect(codeOf("last address of fe80::1")).toBe("IP_NEEDS_ADDRESS_AND_PREFIX");
		expect(codeOf("hosts in fe80::1")).toBe("IP_NO_PREFIX");
		expect(codeOf("network of 5")).toBe("IP_EXPECTED");
		for (const line of ["netmask of /129", "hosts in /200", "netmask of /2.5", "2001:db8::/129", "2001:db8::/999", "fe80::1%eth0/200"]) {
			expect({ line, code: codeOf(line) }).toEqual({ line, code: "IP_PREFIX_OUT_OF_RANGE" });
		}
		expect(show("2001:db8::/129")).toBe(
			`IP_PREFIX_OUT_OF_RANGE: "/129" is not a prefix length: an IPv4 prefix is a whole number from 0 to 32, and an IPv6 prefix from 0 to 128.`,
		);
	});
});

describe("an IPv6 address as a number", () => {
	test("as int, as number and the bases give its exact bits", () => {
		expect(show("fe80::1 as int")).toBe("338288524927261089654018896841347694593");
		expect(show("fe80::1 as number")).toBe("338288524927261089654018896841347694593");
		expect(show("::1 as int")).toBe("1");
		expect(show("fe80::1 in hex")).toBe("0xFE800000000000000000000000000001");
		expect(show("hex(fe80::1)")).toBe("0xFE800000000000000000000000000001");
		expect(show("fe80::1 as octal")).toBe("0o3764000000000000000000000000000000000000001");
		expect(show("fe80::1 as int + 2")).toBe("338288524927261089654018896841347694595");
		expect(show("hosts in 2001:db8::/64 - 1")).toBe("18446744073709551615");
	});

	test.each([
		["fe80::1 + 2", "added"],
		["2 - fe80::1", "subtracted"],
		["fe80::1 * 2", "multiplied"],
		["fe80::1 / 2", "divided"],
		["fe80::1 ^ 2", "used in this arithmetic"],
		["fe80::1 mod 3", "used in this arithmetic"],
		["-fe80::1", "negated"],
		["fe80::1 << 2", "used in this arithmetic"],
		["fe80::1 xor 1", "used in this arithmetic"],
		["~fe80::1", "used in this arithmetic"],
		["round(fe80::1)", "given to round"],
		["sqrt(fe80::1)", "given to sqrt"],
		["fe80::1 to 2 dp", "used in this calculation"],
		["fe80::1 as percent", "written as a percentage"],
		["fe80::1 as fraction", "written as a fraction"],
		["fe80::1 as scientific", "written in scientific notation"],
	])("%s is refused by name", (line, done) => {
		expect(show(line)).toBe(ARITHMETIC(done));
	});

	test("unary plus leaves the address alone, and the aggregates word their own refusal", () => {
		expect(show("+fe80::1")).toBe("fe80::1");
		expect(codeOf("sum(fe80::1, 1)")).toBe("AGGREGATE_NON_NUMERIC");
		expect(codeOf("max(fe80::1, 3)")).toBe("AGGREGATE_NON_NUMERIC");
		expect(codeOf("[fe80::1, 1]")).toBe("MATRIX_CELL_NON_NUMERIC");
		expect(codeOf("fe80::1 km")).toBe("CONVERT_NON_NUMERIC");
		expect(codeOf("fe80::1 as multiplier")).toBe("MULTIPLIER_TAKES_NUMBER");
	});
});

describe("hex words and the near misses", () => {
	test.each(["cafe::1", "dead::beef", "add::5", "dec::1", "e::1", "b::1", "d::1", "a::1", "face::b00c", "c0de::1"])(
		"the hex word %s reads as an address",
		(line) => {
			expect(show(line)).toBe(line);
		},
	);

	test("the issue's near misses keep their meaning", () => {
		expect(show("note::5")).toBe("5");
		expect(show("Note: 5")).toBe("5");
		expect(show("12:30")).toMatch(/12:30:00 PM$/);
		expect(show("9:60")).toBe('THROWS "9:60" is not a valid time');
		const doc = newTrackedEngine().parseDocument(":x = 5\nx + 1", { inputType: "markdown" });
		expect(doc.lines.map((l) => (l.result ? formatValue(l.result).replace(/^=\s*/, "") : l.error))).toEqual(["5", "6"]);

		// The new phrases claim no single word.
		expect(expectHonestDocument("network = 5\nnetwork * 2\naddress = 3\naddress + 1").batch).toEqual(["= 5", "= 10", "= 3", "= 4"]);
		expect(show("network of friends")).toBe("THROWS Undefined variable: friends");
		expect(show("broadcast of friends")).toBe("THROWS Undefined variable: friends");
	});
});

describe("parseIpv6", () => {
	test("reads every textual form into its 128 bits", () => {
		expect(parseIpv6("::1")).toEqual({ addr: 1n });
		expect(parseIpv6("1::")).toEqual({ addr: 1n << 112n });
		expect(parseIpv6("fe80::1%eth0/64")).toEqual({ addr: (0xfe80n << 112n) | 1n, prefix: 64, zone: "eth0" });
		expect(parseIpv6("::ffff:192.168.1.1")).toEqual({ addr: 0xffffc0a80101n });
		expect(parseIpv6("1:2:3:4:5:6:7:8")?.addr).toBe(0x00010002000300040005000600070008n);
		expect(parseIpv6("ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255")?.addr).toBe((1n << 128n) - 1n);
		expect(parseIpv6("::/0")).toEqual({ addr: 0n, prefix: 0 });
	});

	test("refuses what is not an address, and hostile text", () => {
		for (const text of ["", "::", ":::", "1::2::3", "12:30", "note::5", "::1/129", "g::1", "fe80::1%", "fe80::1%<b>", `${"1:".repeat(10_000)}:1`]) {
			expect({ text, parsed: parseIpv6(text) }).toEqual({ text, parsed: null });
		}
		for (const word of PROTOTYPE_WORDS) expect(parseIpv6(`${word}::1`)).toBeNull();
	});
});

describe("formatIpv6", () => {
	test("the RFC 5952 rules, one at a time", () => {
		expect(formatIpv6(0n)).toBe("::");
		expect(formatIpv6(1n)).toBe("::1");
		expect(formatIpv6((1n << 128n) - 1n)).toBe("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff");
		expect(formatIpv6(0x20010db8000000000001000000000001n)).toBe("2001:db8::1:0:0:1");
		expect(formatIpv6(0x20010db8000000010001000100010001n)).toBe("2001:db8:0:1:1:1:1:1");
		expect(formatIpv6(0x00010000000000000000000000000000n)).toBe("1::");
		expect(formatIpv6(0xffffc0a80101n)).toBe("::ffff:192.168.1.1");
		expect(formatIpv6(0xffff00000000n)).toBe("::ffff:0.0.0.0");
		// One bit either side of the mapped block is not mapped.
		expect(formatIpv6(0x1ffffc0a80101n)).toBe("::1:ffff:c0a8:101");
		expect(formatIpv6(0xfffec0a80101n)).toBe("::fffe:c0a8:101");
	});

	test("bits past 128 are ignored, and a negative number reads as its low 128 bits", () => {
		expect(formatIpv6(1n << 128n)).toBe("::");
		expect(formatIpv6(-1n)).toBe("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff");
	});

	test("every canonical text reads back to the same address", () => {
		for (const addr of [0n, 1n, 0xfe800000000000000000000000000001n, 0x20010db8000000000001000000000001n, 0xffffc0a80101n, (1n << 128n) - 1n]) {
			expect(parseIpv6(formatIpv6(addr))?.addr ?? (addr === 0n ? 0n : null)).toBe(addr);
		}
	});
});

describe("the block helpers", () => {
	test("netmask, network, last address and count at the boundaries", () => {
		expect(ipv6Netmask(0)).toBe(0n);
		expect(ipv6Netmask(128)).toBe((1n << 128n) - 1n);
		expect(ipv6Netmask(64)).toBe(((1n << 64n) - 1n) << 64n);
		expect(ipv6Network(0x20010db8000000000000000000000005n, 64)).toBe(0x20010db8000000000000000000000000n);
		expect(ipv6Network(123n, 0)).toBe(0n);
		expect(ipv6LastAddress(0n, 0)).toBe((1n << 128n) - 1n);
		expect(ipv6LastAddress(5n, 128)).toBe(5n);
		expect(ipv6AddressCount(0)).toBe(1n << 128n);
		expect(ipv6AddressCount(128)).toBe(1n);
		expect(ipv6AddressCount(64)).toBe(1n << 64n);
	});

	test("membership at the boundaries", () => {
		expect(ipv6InBlock(5n, 0n, 0)).toBe(true);
		expect(ipv6InBlock(5n, 5n, 128)).toBe(true);
		expect(ipv6InBlock(5n, 4n, 128)).toBe(false);
		expect(ipv6InBlock(5n, 4n, 126)).toBe(true);
	});
});

describe("the plugin functions", () => {
	test("ipv6Literal rebuilds the value from the packed payload", () => {
		expect(payload(ipv6Literal([stringValue("fe800000000000000000000000000001|64|eth0")]))).toEqual({ addr6: 0xfe800000000000000000000000000001n, prefix: 64, zone: "eth0" });
		expect(payload(ipv6Literal([stringValue("1||")]))).toEqual({ addr6: 1n });
		expect(payload(ipv6Literal([stringValue("0|0|")]))).toEqual({ addr6: 0n, prefix: 0 });
	});

	test("ipv6Literal refuses a bad payload, a missing argument and a prefix past 128", () => {
		expect(ipv6Literal([]).errorCode).toBe("IP_EXPECTED");
		expect(ipv6Literal([stringValue("xyz||")]).errorCode).toBe("IP_EXPECTED");
		expect(ipv6Literal([stringValue(`${"f".repeat(33)}||`)]).errorCode).toBe("IP_EXPECTED");
		expect(ipv6Literal([stringValue("<script>||")]).errorCode).toBe("IP_EXPECTED");
		expect(ipv6Literal([stringValue("1|129|")]).errorCode).toBe("IP_PREFIX_OUT_OF_RANGE");
	});

	test("isIpv6Payload reads the family, a bare prefix past 32 as IPv6", () => {
		expect(isIpv6Payload({ addr6: 0n })).toBe(true);
		expect(isIpv6Payload({ prefix: 64 })).toBe(true);
		expect(isIpv6Payload({ prefix: 32 })).toBe(false);
		expect(isIpv6Payload({ addr: 1, prefix: 24 })).toBe(false);
		expect(isIpv6Payload({})).toBe(false);
	});

	test("the question forms, each over IPv6, IPv4 and something that is neither", () => {
		const block = v6(0x20010db8000000000000000000000005n, 64);
		expect(hostsIn([block]).value).toBe(1n << 64n);
		expect(hostsIn([v6(0n, 120)]).value).toBe(256);
		expect(payload(netmaskOf([block]))).toEqual({ addr6: ((1n << 64n) - 1n) << 64n });
		expect(payload(networkOf([block]))).toEqual({ addr6: 0x20010db8000000000000000000000000n });
		expect(payload(lastAddressOf([block]))).toEqual({ addr6: 0x20010db800000000ffffffffffffffffn });
		expect(broadcastOf([block]).errorCode).toBe("IPV6_NO_BROADCAST");
		expect(payload(networkOf([ipLiteral([stringValue("3232235786|24")])]))).toEqual({ addr: 3232235776 });
		expect(payload(lastAddressOf([ipLiteral([stringValue("3232235786|24")])]))).toEqual({ addr: 3232236031 });
		for (const fn of [hostsIn, netmaskOf, networkOf, lastAddressOf, broadcastOf]) {
			expect(fn([]).errorCode).toBe("IP_EXPECTED");
			expect(fn([numberValue(5)]).errorCode).toBe("IP_EXPECTED");
			expect(fn([stringValue("constructor")]).errorCode).toBe("IP_EXPECTED");
		}
		expect(hostsIn([ipLiteral([stringValue("|-1")])]).errorCode).toBe("IP_PREFIX_OUT_OF_RANGE");
		expect(netmaskOf([ipLiteral([stringValue("|NaN")])]).errorCode).toBe("IP_PREFIX_OUT_OF_RANGE");
	});

	test("ipInCidr compares within one family and ignores a zone", () => {
		expect(ipInCidr([v6(5n, undefined, "eth0"), v6(0n, 120)]).value).toBe(true);
		expect(ipInCidr([v6(1n << 8n), v6(0n, 120)]).value).toBe(false);
		expect(ipInCidr([v6(5n), ipLiteral([stringValue("0|0")])]).errorCode).toBe("IP_FAMILY_MISMATCH");
		expect(ipInCidr([ipLiteral([stringValue("5|")]), v6(0n, 0)]).errorCode).toBe("IP_FAMILY_MISMATCH");
		expect(ipInCidr([v6(5n), v6(5n)]).errorCode).toBe("IP_EXPECTED_BLOCK");
		expect(ipInCidr([ipLiteral([stringValue("|24")]), v6(0n, 0)]).errorCode).toBe("IP_EXPECTED_ADDRESS");
		expect(ipInCidr([v6(5n)]).errorCode).toBe("IP_EXPECTED");
	});

	test("ipAsInt gives a plain number while it is exact, a bigint past that", () => {
		expect(ipAsInt(v6(1n))).toEqual(numberValue(1));
		const big = ipAsInt(v6(1n << 100n));
		expect(big.type).toBe(ValueType.BigInt);
		expect(big.value).toBe(1n << 100n);
		expect(ipAsInt(v6(BigInt(Number.MAX_SAFE_INTEGER))).type).toBe(ValueType.Number);
		expect(ipAsInt(v6(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).type).toBe(ValueType.BigInt);
		expect(ipAsInt(numberValue(2.7)).value).toBe(2);
	});
});

describe("readAddress (the normaliser's reading of a run)", () => {
	test("an address, and a prefix past 128 kept so it can be refused", () => {
		expect(readAddress("fe80::1")).toEqual({ addr: 0xfe800000000000000000000000000001n, prefix: "" });
		expect(readAddress("fe80::1%eth0/64")).toEqual({ addr: 0xfe800000000000000000000000000001n, prefix: "64", zone: "eth0" });
		expect(readAddress("2001:db8::/129")).toEqual({ addr: 0x20010db8000000000000000000000000n, prefix: "129" });
		expect(readAddress("fe80::1%eth0/999")).toEqual({ addr: 0xfe800000000000000000000000000001n, prefix: "999", zone: "eth0" });
	});

	test("anything else is not an address", () => {
		for (const text of ["12:30", "note::5", "2001:db8::/1000", "2001:db8::/64/129", "::/129", "192.168.1.0/33", ""]) {
			expect({ text, read: readAddress(text) }).toEqual({ text, read: null });
		}
	});
});

describe("the VM helpers", () => {
	const a = v6(1n), b = v6(2n);

	test("isIpv6Value tells an IPv6 value from an IPv4 one and from anything else", () => {
		expect(isIpv6Value(a)).toBe(true);
		expect(isIpv6Value(ipLiteral([stringValue("1|")]))).toBe(false);
		expect(isIpv6Value(ipCidrValue({ prefix: 64 }))).toBe(false);
		expect(isIpv6Value(numberValue(1))).toBe(false);
		expect(isIpv6Value(bigIntValue(1n))).toBe(false);
	});

	test("ipv6Refused and ipv6ArithmeticRefused", () => {
		expect(ipv6Refused("rounded").errorCode).toBe("IPV6_ARITHMETIC");
		expect(ipv6Refused("rounded").errorMessage).toContain("cannot be rounded");
		expect(ipv6ArithmeticRefused(numberValue(1), numberValue(2), "add")).toBeNull();
		expect(ipv6ArithmeticRefused(a, numberValue(2), "add")?.errorMessage).toContain("added");
		expect(ipv6ArithmeticRefused(numberValue(2), a, "div")?.errorMessage).toContain("divided");
		expect(ipv6ArithmeticRefused(a, b)?.errorMessage).toContain("used in this arithmetic");
	});

	test("ipv6Equal, ipv6Order and ipv6Comparison", () => {
		expect(ipv6Equal(a, v6(1n))).toBe(true);
		expect(ipv6Equal(a, b)).toBe(false);
		expect(ipv6Equal(a, v6(1n, 128))).toBe(false);
		expect(ipv6Equal(a, v6(1n, undefined, "eth0"))).toBe(false);
		expect(ipv6Equal(a, numberValue(1))).toBe(false);
		expect(ipv6Equal(numberValue(1), numberValue(1))).toBeNull();
		expect(ipv6Order(a, b)).toBe(-1);
		expect(ipv6Order(b, a)).toBe(1);
		expect(ipv6Order(a, v6(1n, 64))).toBe(0);
		expect(ipv6Order(numberValue(1), numberValue(2))).toBeNull();
		expect((ipv6Order(a, numberValue(1)) as Value).errorCode).toBe("IPV6_ARITHMETIC");
		expect(ipv6Comparison(a, b, (o) => o < 0)?.value).toBe(true);
		expect(ipv6Comparison(numberValue(1), numberValue(2), (o) => o < 0)).toBeNull();
		expect(ipv6Comparison(a, stringValue("x"), (o) => o < 0)?.errorCode).toBe("IPV6_ARITHMETIC");
	});

	test("ipv6WholeNumber and baseConversionOperand keep every bit", () => {
		expect(ipv6WholeNumber(a)).toEqual(numberValue(1));
		expect(ipv6WholeNumber(v6((1n << 128n) - 1n)).value).toBe((1n << 128n) - 1n);
		expect(baseConversionOperand(v6((1n << 127n) + 1n))).toBe((1n << 127n) + 1n);
		expect(baseConversionOperand(ipLiteral([stringValue("255|")]))).toBe(255);
	});

	test("ipv6ArgumentRefused refuses a numeric builtin and lets hex and the aggregates through", () => {
		expect(ipv6ArgumentRefused(48, [a])).toBeNull(); // hex
		expect(ipv6ArgumentRefused(49, [a])).toBeNull(); // bin
		expect(ipv6ArgumentRefused(9, [a])).toBeNull(); // min, which words its own refusal
		expect(ipv6ArgumentRefused(0, [numberValue(1)])).toBeNull();
		expect(ipv6ArgumentRefused(0, [])).toBeNull();
		expect(ipv6ArgumentRefused(0, [numberValue(1), a])?.errorCode).toBe("IPV6_ARITHMETIC");
	});
});

describe("the value crosses the formatter and the worker boundary", () => {
	test("formatValue writes the zone and prefix", () => {
		expect(formatValue(v6(1n, 64, "eth0"))).toBe("= ::1%eth0/64");
		expect(formatValue(v6(0n))).toBe("= ::");
	});

	test("the DTO carries the address as a decimal string and survives JSON", () => {
		const dto = serializeValue(v6(0xfe800000000000000000000000000001n, 64, "eth0"));
		expect(dto.ipCidr).toEqual({ addr6: "338288524927261089654018896841347694593", zone: "eth0", prefix: 64, text: "fe80::1%eth0/64" });
		expect(dto.nonFinite).toBeUndefined();
		expect(dto.number).toBe(0);
		expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as a zone is text, and as a word before :: is not an address", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`fe80::1%${word}`);
				expectHonestLine(`${word}::1`);
				expectHonestLine(`hosts in ${word}`);
				expectHonestLine(`fe80::1 in ${word}`);
				expectHonestDocument(`${word} = 2001:db8::/48\nhosts in ${word}\nnetwork of ${word}`);
			}
			expect(show("fe80::1%constructor")).toBe("fe80::1%constructor");
			expect(show("fe80::1%toString in fe80::/10")).toBe("true");
		});
	});

	test("a long run of colons, a long address and many addresses stay linear", () => {
		expectHonestLine(":".repeat(20_000), { budgetMs: 2_000 });
		expectHonestLine(`1${":1".repeat(5_000)}`, { budgetMs: 2_000 });
		expectHonestLine(`${"f".repeat(5_000)}::1`, { budgetMs: 2_000 });
		expectHonestLine(`::${"1:".repeat(5_000)}1`, { budgetMs: 2_000 });
		expectHonestLine(`fe80::1%${"a".repeat(50_000)}`, { budgetMs: 2_000 });
		expectHonestLine(`${"fe80::1 == ".repeat(500)}fe80::1`, { budgetMs: 4_000 });
		expectHonestDocument(RESOURCE_PROBES.manyLines(300, "hosts in 2001:db8::/64"));
	});

	test("look-alike characters do not make an address", () => {
		// A Cyrillic а, a fullwidth digit, Arabic-Indic five, a zero-width space and a direction override.
		for (const line of ["cаfe::1", "fe80::１", "fe80::٥", "fe80::​1", "fe80::‮1", "﻿fe80::1"]) {
			expectHonestLine(line);
		}
		expect(show("cаfe::1")).not.toBe("cаfe::1");
		expect(show("fe80::１")).not.toMatch(/^fe80/);
	});

	test("markup- and injection-shaped text around an address is read as text", () => {
		for (const line of ["fe80::1%<b>", "<b>fe80::1</b>", "fe80::1'; DROP TABLE notes; --", "fe80::1%${5}", "fe80::1%s%s%n"]) {
			expectHonestLine(line);
		}
		for (const line of fill("fe80::1 X", TEXT_EDGES)) expectHonestLine(line);
	});
});

describe("adversarial: realistic breakage", () => {
	test("typos and near-addresses are refused or read as something else, never a wrong address", () => {
		expect(show("2001:db8:::1")).not.toMatch(/^2001/);
		expect(show("2001:db8::1::2")).not.toMatch(/^2001/);
		expect(show("2001:db8:12345::1")).not.toMatch(/^2001:db8:12345/);
		expect(show("1:2:3:4:5:6:7:8:9")).not.toMatch(/^1:2/);
		expect(show("::ffff:256.1.1.1")).not.toMatch(/^::ffff/);
		expect(show("fe80 :: 1")).toBe("1");
		for (const line of ["2001:db8:::1", "2001:db8::1::2", "hosts in 2001:db8::", "netmask of", "network of", "last address of", "2001:db8::/ 64", "2001:db8:: / 64"]) {
			expectHonestLine(line);
		}
	});

	test("a value from the line above, a line reference, a total and a check, through both passes", () => {
		const { batch } = expectHonestDocument(
			"subnet = 2001:db8::/48\nhosts in subnet\nnetwork of subnet\n2001:db8::5 in 2001:db8::/48\nline 1\nfe80::1\ntotal above",
		);
		expect(batch.slice(0, 6)).toEqual([
			"= 2001:db8::/48",
			"= 1208925819614629174706176",
			"= 2001:db8::",
			"= true",
			"= 2001:db8::/48",
			"= fe80::1",
		]);
		expectHonestDocument("a = fe80::1\na == fe80:0::1\na + 1\na as int + 1");
		expectHonestDocument("a = fe80::1\ncheck a == fe80::1\ncheck line 1 in fe80::/10");
		expectHonestDocument("fe80::1 #hosts\n2001:db8::1 #hosts\ntotal of #hosts");
		expectHonestDocument("# Net\nhosts in 2001:db8::/64\n\ntotal of section \"Net\"");
		expectHonestDocument("p = 64\nhosts in 2001:db8::/64\nline 2 with p = 48");
	});

	test("an edit in a live evaluator follows the new address", () => {
		const doc = new DocumentModel();
		doc.setDocument("a = fe80::1\na in fe80::/10");
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			doc.editLine(1, "a = 2001:db8::1");
			const pass = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
			expect(pass.lines.map((l) => (l.result ? formatValue(l.result) : String(l.error)))).toEqual(["= 2001:db8::1", "= false"]);
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("a snapshot round trip leaves the address out, as it does an IPv4 subnet, and the rest restores", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "a = fe80::1");
		engine.evaluateLine(2, "b = 5");
		const snapshot = JSON.parse(JSON.stringify(engine.toJSON()));
		const restored = ExpressionEngine.fromJSON(snapshot, { packages: BUILTIN_PACKAGES });
		try {
			expect(formatValue(restored.evaluateExpression("b + 1"))).toBe("= 6");
		} finally {
			restored.clear();
		}
	});
});

describe("adversarial: edge cases", () => {
	test("the prefix boundaries, the all-zero and all-one addresses", () => {
		expect(show("hosts in ::/0")).toBe("340282366920938463463374607431768211456");
		expect(show("hosts in ::/128")).toBe("1");
		expect(show("network of ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/0")).toBe("::");
		expect(show("last address of ::/128")).toBe("::");
		expect(show("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff as int")).toBe("340282366920938463463374607431768211455");
		expect(show("::/0 as int")).toBe("0");
	});

	test("the numeric edges beside an address stay honest", () => {
		for (const line of [...fill("fe80::1 + X", NUMERIC_EDGES), ...fill("fe80::1 as int * X", NUMERIC_EDGES), ...fill("netmask of /X", NUMERIC_EDGES)]) {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		}
	});

	test("CRLF, a trailing newline and blank lines around addresses", () => {
		expectHonestDocument("fe80::1\r\n2001:db8::/32\r\nhosts in 2001:db8::/64\r\n");
		expectHonestDocument("\n\nfe80::1\n\n\n::1\n");
		expectHonestDocument("   fe80::1   \n\t::ffff:192.168.1.1");
	});
});
