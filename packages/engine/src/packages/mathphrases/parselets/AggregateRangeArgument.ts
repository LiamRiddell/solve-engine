import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import { EngineError, ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { safeText } from "@solve-js/parser/ParseMessages";

/** A clock time written as two runs of digits and a colon, the spelling a range shares. */
const RANGE_SHAPED_CLOCK = /^\d+:\d+$/;

/** The most tokens read looking for the call's close, so a hostile line costs a bounded scan. */
const SCAN_LIMIT = 10_000;

/**
 * The text of a call's only argument when it is written like a range
 * (`1:3`, `-2:2`, `x:3`), or undefined.
 *
 * A colon between two numbers is a range only as the list of `sum`, `prod`,
 * `map` and `reduce`; everywhere else the normaliser reads it as a clock time,
 * so `average(1:3)` reached the aggregate as 1:03 AM. This finds that shape,
 * a clock time spelled as digits, a colon and digits, or a bare colon the
 * normaliser left between two operands, so the call can refuse it by name. A
 * call with a comma of its own has several arguments and is not this shape,
 * and a colon inside a nested call or list belongs to that.
 *
 * @param parser - Positioned just after the call's opening bracket.
 * @returns The argument as written (without spaces) and whether the engine read
 *   it as a clock time, or undefined.
 */
export function rangeShapedArgument(parser: Parser): { readonly text: string; readonly clock: boolean } | undefined {
	const tokens: Token[] = [];
	let depth = 0;
	let colon = false;
	for (let i = 0; i < SCAN_LIMIT; i++) {
		const t = parser.peekAt(i);
		if (t === undefined) return undefined;
		if (t.type === "LPAREN" || t.type === "LBRACKET") depth++;
		else if (t.type === "RBRACKET") depth--;
		else if (t.type === "RPAREN") {
			if (depth === 0) break;
			depth--;
		} else if (depth === 0 && t.type === "COMMA") return undefined;
		// A pair no clock reads (`24:30`) is fused to be refused as a time, and is
		// still the colon the reader wrote between two numbers.
		else if (depth === 0 && (t.type === "COLON" || t.type === "INVALID_CLOCK_TIME")) colon = true;
		tokens.push(t);
		if (i === SCAN_LIMIT - 1) return undefined;
	}
	if (tokens.length === 0) return undefined;
	const body = tokens[0].type === "MINUS" ? tokens.slice(1) : tokens;
	const clock = body.length === 1 && body[0].type === "CLOCK_TIME" && RANGE_SHAPED_CLOCK.test(String(body[0].text));
	if (!clock && !colon) return undefined;
	return { text: tokens.map((t) => String(t.text)).join(""), clock };
}

/** What each aggregate does, in the words its refusal uses. */
const AGGREGATE_WORDS: ReadonlyMap<string, { readonly refused: string; readonly instead: (name: string, range: string) => string }> = new Map([
	["total", { refused: "added up", instead: (_name: string, range: string) => `To add up a range, write sum(${range}).` }],
	["average", { refused: "averaged", instead: (name: string) => `To average numbers, list them with commas, as in ${name}(1, 2, 3).` }],
	["mean", { refused: "averaged", instead: (name: string) => `To average numbers, list them with commas, as in ${name}(1, 2, 3).` }],
	["median", { refused: "used in a median", instead: (name: string) => `To find a median, list the numbers with commas, as in ${name}(1, 2, 3).` }],
	["stdev", { refused: "used in a standard deviation", instead: (name: string) => `To find a standard deviation, list the numbers with commas, as in ${name}(1, 2, 3).` }],
]);

/**
 * The refusal for an aggregate call whose only argument is written like a
 * range, or null when it is not (see {@link rangeShapedArgument}).
 *
 * `average(1:3)` asked for a line reference and `mean(1:3)` said a date or
 * time cannot be averaged, both true of what the engine read and neither of
 * what the reader wrote. The refusal says what the colon is here, where it is
 * a range instead, and the spelling that answers.
 *
 * @param parser - Positioned just after the call's opening bracket.
 * @param name - The call's name as typed (`average`, `mean`, `total`, ...).
 * @returns The error to throw, or null.
 */
export function aggregateRangeRefusal(parser: Parser, name: string): EngineError | null {
	const range = rangeShapedArgument(parser);
	if (range === undefined) return null;
	const key = String(name).toLowerCase();
	const words = AGGREGATE_WORDS.get(key) ?? AGGREGATE_WORDS.get("average")!;
	const shown = safeText(range.text);
	const reading = range.clock
		? `${shown} is a clock time, not a range, and a time cannot be ${words.refused}`
		: `${shown} is not a range`;
	return ErrorFactory.parsing(
		"AGGREGATE_CALL_RANGE",
		`In ${safeText(key)}(...), ${reading}: a colon between two numbers is a range only as the list of sum, prod, map or reduce. ${words.instead(safeText(key), shown)}`,
	);
}
