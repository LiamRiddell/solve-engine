import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";
import { TimeFormErrorCodes } from "../TimeFormErrorCodes";
import { readIsoDuration, type IsoDurationPart } from "../IsoDuration";

/** The token one part of a read duration becomes; its value is `<amount> <unit>`, as in `30 minutes`. */
export const ISO_DURATION_TYPE = "ISO_DURATION";

/** The token a duration-shaped identifier that breaks the grammar becomes, carrying the reason on {@link Token.fault}. */
export const ISO_DURATION_UNREADABLE_TYPE = "ISO_DURATION_UNREADABLE";

/**
 * The tokens after which a duration's parts can be spread through the
 * addition or subtraction before it: anything that ends a value, so the `+`
 * or `-` before the duration is binary. A unary minus (`-P1DT1H`, `2 * -P1D`)
 * has an operator or nothing before it and takes the bracketed sum instead.
 */
const VALUE_ENDS: ReadonlySet<string> = new Set([
	"NUMBER", "BIGINT", "IDENT", "UNIT", "RPAREN", "RBRACKET", "STRING",
	"DATETIME_LITERAL", "NOW", "TODAY", "TOMORROW", "YESTERDAY", "CLOCK_TIME", "ISO_DURATION",
]);

/**
 * The tokens that may follow a spread duration: the end of the line, or an
 * operator that binds no tighter than `+`, so `a + P1M1D` read as `a + 1 month
 * + 1 day` means what `a + (P1M1D)` means. Anything tighter (`* 2`, `in days`)
 * takes the bracketed sum.
 */
const LOOSE_AFTER: ReadonlySet<string> = new Set([
	"PLUS", "MINUS", "RPAREN", "RBRACKET", "COMMA", "SEMICOLON", "NEWLINE", "EOF",
	"GT", "LT", "GTE", "LTE", "EQUALITY", "NEQ",
]);

/**
 * The identifier's text, joined with what the lexer split off it.
 *
 * `PT1H30M` is one identifier, but a decimal is not: `PT0.5S` lexes as `PT0`,
 * `.5` and `S`, and `PT0,5S` as `PT0`, a comma, `5` and `S`. The pieces are
 * joined only while they touch (no space between), and a decimal mark only
 * after a digit, so `P1D, 2` and `P1D .5` stay what they were.
 *
 * @returns The text and how many tokens it spans.
 */
function joinedRun(tokens: Token[], pos: number): { text: string; consumed: number } {
	let text = tokens[pos].text;
	let end = tokens[pos].offset + text.length;
	let k = pos + 1;
	for (;;) {
		const next = tokens[k];
		if (next === undefined || next.offset !== end) break;
		// Every piece the lexer splits off follows a digit: the decimal after
		// `PT0`, and the designator letters after the decimal's own digits.
		if (!/[0-9]$/.test(text)) break;
		if (next.type === "NUMBER" && /^\.[0-9]/.test(next.text)) {
			text += next.text;
		} else if (next.type === "COMMA") {
			const digits = tokens[k + 1];
			if (digits === undefined || digits.type !== "NUMBER" || digits.offset !== end + 1 || !/^[0-9]+$/.test(digits.text)) break;
			text += `,${digits.text}`;
			k++;
		} else if ((next.type === "IDENT" || next.type === "UNIT") && /^[A-Z]/.test(next.text)) {
			text += next.text;
		} else {
			break;
		}
		end = tokens[k].offset + tokens[k].text.length;
		k++;
	}
	return { text, consumed: k - pos };
}

/** The unit spelling a part is pushed in: singular for exactly one, so `P1D` answers `1 day`. */
function unitSpelling(part: IsoDurationPart): string {
	return Number(part.amount) === 1 ? part.unit : `${part.unit}s`;
}

