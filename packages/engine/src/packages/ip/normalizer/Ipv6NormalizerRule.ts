import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { MAX_IPV6_TEXT } from "../Ipv6Shape";
import { parseIpv6 } from "../Ipv6Math";

const IPV6_TYPE = "IPV6_ADDRESS";
const IPV6_TYPE_ID = tokenTypeId(IPV6_TYPE);

/**
 * Whether every character of `text` is one an address run is made of: a digit,
 * a letter (hex digits, and a zone's name), a colon, a dot, `%` before a zone
 * and `/` before a prefix. A minus is subtraction, not part of a zone.
 *
 * A loop over character codes rather than a pattern, because this runs at
 * every word and number of a line: it reads no global and builds nothing, so
 * the common answer (a token that is not part of any address) costs a few
 * comparisons. It accepts exactly what `/^[0-9A-Za-z.:%/]+$/` did.
 *
 * @param text - A token's source text.
 * @returns True for a non-empty run of those characters.
 */
export function isRunText(text: string): boolean {
	if (text.length === 0) return false;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		// 0-9 and the colon, 48 to 58.
		if (c >= 48 && c <= 58) continue;
		// A-Z and a-z.
		if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) continue;
		// The dot, the percent sign and the slash.
		if (c === 46 || c === 37 || c === 47) continue;
		return false;
	}
	return true;
}

/**
 * How many colons `text` holds, counted in place rather than by splitting it,
 * which built an array per token only to read its length.
 *
 * @param text - A token's source text.
 */
export function colonsIn(text: string): number {
	let colons = 0;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 58) colons++;
	}
	return colons;
}

/** The source text of `token`, or `undefined` for a token that carries none. */
function sourceText(token: Token): string | undefined {
	const text = token.text;
	return text !== undefined && isRunText(text) ? text : undefined;
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

/**
 * Whether the run that starts at `tokens[pos]` has a colon as its second
 * character: in the first token's own text, or as the first character of the
 * token joined straight after it.
 *
 * An address whose text opens with a colon opens with `::` (`::1`,
 * `::ffff:192.168.1.1`): one colon followed by anything else leaves an empty
 * first group, which `readIpv6Shape` refuses however the text goes on. So a
 * run that fails this was never going to read as an address, and the rule can
 * turn it away before measuring the run.
 *
 * @param tokens - The line's tokens.
 * @param pos - The run's first token.
 * @param firstText - That token's source text, already checked.
 */
export function secondCharacterIsColon(tokens: readonly Token[], pos: number, firstText: string): boolean {
	if (firstText.length > 1) return firstText.charCodeAt(1) === 58;
	const next = tokens[pos + 1];
	return next !== undefined
		&& next.sourceEnd === undefined
		&& next.offset === tokens[pos].offset + firstText.length
		&& next.text !== undefined
		&& next.text.charCodeAt(0) === 58;
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
			// Cheap reject for the colon of a label or a `:name` (`:v42 = 43`):
			// an address that opens with a colon opens with two.
			if (firstText.charCodeAt(0) === 58 && !secondCharacterIsColon(tokens, pos, firstText)) return null;

			// A token joined to the one before it is inside a run that started earlier.
			const before = pos > 0 ? tokens[pos - 1] : undefined;
			if (before !== undefined && before.sourceEnd === undefined && sourceText(before) !== undefined
				&& before.offset + (before.text?.length ?? 0) === first.offset) {
				return null;
			}

			// The run is measured first and its text joined only once it has the
			// two colons every address has, so a label (`:v42 = 43`, a colon and
			// a word) is turned away without building a string.
			let length = firstText.length;
			let runEnd = first.offset + firstText.length;
			let consumed = 1;
			let colons = colonsIn(firstText);
			for (let i = pos + 1; i < tokens.length; i++) {
				const next = tokens[i];
				if (next.sourceEnd !== undefined || next.offset !== runEnd) break;
				const nextText = sourceText(next);
				if (nextText === undefined) break;
				length += nextText.length;
				if (length > MAX_IPV6_TEXT) return null;
				runEnd = next.offset + nextText.length;
				colons += colonsIn(nextText);
				consumed++;
			}
			// Cheap reject: an address has at least two colons.
			if (colons < 2) return null;
			// Every token in the run passed `sourceText`, so each has its text.
			let text = firstText;
			for (let i = pos + 1; i < pos + consumed; i++) text += tokens[i].text as string;

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
