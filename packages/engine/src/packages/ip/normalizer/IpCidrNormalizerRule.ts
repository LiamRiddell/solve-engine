import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { parseIpCidr } from "../IpMath";

const IP_CIDR_TYPE = "IP_CIDR";
const IP_CIDR_TYPE_ID = tokenTypeId(IP_CIDR_TYPE);

/** The dotted-quad shape, with an optional prefix, anchored at the start. */
const IP_CIDR = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?/;

/** How many tokens the longest address run can occupy, a loose walk bound. */
const MAX_TOKENS = 8;

/**
 * Fuses a dotted-quad IPv4 literal, `192.168.1.0` or `192.168.1.0/24`, into a
 * single `IP_CIDR` token (issue #189).
 *
 * ## Why the source is reconstructed rather than pattern-matched by token
 * The lexer does not emit a clean `NUMBER . NUMBER . NUMBER . NUMBER` stream: it
 * absorbs the dots into number tokens and splits them unpredictably, because a
 * `.` before three digits is read as a thousands group and a `.` before other
 * digits as a decimal. So `192.168.1.0` arrives as `192.168.1` + `.0`, and
 * `10.0.0.0` as `10.0` + `.0` + `.0`. A fixed token window cannot describe that.
 * Instead this walks the run of source-contiguous tokens, rebuilds their text,
 * and matches the shape against the reconstruction, exactly as the ISO-timestamp
 * rule in `DateLiteralNormalizerRule` does for the same reason.
 *
 * ## Why contiguity is the guard
 * `192.168.1.0/24` written as one run is an address; `a.b.c.d / n` written with
 * spaces around the slash is division, and must stay division. Every token in
 * the run has to begin exactly where the last ended (no whitespace), so a spaced
 * form never fuses. This is the same adjacency test the date literal uses to
 * tell a date from the subtraction it is spelled like.
 *
 * A run that is not four octets each within 0-255 (a version number, a decimal,
 * a real date) does not match and is left alone.
 */
export function ipCidrNormalizerRule(priority = 72): NormalizerRule {
	const RULE = "ip:ip-cidr-literal";
	return {
		name: RULE,
		priority,
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const first = tokens[pos];
			if (!first || first.type !== "NUMBER") return null;
			if (first.sourceEnd !== undefined) return null; // already fused
			// Cheap reject: an address's first token starts with digits and a dot.
			if (!/^\d{1,3}\./.test(first.text ?? "")) return null;

			// Reconstruct the contiguous run of number/slash tokens.
			let text = first.text ?? "";
			let runEnd = first.offset + text.length;
			const window: Token[] = [first];
			for (let i = pos + 1; i < tokens.length && window.length < MAX_TOKENS; i++) {
				const next = tokens[i];
				if (next.sourceEnd !== undefined) break;
				if (next.offset !== runEnd) break; // a space ends the run
				if (next.type !== "NUMBER" && next.type !== "SLASH") break;
				text += next.text ?? "";
				runEnd = next.offset + (next.text?.length ?? 0);
				window.push(next);
			}

			const matched = IP_CIDR.exec(text);
			if (matched === null) return null;
			const parsed = parseIpCidr(matched[0]);
			if (parsed === null || parsed.addr === undefined) return null; // needs four valid octets

			// The literal has to end where a token ends, or a later token would
			// hold text already consumed here.
			let consumed = 0;
			let covered = 0;
			for (const token of window) {
				covered += token.text?.length ?? 0;
				consumed++;
				if (covered >= matched[0].length) break;
			}
			if (covered !== matched[0].length) return null;

			const payload = `${parsed.addr}|${parsed.prefix ?? ""}`;
			const fused = new LexerToken(
				IP_CIDR_TYPE,
				IP_CIDR_TYPE_ID,
				payload,
				matched[0],
				first.offset,
				0,
				first.line,
				first.col,
				first.offset + matched[0].length,
			);
			return { consumed, replacement: [fused], ruleName: RULE };
		},
	};
}
