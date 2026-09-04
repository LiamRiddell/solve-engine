import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

const UNIT_ID = tokenTypeId("UNIT");

/**
 * `8:15 + 7:45 + 8:30`: clock times added together are stretches of time, not
 * times of day.
 *
 * A timesheet writes each day as hours and minutes and adds the column up. Read
 * strictly, that line adds three times of day, which is why it used to be
 * refused: there is no such thing as half past eight plus quarter to eight. The
 * only reading that means anything is the one a timesheet intends, so the chain
 * becomes the duration it stands for, in minutes, which is the unit every other
 * duration in the engine comes back in.
 *
 * A `CLOCK_TIME` already carries its minutes since midnight, so the sum is the
 * sum of those values, and the result is left as an ordinary number and unit.
 * Everything a duration can already do then applies without any of it being
 * written twice: `in hours` converts it, `at £15/hour` prices it, and another
 * `+ 30 minutes` adds to it.
 *
 * Two boundaries, both deliberate:
 *
 * - **Only `+`.** A `-` between two clock times is genuinely ambiguous, as
 *   {@link clockTimeIntervalNormalizerRule} explains: `5pm - 7pm` reads as a
 *   range and `5pm - 2pm` as a subtraction. That rule refuses to guess, and so
 *   does this one.
 * - **Only a bare `8:15`, never `8:15am`.** A time written with `am` or `pm` is
 *   a time of day and nothing else, so adding two of those is still refused
 *   rather than answered with a number that means nothing.
 *
 * This relies on {@link clockTimeNormalizerRule} having run in an earlier pass
 * to produce the `CLOCK_TIME` tokens, the same cascade the interval rule uses.
 *
 * @module ClockTimeSumNormalizerRule
 */

/** Whether the clock time was written as a time of day, with `am` or `pm`. */
function isTimeOfDay(token: Token | undefined): boolean {
	return token !== undefined && /[ap]\.?m\.?$/i.test((token.text ?? "").trim());
}

/** Whether the token is a clock time this rule may read as a stretch of time. */
function isSummable(token: Token | undefined): boolean {
	return token?.type === "CLOCK_TIME" && !isTimeOfDay(token);
}

/** The rule: see the module comment for the two boundaries it keeps. */
export function clockTimeSumNormalizerRule(priority = 67): NormalizerRule {
	const RULE = "time:clock-time-sum";
	return {
		name: RULE,
		priority,
		shape: [{ types: ["CLOCK_TIME"] }, { types: ["PLUS"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const first = tokens[pos];
			if (!isSummable(first)) return null;
			if (tokens[pos + 1]?.type !== "PLUS") return null;
			if (!isSummable(tokens[pos + 2])) return null;

			let consumed = 3;
			let minutes = Number(first.value) + Number(tokens[pos + 2].value);
			while (tokens[pos + consumed]?.type === "PLUS" && isSummable(tokens[pos + consumed + 1])) {
				minutes += Number(tokens[pos + consumed + 1].value);
				consumed += 2;
			}
			if (!Number.isFinite(minutes)) return null;

			const source = tokens.slice(pos, pos + consumed);
			const total = createFusedToken("NUMBER", String(minutes), source);
			// The unit is written where the source ended, with no width of its
			// own: it stands for the whole chain, which the number already spans.
			const last = source[source.length - 1];
			const end = last.offset + (last.text ?? "").length;
			const unit = new LexerToken("UNIT", UNIT_ID, "minutes", "", end, 0, last.line, last.col);
			return { consumed, replacement: [total, unit], ruleName: RULE };
		},
	};
}
