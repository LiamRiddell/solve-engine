import { Value, ValueType, numberValue, boolValue, errorValue, ipCidrValue, type IpCidrData } from "@solve-js/vm/Value";
import { usableHosts, netmask, broadcastAddress, addressInBlock } from "./IpMath";

/** The IP/CIDR payload of a value, or a coded error when it is not one. */
function asIp(value: Value, form: string): IpCidrData | Value {
	if (value.type === ValueType.IpCidr) return value.value as IpCidrData;
	return errorValue("IP_EXPECTED", `"${form}" expects an IP address or subnet (e.g. 192.168.1.0/24)`);
}

/**
 * `ipLiteral("<addr>|<prefix>")`: rebuilds an IP/CIDR value from the payload the
 * normalizer packed into the fused token. Either field may be empty (a bare
 * address has no prefix; a bare `/24` has no address).
 */
export function ipLiteral(args: Value[]): Value {
	const [addrText, prefixText] = String(args[0].value ?? "").split("|");
	const data: IpCidrData = {
		...(addrText !== "" ? { addr: Number(addrText) } : {}),
		...(prefixText !== "" ? { prefix: Number(prefixText) } : {}),
	};
	return ipCidrValue(data);
}

/** `hosts in <cidr>`: the count of usable host addresses in the block. */
export function hostsIn(args: Value[]): Value {
	const ip = asIp(args[0], "hosts in");
	if (ip instanceof Value) return ip;
	if (ip.prefix === undefined) return errorValue("IP_NO_PREFIX", `"hosts in" needs a subnet with a prefix, e.g. 192.168.1.0/24`);
	return numberValue(usableHosts(ip.prefix));
}

/** `netmask of <cidr>` / `netmask of /24`: the subnet mask, as an address. */
export function netmaskOf(args: Value[]): Value {
	const ip = asIp(args[0], "netmask of");
	if (ip instanceof Value) return ip;
	if (ip.prefix === undefined) return errorValue("IP_NO_PREFIX", `"netmask of" needs a prefix, e.g. /24 or 192.168.1.0/24`);
	return ipCidrValue({ addr: netmask(ip.prefix) });
}

/** `broadcast of <cidr>`: the block's broadcast address (every host bit set). */
export function broadcastOf(args: Value[]): Value {
	const ip = asIp(args[0], "broadcast of");
	if (ip instanceof Value) return ip;
	if (ip.addr === undefined || ip.prefix === undefined) {
		return errorValue("IP_NEEDS_ADDRESS_AND_PREFIX", `"broadcast of" needs an address and a prefix, e.g. 192.168.1.0/24`);
	}
	return ipCidrValue({ addr: broadcastAddress(ip.addr, ip.prefix) });
}

/** `<ip> in <cidr>`: whether the address falls inside the block. */
export function ipInCidr(args: Value[]): Value {
	const ip = asIp(args[0], "in");
	if (ip instanceof Value) return ip;
	const cidr = asIp(args[1], "in");
	if (cidr instanceof Value) return cidr;
	if (ip.addr === undefined) return errorValue("IP_EXPECTED_ADDRESS", `"in" expects an address on the left`);
	if (cidr.addr === undefined || cidr.prefix === undefined) {
		return errorValue("IP_EXPECTED_BLOCK", `"in" expects a subnet on the right, e.g. 10.0.0.0/8`);
	}
	return boolValue(addressInBlock(ip.addr, cidr.addr, cidr.prefix));
}

/**
 * `<cidr> as int`: the address as its 32-bit integer. A non-IP value truncates
 * to a whole number instead, so `as int` is also a general integer converter.
 */
export function ipAsInt(value: Value): Value {
	if (value.type === ValueType.IpCidr) {
		const ip = value.value as IpCidrData;
		return numberValue(ip.addr ?? 0);
	}
	return numberValue(Math.trunc(value.toNumber()));
}
