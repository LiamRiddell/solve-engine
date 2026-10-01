import type { Token } from "@solve-js/lexer/Token";
import { textOf } from "@solve-js/engine/ColonLabel";

/** The call words a range is the list of, by the token the map-reduce rule fuses each into. */
const RANGE_CALL_TYPES: Readonly<Record<string, string>> = { MAP: "map", REDUCE: "reduce", SUM_FN: "sum", PROD_FN: "prod" };

/** The same call words as typed, before that rule has fused them; `total` is `sum`'s synonym. */
const RANGE_CALL_WORDS: ReadonlySet<string> = new Set(["map", "reduce", "sum", "prod", "total"]);

/** The most tokens read for the rest of the call, so a hostile line costs a bounded scan. */
const REST_SCAN_LIMIT = 10_000;

/** The longest rest of a call the refusal quotes as written. */
const REST_QUOTE_LIMIT = 30;

/** Why a colon pair is refused: the code and the reader's message. */
export interface RangeArgumentFault {
	readonly code: string;
	readonly message: string;
}

/**
 * Whether a colon pair no clock reads is written as a range rather than as a
 * mistyped time: two whole numbers, the first no larger than the second, and
 * not in a clock's shape of up to two digits, a colon and two digits. So
 * `100:200` and `1:100` are ranges, and `24:30`, `9:60` and `24:00` (which
 * counts down) are the times they look like, refused as times.
 *
 * @param low - The number before the colon, as written.
 * @param high - The number after it, as written.
 */
export function isRangeShapedPair(low: string, high: string): boolean {
	if (!/^\d{1,16}$/.test(low) || !/^\d{1,16}$/.test(high)) return false;
	if (Number(low) > Number(high)) return false;
	return !(low.length <= 2 && high.length === 2);
}

/**
 * The call word (`sum`, `map`, ...) when the token at `open` is the bracket of
 * a call a range is the list of, or undefined.
 *
 * @param tokens - The pass's tokens.
 * @param open - The index of an LPAREN.
 */
export function rangeCallWord(tokens: readonly Token[], open: number): string | undefined {
	if (tokens[open]?.type !== "LPAREN") return undefined;
	const prev = tokens[open - 1];
	if (prev === undefined) return undefined;
	if (Object.prototype.hasOwnProperty.call(RANGE_CALL_TYPES, prev.type)) return RANGE_CALL_TYPES[prev.type];
	if (prev.type !== "IDENT") return undefined;
	const word = String(prev.value).toLowerCase();
	return RANGE_CALL_WORDS.has(word) ? word : undefined;
}

/**
 * The refusal for a whole-number colon pair that no clock reads, written as
 * the first of several arguments to `sum`, `total`, `prod`, `map` or `reduce`
 * (`sum(100:200, 50)`), or null for any other pair.
 *
 * A colon between two numbers is a range only as the list those calls work
 * through, their last argument; the first of several is the expression worked
 * out for each element, where a colon pair is a clock time. A pair no clock
 * reads was refused as one, `"100:200" is not a valid time`, which answered a
 * question the reader never asked: the pair is plainly a range, in the one
 * place a range is not read. The refusal names the range and says where it
 * goes. A pair that is a real time (`sum(10:12, 5)`) is still a time, and one
 * in a clock's shape, counting down, with a decimal or with more than two
 * fields is still refused as a time (see {@link isRangeShapedPair}).
 *
 * @param tokens - The pass's tokens.
 * @param pos - The index of the pair's first number.
 * @param consumed - How many tokens the pair takes (three for `a:b`).
 * @returns The refusal, or null.
 */
export function rangeBeforeLaterArgument(tokens: readonly Token[], pos: number, consumed: number): RangeArgumentFault | null {
	if (consumed !== 3) return null;
	const low = tokens[pos], high = tokens[pos + 2];
	if (low?.type !== "NUMBER" || high?.type !== "NUMBER") return null;
	// A grouped bound (`1,000`) is read without its grouping commas.
	if (!isRangeShapedPair(String(low.value).replace(/,/g, ""), String(high.value).replace(/,/g, ""))) return null;
	if (tokens[pos + consumed]?.type !== "COMMA") return null;
	const verb = rangeCallWord(tokens, pos - 1);
	if (verb === undefined) return null;
	const range = `${String(low.text || low.value)}:${String(high.text || high.value)}`;
	return {
		code: "RANGE_BEFORE_ANOTHER_ARGUMENT",
		message: `In ${verb}(...), ${range} is a range, and a range is read only as the last argument, the list ${verb} works through. ${afterwards(verb, range, restOfCall(tokens, pos + consumed + 1))}`,
	};
}

/**
 * The call's arguments after the first, each as written, up to its closing
 * bracket; null when one is empty or not the reader's text, the call never
 * closes, or they are too long to quote.
 *
 * @param tokens - The pass's tokens.
 * @param from - The index of the first token after the first argument's comma.
 */
export function restOfCall(tokens: readonly Token[], from: number): string[] | null {
	let depth = 0;
	let start = from;
	const parts: string[] = [];
	const end = Math.min(tokens.length, from + REST_SCAN_LIMIT);
	for (let i = from; i < end; i++) {
		const type = tokens[i].type;
		const closes = type === "RPAREN" && depth === 0;
		if ((type === "COMMA" && depth === 0) || closes) {
			if (i === start) return null;
			const text = textOf(tokens.slice(start, i));
			if (text === null) return null;
			parts.push(text);
			start = i + 1;
			if (closes) return parts.join(", ").length <= REST_QUOTE_LIMIT ? parts : null;
			continue;
		}
		if (type === "LPAREN" || type === "LBRACKET") depth++;
		else if (type === "RPAREN" || type === "RBRACKET") depth--;
	}
	return null;
}

/** The second sentence of the refusal: how the call is written instead. */
function afterwards(verb: string, range: string, rest: readonly string[] | null): string {
	if (verb === "map") return `Write the expression first and the range last, as in map(x * 2, ${range}).`;
	if (verb === "reduce") return `Write the expression first and the range last, as in reduce(acc + x, ${range}).`;
	const operator = verb === "prod" ? "*" : "+";
	const doing = verb === "prod" ? "multiply" : "add";
	if (rest === null) return `To ${doing} other numbers in as well, write them outside the call, after ${verb}(${range}).`;
	return `To ${doing} other numbers in as well, write them outside the call: ${verb}(${range}) ${operator} ${rest.join(` ${operator} `)}.`;
}
