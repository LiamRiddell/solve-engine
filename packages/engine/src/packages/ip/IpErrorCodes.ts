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
	/** `broadcast of`, `network of` or `last address of` given something without both an address and a prefix. */
	IP_NEEDS_ADDRESS_AND_PREFIX: "IP_NEEDS_ADDRESS_AND_PREFIX",
	/** `<address> in <subnet>` with no address on the left. */
	IP_EXPECTED_ADDRESS: "IP_EXPECTED_ADDRESS",
	/** `<address> in <subnet>` with no subnet on the right. */
	IP_EXPECTED_BLOCK: "IP_EXPECTED_BLOCK",
	/** A prefix no address has (`netmask of /200`, `2001:db8::/129`): IPv4 prefixes run from 0 to 32 and IPv6 prefixes from 0 to 128. */
	IP_PREFIX_OUT_OF_RANGE: "IP_PREFIX_OUT_OF_RANGE",
	/** `<address> in <subnet>` with an IPv4 address and an IPv6 subnet, or the other way round. */
	IP_FAMILY_MISMATCH: "IP_FAMILY_MISMATCH",
	/** `broadcast of` an IPv6 block: IPv6 has no broadcast address, and `last address of` gives the block's last one. */
	IPV6_NO_BROADCAST: "IPV6_NO_BROADCAST",
} as const;
