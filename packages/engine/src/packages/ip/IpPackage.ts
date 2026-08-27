import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { IpLiteralParselet } from "./parselets/IpLiteralParselet";
import { IpQueryParselet } from "./parselets/IpQueryParselet";
import { ipCidrNormalizerRule } from "./normalizer/IpCidrNormalizerRule";
import { ipLiteral, hostsIn, netmaskOf, broadcastOf, ipInCidr, ipAsInt } from "./IpPluginFunctions";

/**
 * IPv4 subnet arithmetic for network notes (issue #189).
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
 *
 * IPv6 is deliberately left out of this first cut: its 128-bit addresses and
 * colon notation need their own literal and their own maths, and the dotted-quad
 * form covers the common case. On by default and removable.
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
	},
	prefixParselets: {
		IP_CIDR: new IpLiteralParselet(),
		HOSTS_IN: new IpQueryParselet("hostsIn"),
		NETMASK_OF: new IpQueryParselet("netmaskOf"),
		BROADCAST_OF: new IpQueryParselet("broadcastOf"),
	},
	normalizerRules: [ipCidrNormalizerRule()],
	pluginFunctions: {
		ipLiteral,
		hostsIn,
		netmaskOf,
		broadcastOf,
		ipInCidr,
	},
	asConverters: {
		int: ipAsInt,
	},
	tokenCategories: {
		IP_CIDR: "number",
		HOSTS_IN: "keyword",
		NETMASK_OF: "keyword",
		BROADCAST_OF: "keyword",
	},
};
