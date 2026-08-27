/**
 * IPv4 subnet arithmetic (issue #189). An address like `192.168.1.10` names one
 * machine; a subnet like `192.168.1.0/24` names a block of them. These forms
 * answer the everyday subnet questions in place.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { serializeValue } from "@solve-js/worker/serialize";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");
const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("the subnet questions", () => {
	test("hosts in a block", () => {
		expect(shown("hosts in 192.168.1.0/24")).toBe("254");
	});

	test("netmask of a prefix, bare or in a block", () => {
		expect(shown("netmask of /24")).toBe("255.255.255.0");
		expect(shown("netmask of 192.168.1.0/24")).toBe("255.255.255.0");
		expect(shown("netmask of /16")).toBe("255.255.0.0");
	});

	test("broadcast address of a block", () => {
		expect(shown("broadcast of 192.168.1.0/24")).toBe("192.168.1.255");
	});

	test("membership: is an address inside a block", () => {
		expect(value("192.168.1.10 in 10.0.0.0/8").value).toBe(false);
		expect(value("192.168.1.10 in 192.168.1.0/24").value).toBe(true);
		expect(value("10.5.6.7 in 10.0.0.0/8").value).toBe(true);
	});

	test("the address as its 32-bit integer", () => {
		expect(shown("10.0.0.0/8 as int")).toBe("167,772,160");
		expect(shown("192.168.1.10 as int")).toBe("3,232,235,786");
	});
});

describe("the literal", () => {
	test("a full block and a bare address both read", () => {
		expect(shown("192.168.1.0/24")).toBe("192.168.1.0/24");
		expect(shown("192.168.1.10")).toBe("192.168.1.10");
		expect(value("192.168.1.0/24").type).toBe(ValueType.IpCidr);
	});

	test("division still wins where the shape is ambiguous", () => {
		// A plain number over another is division, not an address.
		expect(value("5 / 2").toNumber()).toBe(2.5);
		// Spaced around the slash, it is division too: the space is the signal.
		expect(value("192.168.1.0 / 24").type).toBe(ValueType.Number);
	});

	test("a part over 255 is not an address", () => {
		// 300 is not a valid octet, so the run is never fused into an IP: it is
		// left as the ordinary tokens it was, which here do not form a valid
		// expression at all, so it does not quietly become a wrong address.
		let isIp = false;
		try {
			isIp = value("1.300.1.1").type === ValueType.IpCidr;
		} catch {
			isIp = false;
		}
		expect(isIp).toBe(false);
	});
});

describe("serialisation", () => {
	test("the DTO carries the address, prefix and text", () => {
		const dto = serializeValue(value("192.168.1.0/24"));
		expect(dto.ipCidr?.prefix).toBe(24);
		expect(dto.ipCidr?.text).toBe("192.168.1.0/24");
		expect(structuredClone(dto)).toEqual(dto);
	});
});