/**
 * `PT1H30M`, `P1D`, `P1Y2M10DT2H30M`: an ISO 8601 duration read as the length
 * of time it writes (#760). See `IsoDuration.ts` for the grammar.
 *
 * Each part becomes an `ISO_DURATION` token, which pushes its amount in its
 * unit, and the parts are combined in one of two ways:
 *
 * - **Spread through a `+` or `-` before it**, when the duration is the right
 *   side of an addition or subtraction and nothing tighter follows:
 *   `2026-01-31 + P1M1D` is read `2026-01-31 + 1 month + 1 day`. On a date that
 *   is the ISO meaning, each part in turn, so the month moves the month field
 *   (January 31 to February 28, clamped as the engine always clamps) and the
 *   day then moves the day field, landing on March 1. Summing the parts first
 *   would make one length at the unit table's 30-day month and lose that.
 * - **A bracketed sum** everywhere else, `(30 minutes + 1 hour)`: smallest part
 *   first, so the total is held in the smallest unit written, as `1h30m` and
 *   `1 hour 30 minutes` are. `PT1H30M` alone is 90 minutes, and `P1M in days`
 *   is the 30 days `1 month in days` is.
 *
 * A duration-shaped identifier that breaks the grammar becomes an
 * `ISO_DURATION_UNREADABLE` token with the reason on it, which answers as an
 * `ISO_DURATION_MALFORMED` error rather than as an undefined name.
 *
 * Trigger-word note: only an identifier that starts with an upper-case `P` and
 * is made of digits and designator letters is claimed, so prose and ordinary
 * names are untouched. A variable that happens to spell a duration (`P1D`) is
 * shadowed by it; `P`, `PT` and `P1` spell no part and stay names.
 */
export function isoDurationNormalizerRule(priority = 78): NormalizerRule {
	const RULE = "time:iso-duration";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["IDENT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const head = tokens[pos];
			if (head?.type !== "IDENT" || head.text.charCodeAt(0) !== 80 /* P */) return null;

			// The joined run first, then the identifier alone, so a decimal that
			// does not belong (`P1D.5x`) cannot stop a plain `P1D` being read.
			let run = joinedRun(tokens, pos);
			let reading = readIsoDuration(run.text);
			if (reading === null && run.consumed > 1) {
				run = { text: head.text, consumed: 1 };
				reading = readIsoDuration(run.text);
			}
			if (reading === null) return null;

			const source = tokens.slice(pos, pos + run.consumed);
			if (reading.kind === "malformed") {
				const fused = createFusedToken(ISO_DURATION_UNREADABLE_TYPE, run.text, source);
				fused.fault = { code: TimeFormErrorCodes.ISO_DURATION_MALFORMED, message: reading.reason };
				return { consumed: run.consumed, replacement: [fused], ruleName: RULE };
			}

			const part = (p: IsoDurationPart): Token => createFusedToken(ISO_DURATION_TYPE, `${p.amount} ${unitSpelling(p)}`, source);
			const parts = reading.parts;
			if (parts.length === 1) return { consumed: run.consumed, replacement: [part(parts[0])], ruleName: RULE };

			const before = tokens[pos - 1];
			const operand = tokens[pos - 2];
			const after = tokens[pos + run.consumed];
			const spread = (before?.type === "PLUS" || before?.type === "MINUS")
				&& operand !== undefined && VALUE_ENDS.has(operand.type)
				&& (after === undefined || LOOSE_AFTER.has(after.type));

			const replacement: Token[] = [];
			if (spread) {
				// Largest first, each joined by the operator already before the
				// duration: `a - P1DT1H` is `a - 1 day - 1 hour`.
				parts.forEach((p, i) => {
					if (i > 0) replacement.push(createFusedToken(before.type, before.text, source));
					replacement.push(part(p));
				});
			} else {
				replacement.push(createFusedToken("LPAREN", "(", source));
				for (let i = parts.length - 1; i >= 0; i--) {
					replacement.push(part(parts[i]));
					if (i > 0) replacement.push(createFusedToken("PLUS", "+", source));
				}
				replacement.push(createFusedToken("RPAREN", ")", source));
			}
			return { consumed: run.consumed, replacement, ruleName: RULE };
		},
	};
}
