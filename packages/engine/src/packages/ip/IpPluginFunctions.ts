import { Value, ValueType, numberValue, bigIntValue, boolValue, errorValue, ipCidrValue, matrixValue, type IpCidrData, type MatrixData } from "@solve-js/vm/Value";
import { roundEachCell } from "@solve-js/vm/ListRounding";
import { usableHosts, netmask, networkAddress, broadcastAddress, addressInBlock } from "./IpMath";
import { roundExactQuantityToWhole, roundExactToWhole } from "@solve-js/vm/ExactDecimals";
import { exactIntegerValue } from "@solve-js/vm/ExactIntegers";
import { IPV6_BITS, ipv6AddressCount, ipv6InBlock, ipv6LastAddress, ipv6Netmask, ipv6Network } from "./Ipv6Math";

/** The IP/CIDR payload of a value, or a coded error when it is not one. */
function asIp(value: Value | undefined, form: string): IpCidrData | Value {
	if (value?.type === ValueType.IpCidr) return value.value as IpCidrData;
	return errorValue("IP_EXPECTED", `"${form}" expects an IP address or subnet (e.g. 192.168.1.0/24)`);
}

/**
 * Whether a payload is IPv6: it holds a 128-bit address, or it is a bare prefix
 * too long for IPv4 (`/64`). A bare prefix of 32 or less is read as IPv4, so
 * `netmask of /24` keeps its dotted answer; an IPv6 block that short is written
 * with its address (`netmask of 2001:db8::/24`).
 */
export function isIpv6Payload(ip: IpCidrData): boolean {
	return ip.addr6 !== undefined || (ip.addr === undefined && ip.prefix !== undefined && ip.prefix > 32);
}

/**
 * The refusal for a prefix no address has, or null when it is one: a whole
 * number from 0 to 32 for IPv4, or 0 to 128 for IPv6. Only a bare prefix after
 * a question (`netmask of /200`) or after an IPv6 address (`2001:db8::/129`)
 * can arrive out of range; a dotted quad with a prefix past 32 is not read as an
 * address at all.
 */
function prefixRefused(ip: IpCidrData): Value | null {
	const prefix = ip.prefix;
	if (prefix === undefined) return null;
	if (Number.isInteger(prefix) && prefix >= 0 && prefix <= (isIpv6Payload(ip) ? IPV6_BITS : 32)) return null;
	return errorValue(
		"IP_PREFIX_OUT_OF_RANGE",
		`"/${prefix}" is not a prefix length: an IPv4 prefix is a whole number from 0 to 32, and an IPv6 prefix from 0 to 128.`,
	);
}

/** A whole number as a value: a plain number while a double holds it exactly, a bigint past that. */
function wholeNumber(n: bigint): Value {
	return n <= BigInt(Number.MAX_SAFE_INTEGER) ? numberValue(Number(n)) : bigIntValue(n);
}

/**
 * `ipLiteral("<addr>|<prefix>")`: rebuilds an IP/CIDR value from the payload the
 * normalizer packed into the fused token. Either field may be empty (a bare
 * address has no prefix; a bare `/24` has no address).
 */
export function ipLiteral(args: Value[]): Value {
	const [addrText, prefixText] = String(args[0]?.value ?? "").split("|");
	const data: IpCidrData = {
		...(addrText !== undefined && addrText !== "" ? { addr: Number(addrText) } : {}),
		...(prefixText !== undefined && prefixText !== "" ? { prefix: Number(prefixText) } : {}),
	};
	return ipCidrValue(data);
}

/**
 * `ipv6Literal("<hex>|<prefix>|<zone>")`: rebuilds an IPv6 value from the
 * payload `Ipv6NormalizerRule` packed into the fused token: the 128-bit address
 * in hexadecimal, and the prefix and zone, either of which may be empty.
 * A prefix past 128 answers `IP_PREFIX_OUT_OF_RANGE`.
 */
