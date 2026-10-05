import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { IpLiteralParselet } from "./parselets/IpLiteralParselet";
import { IpQueryParselet } from "./parselets/IpQueryParselet";
import { ipCidrNormalizerRule } from "./normalizer/IpCidrNormalizerRule";
import { ipv6NormalizerRule } from "./normalizer/Ipv6NormalizerRule";
import { Ipv6AddressParselet } from "./parselets/Ipv6AddressParselet";
import { ipLiteral, ipv6Literal, hostsIn, netmaskOf, broadcastOf, networkOf, lastAddressOf, ipInCidr, ipAsInt } from "./IpPluginFunctions";

/**
 * IPv4 and IPv6 subnet arithmetic for network notes (issues #189 and #748).
 *
 * An IP address like `192.168.1.10` names one machine; a subnet like
 * `192.168.1.0/24` names a block of them, where the `/24` says the first 24 bits
 * are the shared network and the rest identify hosts inside it. This package
 * lets a note answer the everyday subnet questions in place, rather than working
 * them out elsewhere and pasting the result back:
 *
 *   hosts in 192.168.1.0/24        254   (how many machines fit)
 *   netmask of /24                 255.255.255.0
 *   broadcast of 192.168.1.0/24    192.168.1.255
 *   192.168.1.10 in 10.0.0.0/8     false (is this address in that block)
 *   10.0.0.0/8 as int              167772160
 *   network of 192.168.1.10/24     192.168.1.0
 *   last address of 2001:db8::/32  2001:db8:ffff:ffff:ffff:ffff:ffff:ffff
 *
 * An IPv6 address (`2001:db8::1`, issue #748) is a 128-bit value held as a
 * bigint, shown in the canonical text of RFC 5952, and answers the same
 * questions, except `broadcast of`, since IPv6 has no broadcast address. It is
 * not a number in arithmetic (its 128 bits are past what a double holds
 * exactly); `as int` gives the whole number. On by default and removable.
 *
 * Trigger-word collision: `network of` and `last address of` are claimed only
 * as whole phrases, so `network`, `last` and `address` stay free as words and
 * variable names, and `last Friday` keeps its date reading. A line of prose
 * that does contain `network of` is read as the question, so what follows
 * has to be a subnet, as it does after `broadcast of`.
 *
 * The `<ip> in <cidr>` membership test rides the existing `in` operator, which
 * the currency package's parselet dispatches to `ipInCidr` when its right side
 * is a subnet; that handler is registered here.
 */
export const IP_PACKAGE: IEnginePackage = {
	name: "solve-ip",
	phrases: {
		"hosts in": "HOSTS_IN",
		"netmask of": "NETMASK_OF",
		"broadcast of": "BROADCAST_OF",
		"network of": "NETWORK_OF",
		"last address of": "LAST_ADDRESS_OF",
	},
	prefixParselets: {
		IP_CIDR: new IpLiteralParselet(),
		IPV6_ADDRESS: new Ipv6AddressParselet(),
		HOSTS_IN: new IpQueryParselet("hostsIn"),
		NETMASK_OF: new IpQueryParselet("netmaskOf"),
		BROADCAST_OF: new IpQueryParselet("broadcastOf"),
		NETWORK_OF: new IpQueryParselet("networkOf"),
		LAST_ADDRESS_OF: new IpQueryParselet("lastAddressOf"),
	},
	normalizerRules: [ipCidrNormalizerRule(), ipv6NormalizerRule()],
	pluginFunctions: {
		ipLiteral,
		ipv6Literal,
		hostsIn,
		netmaskOf,
		broadcastOf,
		networkOf,
		lastAddressOf,
		ipInCidr,
	},
	asConverters: {
		int: ipAsInt,
	},
	tokenCategories: {
		IP_CIDR: "number",
		IPV6_ADDRESS: "number",
		HOSTS_IN: "keyword",
		NETMASK_OF: "keyword",
		BROADCAST_OF: "keyword",
		NETWORK_OF: "keyword",
		LAST_ADDRESS_OF: "keyword",
	},
};
