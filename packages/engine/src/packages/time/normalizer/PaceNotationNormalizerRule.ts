import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { getMeasure } from "@solve-js/uom/UomConverter";

const NUMBER_ID = tokenTypeId("NUMBER");
const UNIT_ID = tokenTypeId("UNIT");

/** Seconds in a minute, which is what the two parts of a pace are. */
const SECONDS_PER_MINUTE = 60;

/** The largest value the seconds part of a pace can hold before it is a minute. */
const MAX_SECONDS = 59;

/**
 * `4:30/km`: a pace, minutes and seconds to cover one of something.
 *
 * A two-part clock literal is a time of day everywhere else in the engine, and
 * reading it as one here produced the epoch: `4:30/km` answered
 * `1,788,665,400,000.00 /km`, and `10 km at 4:30/km` answered seventeen
 * trillion. The arithmetic was already right in the other spelling, since
 * `4m30s/km` is 270 seconds per kilometre, so what was missing was the reading
 * a runner actually writes.
 *
 * The shape that claims it is the denominator. A pace is time over a distance,
 * so the rule fires only when the unit after the slash measures length, which
 * is what keeps `12:00/day` out of it: hours per day is a time over a time and
 * has no pace reading. The distance may carry a magnitude, because
 * `1:30/100m` is the standard swim pace and its denominator is a hundred
 * metres rather than one.
 *
 * A three-part literal is left alone. `1:30:00/km` already reads as an hour and
 * a half per kilometre, through the ordinary duration path, and it does not need
 * this rule to arrive at the right answer.
 *
 * The claim is the whole shape or nothing, so a bare `4:30` is still half past
 * four in the morning, `8:15 + 7:45` is still sixteen hours, and `4:30` divided
 * by anything that is not a distance still means what it did.
 *
 * @module PaceNotationNormalizerRule
 */

/** The rule: see the module comment for why the denominator decides. */
export function paceNotationNormalizerRule(priority = 76): NormalizerRule {
	const RULE = "time:pace-notation";
	return {
		name: RULE,
		priority,
		// Matched before the clock-time rule (65) fuses the literal, and before
		// the bare-rate denominator rule (75) claims the slash, so the raw shape
		// is still on the tape.
		shape: [{ types: ["NUMBER"] }, { types: ["COLON"] }],
		match(tokens: Token[], pos: number): NormalizerMatch | null {
			const minutes = tokens[pos];
			if (minutes?.type !== "NUMBER") return null;
			if (tokens[pos + 1]?.type !== "COLON") return null;
			const seconds = tokens[pos + 2];
			if (seconds?.type !== "NUMBER") return null;
			if (tokens[pos + 3]?.type !== "SLASH") return null;

			// A three-part literal (`1:30:00/km`) is somebody else's shape, and it
			// already reads correctly.
			if (tokens[pos + 4]?.type === "COLON") return null;

			// `1:30/100m` puts a magnitude in front of the distance unit.
			const afterSlash = tokens[pos + 4];
			const unitToken = afterSlash?.type === "NUMBER" ? tokens[pos + 5] : afterSlash;
			if (unitToken?.type !== "UNIT") return null;
			if (getMeasure(unitToken.value ?? "") !== "length") return null;

			const minutesPart = Number(minutes.value);
			const secondsPart = Number(seconds.value);
			if (!Number.isInteger(minutesPart) || !Number.isInteger(secondsPart)) return null;
			if (minutesPart < 0 || secondsPart < 0 || secondsPart > MAX_SECONDS) return null;

			const total = String(minutesPart * SECONDS_PER_MINUTE + secondsPart);
			return {
				consumed: 3,
				replacement: [
					new LexerToken("NUMBER", NUMBER_ID, total, total, minutes.offset, 0, minutes.line, minutes.col),
					new LexerToken("UNIT", UNIT_ID, "seconds", "seconds", minutes.offset, 0, minutes.line, minutes.col),
				],
				ruleName: RULE,
			};
		},
	};
}
