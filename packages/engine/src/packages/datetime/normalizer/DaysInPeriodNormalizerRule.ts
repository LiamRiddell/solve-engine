import type { Token } from "@solve-js/lexer/Token";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { createFusedToken } from "@solve-js/normalizer/TokenNormalizer";

/** Quarter names, which have no other meaning in this position. */
const QUARTERS = new Set(["q1", "q2", "q3", "q4"]);

/** Month names and abbreviations, matching MonthNameDateNormalizerRule. */
const MONTHS = new Set([
	"january", "jan", "february", "feb", "march", "mar", "april", "apr",
	"may", "june", "jun", "july", "jul", "august", "aug",
	"september", "sep", "sept", "october", "oct", "november", "nov",
	"december", "dec",
]);

/** Whether the token begins a calendar period rather than a quantity. */
function startsPeriod(token: Token | undefined): boolean {
	if (token === undefined) return false;
	if (token.type === "DATETIME_LITERAL") return true;
	const word = (token.text ?? token.value ?? "").toLowerCase();
	if (token.type === "IDENT" || token.type === "UNIT") {
		return QUARTERS.has(word) || MONTHS.has(word);
	}
	// A bare four-digit year. A shorter number is a quantity to convert.
	return token.type === "NUMBER" && /^\d{4}$/.test(token.text ?? "");
}

/**
 * Recognises `days in <calendar period>` and nothing else.
 *
 * `days in February 2020` asks how long a real month is; `days in 3 weeks`
 * converts a quantity. The two are spelled identically for the first two
 * words, so this cannot be an ordinary fused phrase: registering `days in`
 * unconditionally claimed the conversion as well and broke it.
 *
 * The lookahead is what separates them. Only a quarter, a month name, a
 * four-digit year, or a date literal the month-name rule has already fused
 * counts as a period; anything else is left for the conversion path.
 */
export function daysInPeriodNormalizerRule(priority = 60): NormalizerRule {
	return {
		name: "datetime:days-in-period",
		priority,
		match(tokens, pos): NormalizerMatch | null {
			const days = tokens[pos];
			if (days === undefined) return null;
			if ((days.text ?? days.value ?? "").toLowerCase() !== "days") return null;
			if (days.type !== "UNIT" && days.type !== "IDENT") return null;
			if (tokens[pos + 1]?.type !== "IN") return null;
			if (!startsPeriod(tokens[pos + 2])) return null;

			return {
				consumed: 2,
				replacement: [createFusedToken("DAYS_IN_PERIOD", "days in", [days, tokens[pos + 1]])],
				ruleName: "datetime:days-in-period",
			};
		},
	};
}
