import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/** Weekday token type -> Date.getDay() index (0=Sunday..6=Saturday). */
const WEEKDAY_TOKEN_INDEX: Record<string, number> = {
	SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};

const NTH_WEEKDAY_TYPE = "NTH_WEEKDAY";
const NTH_WEEKDAY_TYPE_ID = tokenTypeId(NTH_WEEKDAY_TYPE);

/** A written ordinal: digits and their suffix, e.g. `2nd`, `21st`, `4th`. */
const ORDINAL = /^(\d+)(st|nd|rd|th)$/i;

/**
 * Fuses the `<ordinal> <weekday>` head of `2nd Tuesday of March 2026` into a
 * single `NTH_WEEKDAY` token, so {@link NthWeekdayParselet} sees one token
 * carrying the ordinal and the weekday and reads the `of <month>` after it.
 *
 * ## Reading the ordinal in the text layer
 * The wiki documents this as "no new lexer token": the ordinal is recognised
 * here, from the tokens the lexer already produced, rather than by teaching the
 * number scanner about `nd`. That matters because the lexer splits an ordinal
 * inconsistently, `2nd` becomes a BigInt `2n` plus a unit `d`, `3rd` a number
 * plus an identifier `rd`, `1st` a number plus a unit `st`, so no single token
 * shape describes them all. What is invariant is the SOURCE: the two tokens
 * always touch, and their text always spells the ordinal, so the rule
 * reconstructs the run and matches {@link ORDINAL} against it. `last` is a bare
 * keyword and needs no reconstruction.
 *
 * ## Why it only fires before `of`
 * `last Friday` on its own is the previous Friday from now, which
 * {@link NextLastParselet} answers, and `2nd Tuesday` on its own is not a date
 * at all. This shape is only a date as `<ordinal> <weekday> of <month>`, so the
 * rule declines unless an `of` follows the weekday, leaving every bare
 * `next`/`last <weekday>` untouched. The `of` itself is left in the stream for
 * the parselet to consume.
 */
export function nthWeekdayNormalizerRule(priority = 66): NormalizerRule {
	const RULE = "datetime:nth-weekday";
	return {
		name: RULE,
		priority,
		// The ordinal is the LAST keyword or the number of a glued ordinal: the
		// lexer splits `2nd` into a NUMBER (a BIGINT past the safe range) and a
		// word, and the rule reads the two as one run.
		shape: [{ types: ["LAST", "NUMBER", "BIGINT"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const first = tokens[pos];
			if (!first) return null;

			let ordinal: string | null = null;
			let ordinalTokens = 0;

			if (first.type === "LAST") {
				ordinal = "last";
				ordinalTokens = 1;
			} else {
				const second = tokens[pos + 1];
				if (!second) return null;
				// The ordinal must be one uninterrupted run in the source; a
				// space ("2 nd") is not an ordinal.
				const firstEnd = first.sourceEnd ?? first.offset + (first.text?.length ?? 0);
				if (firstEnd !== second.offset) return null;
				const run = (first.text ?? "") + (second.text ?? "");
				const matched = ORDINAL.exec(run);
				if (!matched) return null;
				ordinal = String(Number(matched[1]));
				ordinalTokens = 2;
			}

			const weekday = tokens[pos + ordinalTokens];
			const dow = weekday ? WEEKDAY_TOKEN_INDEX[weekday.type] : undefined;
			if (dow === undefined) return null;

			// Only a date when `of <month>` follows; otherwise leave the tokens
			// for NextLastParselet (or as the non-date they are).
			if (tokens[pos + ordinalTokens + 1]?.type !== "OF") return null;

			const value = `${ordinal}:${dow}`;
			const fused = new LexerToken(
				NTH_WEEKDAY_TYPE,
				NTH_WEEKDAY_TYPE_ID,
				value,
				value,
				first.offset,
				0,
				first.line,
				first.col,
			);
			return { consumed: ordinalTokens + 1, replacement: [fused], ruleName: RULE };
		},
	};
}
