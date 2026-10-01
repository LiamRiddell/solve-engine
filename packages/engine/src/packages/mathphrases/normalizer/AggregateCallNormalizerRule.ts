import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import type { NormalizerRule, NormalizerMatch } from "@solve-js/normalizer/NormalizerRule";

/** The token an aggregate call is fused into. See `AggregateCallParselet`. */
export const AGGREGATE_CALL = "AGGREGATE_CALL";
const AGGREGATE_CALL_ID = tokenTypeId(AGGREGATE_CALL);

/** The words read as an aggregate call over plain values. */
const CALL_WORDS: ReadonlySet<string> = new Set(["sum", "total", "average", "mean", "median", "stdev"]);

/** The call words map-reduce also claims, `sum(x, [1, 2, 3])`. */
const MAP_REDUCE_WORDS: ReadonlySet<string> = new Set(["sum"]);

/** Whether a token opens or starts a line reference, which makes the call a line range. */
function isLineReference(token: Token | undefined, next: Token | undefined): boolean {
	if (token === undefined) return false;
	if (token.type === "LINE_REF") return true;
	if (token.type !== "IDENT") return false;
	if (/^line\d+$/i.test(token.value)) return true;
	return /^line$/i.test(token.value) && (next?.type === "NUMBER" || (next?.type === "IDENT" && next.value.toLowerCase() === "deleted"));
}

/**
 * The call's arguments, each a run of tokens, and where its closing bracket
 * is; null when the brackets do not close on the line.
 */
function callArguments(tokens: readonly Token[], open: number): { args: Token[][]; close: number } | null {
	const args: Token[][] = [[]];
	let depth = 0;
	for (let i = open + 1; i < tokens.length; i++) {
		const t = tokens[i];
		if (t.type === "LPAREN" || t.type === "LBRACKET") depth++;
		else if (t.type === "RBRACKET") depth--;
		else if (t.type === "RPAREN") {
			if (depth === 0) return { args: args[0].length === 0 && args.length === 1 ? [] : args, close: i };
			depth--;
		}
		if (depth === 0 && t.type === "COMMA") {
			args.push([]);
			continue;
		}
		args[args.length - 1].push(t);
	}
	return null;
}

/** Whether an argument is written as a collection map-reduce walks: a bracketed list or a range. */
function isWrittenCollection(arg: readonly Token[]): boolean {
	if (arg.length === 0) return false;
	if (arg[0].type === "LBRACKET") return true;
	return arg.some((t) => t.type === "COLON");
}

/** The name map-reduce gives each item in turn, `x` in `sum(x^2, 1:3)`. */
const ELEMENT_NAME = "x";

/**
 * Whether an argument uses the element name `x` anywhere in it, as
 * `sum(x^2, xs)` and `sum(max(x, 1), xs)` do and `sum(a, b)` does not.
 *
 * @param arg - The argument's tokens.
 */
export function mentionsElement(arg: readonly Token[]): boolean {
	return arg.some((t) => (t.type === "IDENT" || t.type === "UNIT") && t.value === ELEMENT_NAME);
}

/**
 * Whether an argument holds a colon of its own, outside any bracket inside it:
 * `9:30` does, `[1:3]` and `f(1:3)` do not.
 *
 * @param arg - The argument's tokens.
 */
export function hasOwnColon(arg: readonly Token[]): boolean {
	let depth = 0;
	for (const t of arg) {
		if (t.type === "LPAREN" || t.type === "LBRACKET") depth++;
		else if (t.type === "RPAREN" || t.type === "RBRACKET") depth--;
		else if (depth === 0 && t.type === "COLON") return true;
	}
	return false;
}

/**
 * Whether a two-argument `sum(...)` is map-reduce's `sum(<element>, <collection>)`
 * rather than two values to add.
 *
 * It is when the second argument is written as a list or a range
 * (`sum(x, [10, 20])`, `sum(x^2, 1:3)`, `sum(5, 1:3)`), or when the first uses
 * the element name `x` (`sum(x, xs)`, `sum(x * 2, prices)`). Otherwise the
 * first argument is the same for every item, and `sum(a, b)` of two names, or
 * of a name and a number, is the two values added, as `total(a, b)` is: read
 * as an element it was `a` once for each item of `b`, and with a single value
 * in `b` it was refused as no list at all.
 *
 * An element is worked out for each item, so it is never a range, and a first
 * argument written with a colon of its own is never map-reduce:
 * `sum(9:30, 10:15)` is two clock times, as `total(9:30, 10:15)` is.
 *
 * @param body - The first argument's tokens.
 * @param collection - The second argument's tokens.
 */
export function isMapReduceSum(body: readonly Token[], collection: readonly Token[]): boolean {
	if (hasOwnColon(body)) return false;
	return isWrittenCollection(collection) || mentionsElement(body);
}

/**
 * `sum(1, 2, 3)`, `average(4, 8)`, `mean(1, 2, 3)`, `median(...)` and
 * `stdev(...)`: the spreadsheet calls over plain values (#703), read as
 * `total of`, `average of`, `median of` and `standard deviation of` are.
 *
 * Each word is claimed only before `(`, so `mean = 4` keeps `mean` a name, and
 * only where no other reading of the same call applies:
 *
 * - a line range stays a line range: `average(line 1 : line 4)`;
 * - map-reduce stays map-reduce: `sum(x, [10, 20, 30])`, `sum(10*x, 0:9)` and
 *   `sum(x, xs)`, a two-argument `sum` whose second argument is written as a
 *   list or a range or whose first uses the element name `x` (see
 *   {@link isMapReduceSum}). Three or more arguments, two plain values
 *   (`sum(1, 2)`), two names (`sum(a, b)`), or a first argument written with
 *   a colon (`sum(9:30, 10:15)`, two clock times) are an aggregate.
 *
 * Runs above the map-reduce and line-range call rules (both at 80), so it is
 * asked first and declines, leaving the call to them, whenever their shape
 * applies.
 *
 * @param priority - Where the rule sits among the normalizer's rules.
 */
export function aggregateCallNormalizerRule(priority = 85): NormalizerRule {
	return {
		name: "mathphrases:aggregate-call",
		priority,
		shape: [{ types: ["IDENT"], values: [...CALL_WORDS] }, { types: ["LPAREN"] }],
		match(tokens, pos): NormalizerMatch | null {
			const word = tokens[pos];
			if (word.type !== "IDENT" || tokens[pos + 1]?.type !== "LPAREN") return null;
			const name = word.value.toLowerCase();
			if (!CALL_WORDS.has(name)) return null;
			const call = callArguments(tokens, pos + 1);
			if (call === null) return null;
			for (let i = pos + 2; i < call.close; i++) {
				if (isLineReference(tokens[i], tokens[i + 1])) return null;
			}
			const { args } = call;
			if (MAP_REDUCE_WORDS.has(name) && args.length === 2 && isMapReduceSum(args[0], args[1])) return null;
			// The words map-reduce and line ranges already own keep their
			// single-argument and empty readings.
			if ((name === "sum" || name === "total" || name === "average") && args.length < 2) return null;
			const fused = new LexerToken(AGGREGATE_CALL, AGGREGATE_CALL_ID, name, word.text, word.offset, 0, word.line, word.col, word.sourceEnd ?? word.offset + word.text.length);
			return { consumed: 1, replacement: [fused], ruleName: "mathphrases:aggregate-call" };
		},
	};
}
