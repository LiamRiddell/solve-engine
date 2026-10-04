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
 * Two more, about where a run may start (#628):
 *
 * - **Only where a sum can start.** The run is fused only at the start of the
 *   expression or after `(`, `=`, a comma or another `+`. After a `-`, `*`,
 *   `/` or `^` it is left to ordinary precedence: `17:30 - 9:00 + 0:45` fused
 *   `9:00 + 0:45` into 585 minutes and read the line as `17:30 - 585 minutes`,
 *   a time of day, 7:45 AM.
 * - **A run added to a clock subtraction is a length of time.** `17:30 - 9:00`
 *   is a shift, a span of 8:30, and `+ 0:45` after it is forty-five more
 *   minutes, so the run becomes minutes and the span stays a span: 9:15. The
 *   same holds with the subtraction in brackets, `(9:30 - 8:30) + 1:00`.
 *
 * This relies on {@link clockTimeNormalizerRule} having run in an earlier pass
 * to produce the `CLOCK_TIME` tokens, the same cascade the interval rule uses.
 *
 * @module ClockTimeSumNormalizerRule
 */

/** Whether the clock time was written as a time of day: with `am` or `pm`, or as `noon` or `midnight`. */
function isTimeOfDay(token: Token | undefined): boolean {
	return token !== undefined && /([ap]\.?m\.?|noon|midnight)$/i.test((token.text ?? "").trim());
}

/** Whether the token is a clock time this rule may read as a stretch of time. */
function isSummable(token: Token | undefined): boolean {
	return token?.type === "CLOCK_TIME" && !isTimeOfDay(token);
}

/** The token types a sum of clock times may follow: the start of an expression, a bracket, an assignment, a list, or another sum. */
const SUM_STARTS: ReadonlySet<string> = new Set(["LPAREN", "EQUALS", "COMMA", "PLUS"]);

/**
 * Whether the tokens ending just before `end` are a clock subtraction,
 * `CLOCK_TIME - CLOCK_TIME`, optionally in brackets: the span a following
 * `+ 0:45` adds to.
 */
function endsWithClockSubtraction(tokens: Token[], end: number): boolean {
	let i = end - 1;
	const bracketed = tokens[i]?.type === "RPAREN";
	if (bracketed) i--;
	if (tokens[i]?.type !== "CLOCK_TIME" || tokens[i - 1]?.type !== "MINUS" || tokens[i - 2]?.type !== "CLOCK_TIME") return false;
	return !bracketed || tokens[i - 3]?.type === "LPAREN";
}

/** The rule: see the module comment for the boundaries it keeps. */
export function clockTimeSumNormalizerRule(priority = 67): NormalizerRule {
	const RULE = "time:clock-time-sum";
	return {
		name: RULE,
		priority,
		// One slot: a run added to a clock subtraction may be a single time
		// with nothing after it (`17:30 - 9:00 + 0:45`).
		shape: [{ types: ["CLOCK_TIME"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const first = tokens[pos];
			if (!isSummable(first)) return null;
			const before = tokens[pos - 1];
			// `17:30 - 9:00 + 0:45`: the run after the subtraction's `+` is a
			// length added to the span, even a run of one.
			const addedToSpan = before?.type === "PLUS" && endsWithClockSubtraction(tokens, pos - 1);
			if (!addedToSpan) {
				if (before !== undefined && !SUM_STARTS.has(before.type)) return null;
				// A sum's second term, where the first was a subtraction's end:
				// that run belongs to the case above, at its own start.
				if (before?.type === "PLUS" && tokens[pos - 2]?.type === "CLOCK_TIME" && tokens[pos - 3]?.type === "MINUS") return null;
				if (tokens[pos + 1]?.type !== "PLUS" || !isSummable(tokens[pos + 2])) return null;
			}

			let consumed = 1;
			let minutes = Number(first.value);
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