export function ipv6Literal(args: Value[]): Value {
	const [hex, prefixText, zone] = String(args[0]?.value ?? "").split("|");
	if (hex === undefined || !/^[0-9a-f]{1,32}$/.test(hex)) {
		return errorValue("IP_EXPECTED", `"${hex ?? ""}" is not an IPv6 address`);
	}
	const data: IpCidrData = {
		addr6: BigInt(`0x${hex}`),
		...(prefixText !== undefined && prefixText !== "" ? { prefix: Number(prefixText) } : {}),
		...(zone !== undefined && zone !== "" ? { zone } : {}),
	};
	// A prefix past 128 (`2001:db8::/129`) is read so it can be refused here.
	return prefixRefused(data) ?? ipCidrValue(data);
}

/**
 * `hosts in <cidr>`: how many machines the block can number. An IPv4 block
 * keeps back its first address (the network) and its last (the broadcast); an
 * IPv6 block has no broadcast, so every address in it counts: a `/64` holds
 * 2^64.
 */
export function hostsIn(args: Value[]): Value {
	const ip = asIp(args[0], "hosts in");
	if (ip instanceof Value) return ip;
	if (ip.prefix === undefined) return errorValue("IP_NO_PREFIX", `"hosts in" needs a subnet with a prefix, e.g. 192.168.1.0/24`);
	const refused = prefixRefused(ip);
	if (refused) return refused;
	if (isIpv6Payload(ip)) return wholeNumber(ipv6AddressCount(ip.prefix));
	return numberValue(usableHosts(ip.prefix));
}

/** `netmask of <cidr>` / `netmask of /24`: the subnet mask, as an address of the block's own kind. */
export function netmaskOf(args: Value[]): Value {
	const ip = asIp(args[0], "netmask of");
	if (ip instanceof Value) return ip;
	if (ip.prefix === undefined) return errorValue("IP_NO_PREFIX", `"netmask of" needs a prefix, e.g. /24 or 192.168.1.0/24`);
	const refused = prefixRefused(ip);
	if (refused) return refused;
	if (isIpv6Payload(ip)) return ipCidrValue({ addr6: ipv6Netmask(ip.prefix) });
	return ipCidrValue({ addr: netmask(ip.prefix) });
}

/** The address and prefix of a block, or the refusal a form without both answers. */
function blockOf(value: Value | undefined, form: string): { readonly ip: IpCidrData; readonly prefix: number } | Value {
	const ip = asIp(value, form);
	if (ip instanceof Value) return ip;
	if ((ip.addr === undefined && ip.addr6 === undefined) || ip.prefix === undefined) {
		return errorValue("IP_NEEDS_ADDRESS_AND_PREFIX", `"${form}" needs an address and a prefix, e.g. 192.168.1.0/24`);
	}
	return { ip, prefix: ip.prefix };
}

/** `broadcast of <cidr>`: an IPv4 block's broadcast address (every host bit set). An IPv6 block has none, and says so. */
export function broadcastOf(args: Value[]): Value {
	const block = blockOf(args[0], "broadcast of");
	if (block instanceof Value) return block;
	if (block.ip.addr6 !== undefined) {
		return errorValue(
			"IPV6_NO_BROADCAST",
			`An IPv6 block has no broadcast address: IPv6 reaches a group of machines another way (multicast). For the block's last address, write "last address of".`,
		);
	}
	return ipCidrValue({ addr: broadcastAddress(block.ip.addr!, block.prefix) });
}

/** `network of <cidr>`: the block's first address, the one that names the network (every host bit clear). */
export function networkOf(args: Value[]): Value {
	const block = blockOf(args[0], "network of");
	if (block instanceof Value) return block;
	if (block.ip.addr6 !== undefined) return ipCidrValue({ addr6: ipv6Network(block.ip.addr6, block.prefix) });
	return ipCidrValue({ addr: networkAddress(block.ip.addr!, block.prefix) });
}

/** `last address of <cidr>`: the block's last address (every host bit set), for IPv4 the broadcast address. */
export function lastAddressOf(args: Value[]): Value {
	const block = blockOf(args[0], "last address of");
	if (block instanceof Value) return block;
	if (block.ip.addr6 !== undefined) return ipCidrValue({ addr6: ipv6LastAddress(block.ip.addr6, block.prefix) });
	return ipCidrValue({ addr: broadcastAddress(block.ip.addr!, block.prefix) });
}

