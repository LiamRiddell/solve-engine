/**
 * IPv4 subnet arithmetic, as pure functions (issue #189). An IPv4 address is a
 * 32-bit number written as four 0-255 parts (`192.168.1.10`); a CIDR block is
 * such an address with a prefix length (`192.168.1.0/24`), where the prefix says
 * how many leading bits name the network and the rest name hosts within it. The
 * netmask is those network bits set to 1; the broadcast address is every host
 * bit set to 1. Everything here is plain 32-bit maths, so it carries no engine
 * import and is easy to test.
 *
 * All addresses are held as unsigned 32-bit integers; `>>> 0` keeps JavaScript's
 * signed bitwise operators in the unsigned range.
 */

/** A parsed address and/or prefix. A bare address has no prefix; a bare `/24` has no address. */
export interface ParsedIp {
	readonly addr?: number;
	readonly prefix?: number;
}

/**
 * Parses `a.b.c.d`, `a.b.c.d/n` or `/n`, or null when it is not one of those (a
 * part over 255, a prefix over 32, the wrong shape). This is what a normalizer
 * uses to decide whether a run of digits and dots is really an address.
 */
export function parseIpCidr(text: string): ParsedIp | null {
	const bareprefix = /^\/(\d{1,2})$/.exec(text);
	if (bareprefix) {
		const prefix = Number(bareprefix[1]);
		return prefix <= 32 ? { prefix } : null;
	}
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(text);
	if (!match) return null;
	const octets = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
	if (octets.some((o) => o > 255)) return null;
	const addr = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
	if (match[5] === undefined) return { addr };
	const prefix = Number(match[5]);
	if (prefix > 32) return null;
	return { addr, prefix };
}

/** A 32-bit address as its four dotted parts, e.g. `3232235786` becomes `192.168.1.10`. */
export function formatIp(addr: number): string {
	return [(addr >>> 24) & 255, (addr >>> 16) & 255, (addr >>> 8) & 255, addr & 255].join(".");
}

/** The netmask for a prefix, as a 32-bit address (`/24` gives `255.255.255.0`). */
export function netmask(prefix: number): number {
	return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** The number of usable host addresses in a prefix (`/24` gives 254: 256 minus the network and broadcast). */
export function usableHosts(prefix: number): number {
	if (prefix >= 31) return prefix === 32 ? 1 : 2; // RFC 3021: a /31 is a two-host point-to-point link
	return Math.pow(2, 32 - prefix) - 2;
}

/** The network address of a block: the address with its host bits cleared. */
export function networkAddress(addr: number, prefix: number): number {
	return (addr & netmask(prefix)) >>> 0;
}

/** The broadcast address of a block: the address with its host bits all set. */
export function broadcastAddress(addr: number, prefix: number): number {
	return (addr | (~netmask(prefix) >>> 0)) >>> 0;
}

/** Whether an address falls inside a block, i.e. shares its network. */
export function addressInBlock(addr: number, blockAddr: number, prefix: number): boolean {
	return networkAddress(addr, prefix) === networkAddress(blockAddr, prefix);
}
