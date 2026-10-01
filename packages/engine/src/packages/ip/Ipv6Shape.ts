/**
 * The textual shape of an IPv6 address (issue #748).
 *
 * An address has to be recognised whole before anything else reads it: without
 * this, `fe80::1` answered `1` (the label `fe80:` and the expression `1`), and
 * `fe80::1:2` a clock time. `Ipv6Math.parseIpv6` turns a recognised shape into
 * its 128-bit value.
 */

/** A recognised IPv6 address: the address text, and the zone and prefix written after it. */
export interface Ipv6Shape {
	/** The address itself, as written (`fe80::1`, `::ffff:192.168.1.1`). */
	readonly address: string;
	/** The zone index after a `%` (`eth0` in `fe80::1%eth0`), when one is written. */
	readonly zone?: string;
	/** The prefix length after a `/` (`32` in `2001:db8::/32`), when one is written. */
	readonly prefix?: number;
}

/** One group of an address: one to four hexadecimal digits. */
const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/;

/** A dotted quad at the end of an address (`::ffff:192.168.1.1`), each part 0 to 255. */
const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** A zone index: the interface name or number after `%` (RFC 4007), letters, digits and dots. */
const ZONE = /^[0-9A-Za-z.]{1,64}$/;

/** The longest text read as an address, far above any real one, so a hostile run is refused in one comparison. */
export const MAX_IPV6_TEXT = 128;

/**
 * How many 16-bit groups a run of groups stands for, or -1 when one of them is
 * not a group. A dotted quad is only allowed last, and stands for two.
 */
function countGroups(part: string): number {
	if (part === "") return 0;
	const groups = part.split(":");
	let count = 0;
	for (let i = 0; i < groups.length; i++) {
		const group = groups[i];
		if (HEX_GROUP.test(group)) {
			count++;
			continue;
		}
		const quad = i === groups.length - 1 ? DOTTED_QUAD.exec(group) : null;
		if (quad === null) return -1;
		for (let k = 1; k <= 4; k++) if (Number(quad[k]) > 255) return -1;
		count += 2;
	}
	return count;
}

/**
 * Read `text` as an IPv6 address in the textual forms of RFC 4291 and RFC 5952:
 * eight groups of one to four hex digits joined by colons, or fewer with one
 * `::` standing for the zero groups left out, optionally ending in a dotted
 * IPv4 quad, and optionally followed by `%zone` and `/prefix`.
 *
 * Deliberately narrow, since a colon means other things in a note: a clock time
 * (`12:30`) and a timecode have at most four fields and no `::`, a label (`Note:
 * 5`) ends in a single colon, and a word before `::` that is not hex (`note::5`)
 * is not a group. At least one group must be written, so a bare `::` is left
 * alone, unless a prefix follows it (`::/0`, the block of every address). The walk is linear in the length of `text`, and text longer than
 * {@link MAX_IPV6_TEXT} is never an address.
 *
 * @returns The address, zone and prefix, or `null` when `text` is not wholly an address.
 */
export function readIpv6Shape(text: string): Ipv6Shape | null {
	if (text.length === 0 || text.length > MAX_IPV6_TEXT) return null;

	let rest = text;
	let prefix: number | undefined;
	const slash = rest.indexOf("/");
	if (slash >= 0) {
		const digits = rest.slice(slash + 1);
		if (!/^\d{1,3}$/.test(digits)) return null;
		prefix = Number(digits);
		if (prefix > 128) return null;
		rest = rest.slice(0, slash);
	}

	let zone: string | undefined;
	const percent = rest.indexOf("%");
	if (percent >= 0) {
		zone = rest.slice(percent + 1);
		if (!ZONE.test(zone)) return null;
		rest = rest.slice(0, percent);
	}

	const address = rest;
	const gap = address.indexOf("::");
	let written: number;
	if (gap < 0) {
		written = countGroups(address);
		if (written !== 8) return null;
	} else {
		// Only one `::`, and never three colons in a row.
		if (address.indexOf("::", gap + 1) >= 0) return null;
		const before = countGroups(address.slice(0, gap));
		const after = countGroups(address.slice(gap + 2));
		if (before < 0 || after < 0) return null;
		written = before + after;
		// The gap stands for at least one zero group, and something is written:
		// a group, or a prefix after a bare `::` (`::/0`).
		if (written > 7 || (written === 0 && prefix === undefined)) return null;
	}

	return {
		address,
		...(zone !== undefined ? { zone } : {}),
		...(prefix !== undefined ? { prefix } : {}),
	};
}
