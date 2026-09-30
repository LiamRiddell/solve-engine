/**
 * IPv6 address arithmetic, as pure functions (issue #748). An IPv6 address is a
 * 128-bit number written as eight groups of four hexadecimal digits
 * (`2001:0db8:0000:0000:0000:0000:0000:0001`), usually shortened
 * (`2001:db8::1`). A block (`2001:db8::/32`) is an address with a prefix
 * length, as in IPv4: the prefix says how many leading bits name the network,
 * and the rest number the addresses inside it.
 *
 * A 128-bit number is past what a double holds exactly, so every address here
 * is a `bigint`. Nothing imports the engine, so it is easy to test.
 */
import { readIpv6Shape } from "./Ipv6Shape";

/** The number of bits in an IPv6 address. */
export const IPV6_BITS = 128;

/** Every bit of an address set: `ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff`. */
const ALL_ONES = (1n << 128n) - 1n;

/** Bits 32 to 127 of an IPv4-mapped address (`::ffff:0:0/96`, RFC 4291 section 2.5.5.2), whose last 32 bits show as a dotted quad. */
const IPV4_MAPPED_HIGH = 0xffffn;

/** A parsed IPv6 address, with the zone and prefix written after it. */
export interface ParsedIpv6 {
	/** The 128-bit address. */
	readonly addr: bigint;
	/** The prefix length after a `/`, 0 to 128, when one is written. */
	readonly prefix?: number;
	/** The zone index after a `%` (`eth0` in `fe80::1%eth0`), when one is written. */
	readonly zone?: string;
}

/**
 * The 16-bit groups a run of written groups stands for, a trailing dotted quad
 * counted as two. The run has already been checked by {@link readIpv6Shape}.
 */
function groupsOf(part: string): bigint[] {
	if (part === "") return [];
	const out: bigint[] = [];
	for (const group of part.split(":")) {
		if (group.includes(".")) {
			const [a, b, c, d] = group.split(".").map((octet) => BigInt(Number(octet)));
			out.push((a << 8n) | b, (c << 8n) | d);
		} else {
			out.push(BigInt(parseInt(group, 16)));
		}
	}
	return out;
}

/**
 * Reads the text of an IPv6 address (`2001:db8::1`, `::ffff:192.168.1.1`,
 * `fe80::1%eth0/64`) into its 128-bit value, zone and prefix.
 *
 * Every textual form of RFC 4291 section 2.2 is read: all eight groups, one
 * `::` standing for the zero groups left out, and a dotted IPv4 quad in the last
 * 32 bits. A zone follows a `%` (RFC 4007 section 11) and a prefix a `/`. A bare
 * `::`, the address of all zeros, is read only with a prefix (`::/0`), since on
 * its own nothing tells it apart from two colons.
 *
 * @returns The address, or `null` when `text` is not wholly one.
 */
export function parseIpv6(text: string): ParsedIpv6 | null {
	const shape = readIpv6Shape(text);
	if (shape === null) return null;
	const gap = shape.address.indexOf("::");
	let groups: bigint[];
	if (gap < 0) {
		groups = groupsOf(shape.address);
	} else {
		const head = groupsOf(shape.address.slice(0, gap));
		const tail = groupsOf(shape.address.slice(gap + 2));
		groups = [...head, ...new Array<bigint>(8 - head.length - tail.length).fill(0n), ...tail];
	}
	let addr = 0n;
	for (const group of groups) addr = (addr << 16n) | group;
	return {
		addr,
		...(shape.prefix !== undefined ? { prefix: shape.prefix } : {}),
		...(shape.zone !== undefined ? { zone: shape.zone } : {}),
	};
}

/**
 * A 128-bit address in the canonical text of RFC 5952: lower-case hex, leading
 * zeros dropped from each group, and the longest run of two or more zero groups
 * written as `::` (the first such run when two are as long). A single zero group
 * is written `0`, never `::`. An IPv4-mapped address (`::ffff:0:0/96`) shows its
 * last 32 bits as a dotted quad, as section 5 recommends.
 *
 * @param addr - The address, 0 to 2^128 - 1; bits above 128 are ignored.
 */
export function formatIpv6(addr: bigint): string {
	const value = addr & ALL_ONES;
	if (value >> 32n === IPV4_MAPPED_HIGH) {
		const low = Number(value & 0xffffffffn);
		return `::ffff:${(low >>> 24) & 255}.${(low >>> 16) & 255}.${(low >>> 8) & 255}.${low & 255}`;
	}
	const groups: number[] = [];
	for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));

	// The longest run of zero groups, two or more long, the first on a tie.
	let bestStart = -1;
	let bestLength = 1;
	for (let i = 0; i < 8; ) {
		if (groups[i] !== 0) { i++; continue; }
		let j = i;
		while (j < 8 && groups[j] === 0) j++;
		if (j - i > bestLength) { bestStart = i; bestLength = j - i; }
		i = j;
	}
	const hex = (from: number, to: number): string => groups.slice(from, to).map((g) => g.toString(16)).join(":");
	if (bestStart < 0) return hex(0, 8);
	return `${hex(0, bestStart)}::${hex(bestStart + bestLength, 8)}`;
}

/** The netmask for a prefix, as a 128-bit address (`/64` gives `ffff:ffff:ffff:ffff::`). */
export function ipv6Netmask(prefix: number): bigint {
	const host = BigInt(IPV6_BITS - prefix);
	return (ALL_ONES >> host) << host;
}

/** The first address of a block: the address with its host bits cleared. */
export function ipv6Network(addr: bigint, prefix: number): bigint {
	return addr & ipv6Netmask(prefix);
}

/** The last address of a block: the address with its host bits all set. IPv6 has no broadcast, so this is an ordinary address. */
export function ipv6LastAddress(addr: bigint, prefix: number): bigint {
	return (addr | (ALL_ONES ^ ipv6Netmask(prefix))) & ALL_ONES;
}

/** How many addresses a block holds, 2^(128 - prefix): a `/64` holds 18,446,744,073,709,551,616. */
export function ipv6AddressCount(prefix: number): bigint {
	return 1n << BigInt(IPV6_BITS - prefix);
}

/** Whether an address falls inside a block, i.e. shares its first `prefix` bits. */
export function ipv6InBlock(addr: bigint, blockAddr: bigint, prefix: number): boolean {
	return ipv6Network(addr, prefix) === ipv6Network(blockAddr, prefix);
}
