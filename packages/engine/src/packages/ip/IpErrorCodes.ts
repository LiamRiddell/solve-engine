/**
 * The codes the networking package answers with: subnets, masks and addresses.
 *
 * Each code is the stable name a host branches on; the message beside it is
 * for the reader and may be reworded. See the error code reference.
 */
export const IpErrorCodes = {
	/** A networking form given something that is not an IP address or a subnet. */
	IP_EXPECTED: "IP_EXPECTED",
	/** `hosts in` or `netmask of` given an address with no prefix length, as in `/24`. */
	IP_NO_PREFIX: "IP_NO_PREFIX",
	/** `broadcast of` given something without both an address and a prefix. */
	IP_NEEDS_ADDRESS_AND_PREFIX: "IP_NEEDS_ADDRESS_AND_PREFIX",
	/** `<address> in <subnet>` with no address on the left. */
	IP_EXPECTED_ADDRESS: "IP_EXPECTED_ADDRESS",
	/** `<address> in <subnet>` with no subnet on the right. */
	IP_EXPECTED_BLOCK: "IP_EXPECTED_BLOCK",
	/** An IPv6 address in a note (`fe80::1`, `2001:db8::/32`): only IPv4 addresses and subnets are covered so far. */
	IPV6_NOT_SUPPORTED: "IPV6_NOT_SUPPORTED",
} as const;