/**
 * `<ip> in <cidr>`: whether the address falls inside the block. Both have to be
 * the same kind of address, IPv4 or IPv6. A zone (`fe80::1%eth0`) names the
 * link an address is used on, not part of the address, so it is not compared.
 */
export function ipInCidr(args: Value[]): Value {
	const ip = asIp(args[0], "in");
	if (ip instanceof Value) return ip;
	const cidr = asIp(args[1], "in");
	if (cidr instanceof Value) return cidr;
	if (ip.addr === undefined && ip.addr6 === undefined) return errorValue("IP_EXPECTED_ADDRESS", `"in" expects an address on the left`);
	if ((cidr.addr === undefined && cidr.addr6 === undefined) || cidr.prefix === undefined) {
		return errorValue("IP_EXPECTED_BLOCK", `"in" expects a subnet on the right, e.g. 10.0.0.0/8`);
	}
	if ((ip.addr6 === undefined) !== (cidr.addr6 === undefined)) {
		return errorValue(
			"IP_FAMILY_MISMATCH",
			`"in" needs an address and a subnet of the same kind: an IPv4 address is never inside an IPv6 subnet, or an IPv6 address inside an IPv4 one.`,
		);
	}
	if (ip.addr6 !== undefined) return boolValue(ipv6InBlock(ip.addr6, cidr.addr6!, cidr.prefix));
	return boolValue(addressInBlock(ip.addr!, cidr.addr!, cidr.prefix));
}

/**
 * `<cidr> as int`: the address as its integer, 32 bits for IPv4 and 128 for
 * IPv6 (a bigint once it is past what a double holds exactly). A non-IP value
 * truncates to a whole number instead (see {@link truncateToWhole}), so `as
 * int` is also a general integer converter. A list is cut cell by cell, as
 * `int(...)` cuts one, into plain whole numbers (see roundEachCell in
 * vm/ListRounding.ts); it used to read as one 0.
 */
export function ipAsInt(value: Value): Value {
	if (value.type === ValueType.IpCidr) {
		const ip = value.value as IpCidrData;
		if (ip.addr6 !== undefined) return wholeNumber(ip.addr6);
		return numberValue(ip.addr ?? 0);
	}
	const cells = roundEachCell(value, truncateToWhole, "cut to whole numbers");
	if (cells !== null) {
		// `as int` answers plain numbers, so a list drops its unit as a quantity does.
		if (cells.type !== ValueType.Matrix) return cells;
		const m = cells.value as MatrixData;
		return m.unit === undefined ? cells : matrixValue(m.rows, m.cols, m.data);
	}
	return truncateToWhole(value);
}

/**
 * A value that is not an address, as `as int` writes it: its whole part, the
 * fraction dropped towards zero, as `int(...)` and `trunc(...)` drop it.
 *
 * The exact value comes first. Past 2^53 a double holds no fraction, so the
 * literal `9007199254740993.5` is the double 9,007,199,254,740,994, and
 * truncating that double answered 9,007,199,254,740,994 where `floor` and
 * `int` read the exact decimal and answered 9,007,199,254,740,993. A number
 * carrying an exact integer (`2^53 + 1`) is handed back as it is, one carrying
 * an exact fraction is divided out in whole numbers (so `(2^60 + 0.5) as int`
 * is 1,152,921,504,606,846,976), one carrying an exact decimal is truncated in
 * base ten (so `-9007199254740993.5` is -9,007,199,254,740,993), and anything
 * else (text that reads as a number, a quantity, a result with no exact
 * reading) truncates its double, as before. The chain is `roundExactToWhole`
 * in vm/ExactDecimals.ts, the one `int`, `trunc`, `floor`, `ceil` and `round` take.
 *
 * @param value - The value to truncate.
 * @returns A whole number.
 */
export function truncateToWhole(value: Value): Value {
	// `as int` answers a plain number, so a quantity's unit is dropped, though
	// an amount of money is still cut from the decimal it keeps.
	if (value.type === ValueType.Uom) {
		const whole = roundExactQuantityToWhole(value, "trunc")?.exact;
		return whole === undefined ? numberValue(Math.trunc(value.toNumber())) : exactIntegerValue(whole.coef);
	}
	return roundExactToWhole(value, "trunc") ?? numberValue(Math.trunc(value.toNumber()));
}
