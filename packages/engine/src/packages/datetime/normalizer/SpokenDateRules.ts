/**
 * The spoken relative dates (#704), each fused into the form the engine already
 * reads: `3 days ago` into `3 days before now`, `this friday` into one token
 * for the coming Friday, and `start of`, `end of` or `beginning of` before a
 * period into one token for that period's first or last day.
 *
 * Each claims its words only as the whole phrase, so `ago`, `this`, `start` and
 * `end` stay free in prose and as names (`start = 5`, `3 days ago I paid`).
 */

import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";
import { getMeasure } from "@solve-js/uom/UomConverter";

/** The weekday tokens the lexer makes, to their day of the week (0 is Sunday). */
export const WEEKDAY_TOKEN_DAY: Readonly<Record<string, number>> = {
	SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};

/** The fused `this <weekday>` token, its value the day of the week. */
export const THIS_WEEKDAY = "THIS_WEEKDAY";
/** The fused `start of` (or `beginning of`), before a period. */
export const PERIOD_START = "PERIOD_START";
/** The fused `end of`, before a period. */
export const PERIOD_END = "PERIOD_END";

/** The tokens that name a period for `start of` and `end of`: a period word, or an anchor. */
export const PERIOD_ANCHOR_TOKENS: Readonly<Record<string, { kind: "week" | "month" | "year"; offset: number }>> = {
	WEEK_ANCHOR_NEXT: { kind: "week", offset: 1 },
	WEEK_ANCHOR_THIS: { kind: "week", offset: 0 },
	WEEK_ANCHOR_LAST: { kind: "week", offset: -1 },
	MONTH_ANCHOR_NEXT: { kind: "month", offset: 1 },
	MONTH_ANCHOR_THIS: { kind: "month", offset: 0 },
	MONTH_ANCHOR_LAST: { kind: "month", offset: -1 },
	YEAR_ANCHOR_NEXT: { kind: "year", offset: 1 },
	YEAR_ANCHOR_THIS: { kind: "year", offset: 0 },
	YEAR_ANCHOR_LAST: { kind: "year", offset: -1 },
};

/** A period word on its own, the current one: `end of month`. */
export const PERIOD_WORDS: Readonly<Record<string, "week" | "month" | "year">> = { week: "week", month: "month", year: "year" };

/** Whether a token names a period `start of` or `end of` can take. */
export function periodOf(token: Token | undefined): { kind: "week" | "month" | "year"; offset: number } | null {
	if (token === undefined) return null;
	if (Object.prototype.hasOwnProperty.call(PERIOD_ANCHOR_TOKENS, token.type)) return PERIOD_ANCHOR_TOKENS[token.type];
	if (token.type !== "UNIT" && token.type !== "IDENT") return null;
	const word = (token.text ?? "").toLowerCase();
	return Object.prototype.hasOwnProperty.call(PERIOD_WORDS, word) ? { kind: PERIOD_WORDS[word], offset: 0 } : null;
}

function word(token: Token | undefined): string {
	return token?.type === "IDENT" || token?.type === "UNIT" ? (token.text ?? "").toLowerCase() : "";
}

function endOf(token: Token): number {
	return token.sourceEnd ?? token.offset + (token.text ?? "").length;
}

/**
 * `3 days ago`, `2 hours ago`: a length of time and `ago`, read as that length
 * before now, the form `3 days before now` already is. `now` carries the time of
 * day, as `today` does, so `3 days ago` is a date and a time.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function agoNormalizerRule(priority = 62): NormalizerRule {
	return {
		name: "datetime:ago",
		priority,
		shape: [{ types: ["NUMBER"] }, { types: ["UNIT"] }],
		match(tokens, pos): NormalizerMatch | null {
			const amount = tokens[pos];
			const unit = tokens[pos + 1];
			const ago = tokens[pos + 2];
			if (amount.type !== "NUMBER" || unit?.type !== "UNIT" || word(ago) !== "ago") return null;
			if (getMeasure(unit.value ?? "") !== "time") return null;
			const before = new LexerToken("DATE_OFFSET_BEFORE", tokenTypeId("DATE_OFFSET_BEFORE"), unit.value, unit.text, unit.offset, 0, unit.line, unit.col, endOf(unit));
			const now = new LexerToken("NOW", tokenTypeId("NOW"), "now", ago!.text, ago!.offset, 0, ago!.line, ago!.col, endOf(ago!));
			return { consumed: 3, replacement: [amount, before, now], ruleName: "datetime:ago" };
		},
	};
}

/**
 * `this friday`: the coming Friday, today when today is one. One token, so the
 * word `this` is claimed only before a weekday.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function thisWeekdayNormalizerRule(priority = 62): NormalizerRule {
	return {
		name: "datetime:this-weekday",
		priority,
		shape: [{ types: ["IDENT"], values: ["this"] }],
		match(tokens, pos): NormalizerMatch | null {
			const thisWord = tokens[pos];
			const weekday = tokens[pos + 1];
			if (word(thisWord) !== "this" || weekday === undefined) return null;
			const day = WEEKDAY_TOKEN_DAY[weekday.type];
			if (day === undefined) return null;
			const fused = new LexerToken(THIS_WEEKDAY, tokenTypeId(THIS_WEEKDAY), String(day), `${thisWord.text} ${weekday.text}`, thisWord.offset, 0, thisWord.line, thisWord.col, endOf(weekday));
			return { consumed: 2, replacement: [fused], ruleName: "datetime:this-weekday" };
		},
	};
}

/**
 * `start of month`, `end of next year`, `beginning of this week`: the first or
 * last day of a period. Fused only when a period follows `of`, so `start` and
 * `end` stay ordinary names everywhere else.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function periodEdgeNormalizerRule(priority = 62): NormalizerRule {
	return {
		name: "datetime:period-edge",
		priority,
		shape: [{ types: ["IDENT", "UNIT"], values: ["start", "end", "beginning"] }, { types: ["OF"] }],
		match(tokens, pos): NormalizerMatch | null {
			const edge = word(tokens[pos]);
			if (edge !== "start" && edge !== "end" && edge !== "beginning") return null;
			const of = tokens[pos + 1];
			if (of?.type !== "OF" || periodOf(tokens[pos + 2]) === null) return null;
			const type = edge === "end" ? PERIOD_END : PERIOD_START;
			const first = tokens[pos];
			const fused = new LexerToken(type, tokenTypeId(type), edge, `${first.text} ${of.text}`, first.offset, 0, first.line, first.col, endOf(of));
			return { consumed: 2, replacement: [fused], ruleName: "datetime:period-edge" };
		},
	};
}
