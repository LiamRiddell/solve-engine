import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { MAX_IPV6_TEXT } from "../Ipv6Shape";
import { parseIpv6 } from "../Ipv6Math";

const IPV6_TYPE = "IPV6_ADDRESS";
const IPV6_TYPE_ID = tokenTypeId(IPV6_TYPE);

/** The characters an address run is made of: hex digits, colons, dots, a zone and a prefix (a minus is subtraction, not part of a zone). */
const RUN_TEXT = /^[0-9A-Za-z.:%/]+$/;

/** The source text of `token`, or `undefined` for a token that carries none. */
function sourceText(token: Token): string | undefined {
	const text = token.text;
	return text !== undefined && text.length > 0 && RUN_TEXT.test(text) ? text : undefined;
}

/**
 * The token types an address can start with. A first group is usually a word
 * (`fe80`), a number (`2001`, `85` of `85a3`) or the colon of a leading `::`,
 * but a group spelled like a word the engine already knows lexes as that word:
 * `e` is the constant, `b` and `d` are units, `add` is the plus sign and `dec`
 * a converter name, so `e::1` and `add::5` start with those.
 */
const START_TYPES: readonly string[] = ["IDENT", "NUMBER", "COLON", "E", "UNIT", "PLUS", "CONVERTER_NAME", "FUNC"];

/** Whether a colon follows `tokens[pos]` within the next four tokens, each joined to the one before it. */
function colonSoonAfter(tokens: Token[], pos: number): boolean {
	let end = tokens[pos].offset + (tokens[pos].text?.length ?? 0);
	for (let i = pos + 1; i < tokens.length && i <= pos + 4; i++) {
		const next = tokens[i];
		if (next.offset !== end) return false;
		if (next.type === "COLON") return true;
		end = next.offset + (next.text?.length ?? 0);
	}
	return false;
}

/** A prefix written after an address, too long for any (`/129`), read so the literal can refuse it by name. */
const LONG_PREFIX = /\/(\d{1,3})$/;

/**
 * The address a run's text is, with its prefix as written, or null when it is
 * not one. A prefix past 128 (`2001:db8::/129`) still reads, so the address is
 * refused for its prefix by name rather than read as a clock time: the prefix
 * is checked when the literal is evaluated (`ipv6Literal`).
 */
export function readAddress(text: string): { readonly addr: bigint; readonly prefix: string; readonly zone?: string } | null {
	const parsed = parseIpv6(text);
	if (parsed !== null) return { addr: parsed.addr, prefix: parsed.prefix === undefined ? "" : String(parsed.prefix), ...(parsed.zone !== undefined ? { zone: parsed.zone } : {}) };
	const long = LONG_PREFIX.exec(text);
	if (long === null || Number(long[1]) <= 128) return null;
	const bare = parseIpv6(text.slice(0, long.index));
	if (bare === null || bare.prefix !== undefined) return null;
	return { addr: bare.addr, prefix: long[1], ...(bare.zone !== undefined ? { zone: bare.zone } : {}) };
}

/**
 * Fuses an IPv6 address (`fe80::1`, `2001:db8::/32`, `::ffff:192.168.1.1`) into
 * one `IPV6_ADDRESS` token, so the line reads the address rather than a label
 * and a number built from its last group (issue #748). The token's value is the
 * packed payload `<hex>|<prefix>|<zone>` (the 128-bit address in hexadecimal,
 * then the prefix and zone, either empty), which `ipv6Literal` turns into the
 * address value at run time; its text is the address as written.
 *
 * ## Why the source is reconstructed
 * The lexer splits an address unpredictably: `85a3` is the number `85` and the
 * word `a3`, a run of digits and colons can be a clock time, and a dotted quad
 * at the end is the IPv4 rule's. As `IpCidrNormalizerRule` does for a dotted
 * quad, this rebuilds the text of the run of source-contiguous tokens and reads
 * the address from that (`parseIpv6`, through `readIpv6Shape`).
 *
 * ## The guards
 * - **The whole run.** Every token has to start where the last one ended, and
 *   the address has to be all of the run: `fe80::1 + 2` is an address and an
 *   addition, and a run with anything left over is not an address.
 * - **The start of the run.** A token joined to the one before it does not start
 *   an address, so `note::5` is not read from its `::` onward as `::5`.
 * - **Priority.** Above the clock-time and IPv4 rules, so `fe80::1:2` is not a
 *   time and `::ffff:192.168.1.1` is not a dotted quad after a label.
 *
 * The walk is bounded by {@link MAX_IPV6_TEXT} characters, so a long run of
 * colons costs one pass over at most that much text.
 */
export function ipv6NormalizerRule(priority = 95): NormalizerRule {
	const RULE = "ip:ipv6-address";
	return {
		name: RULE,
		priority,
		shape: [{ types: START_TYPES }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const first = tokens[pos];
			if (first === undefined || first.sourceEnd !== undefined) return null;
			if (!START_TYPES.includes(first.type)) return null;
			// Cheap reject, ahead of any text work, since this runs at every word
			// and number: an address has a colon within its first group, which
			// is at most four characters and so at most four tokens.
			if (first.type !== "COLON" && !colonSoonAfter(tokens, pos)) return null;
			const firstText = sourceText(first);
			if (firstText === undefined) return null;

			// A token joined to the one before it is inside a run that started earlier.
			const before = pos > 0 ? tokens[pos - 1] : undefined;
			if (before !== undefined && before.sourceEnd === undefined && sourceText(before) !== undefined
				&& before.offset + (before.text?.length ?? 0) === first.offset) {
				return null;
			}

			let text = firstText;
			let runEnd = first.offset + firstText.length;
			let consumed = 1;
			let colons = firstText.split(":").length - 1;
			for (let i = pos + 1; i < tokens.length; i++) {
				const next = tokens[i];
				if (next.sourceEnd !== undefined || next.offset !== runEnd) break;
				const nextText = sourceText(next);
				if (nextText === undefined) break;
				text += nextText;
				if (text.length > MAX_IPV6_TEXT) return null;
				runEnd = next.offset + nextText.length;
				colons += nextText.split(":").length - 1;
				consumed++;
			}
			// Cheap reject: an address has at least two colons.
			if (colons < 2) return null;

			const read = readAddress(text);
			if (read === null) return null;

			const payload = `${read.addr.toString(16)}|${read.prefix}|${read.zone ?? ""}`;
			const fused = new LexerToken(
				IPV6_TYPE,
				IPV6_TYPE_ID,
				payload,
				text,
				first.offset,
				0,
				first.line,
				first.col,
				runEnd,
			);
			return { consumed, replacement: [fused], ruleName: RULE };
		},
	};
}
