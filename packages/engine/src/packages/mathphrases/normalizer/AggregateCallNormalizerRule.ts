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

/** Whether an argument is a collection map-reduce walks: a bracketed list, a range, or a name that may hold one. */
function isCollection(arg: readonly Token[]): boolean {
	if (arg.length === 0) return false;
	if (arg[0].type === "LBRACKET") return true;
	if (arg.length === 1 && (arg[0].type === "IDENT" || arg[0].type === "UNIT")) return true;
	return arg.some((t) => t.type === "COLON");
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
 * Whether a two-argument `sum(...)` is map-reduce's `sum(<element>, <collection>)`:
 * its first argument is a bare name, or its second a list, a range or a name,
 * and its first is not a colon form. An element is worked out for each item,
 * so it is never a range, and a colon written there is a clock time:
 * `sum(9:30, 10:15)` is two times to add, as `total(9:30, 10:15)` is, where it
 * used to be read as an element `9` and stopped at the colon with the parser's
 * wording.
 *
 * @param body - The first argument's tokens.
 * @param collection - The second argument's tokens.
 */
export function isMapReduceSum(body: readonly Token[], collection: readonly Token[]): boolean {
	if (hasOwnColon(body)) return false;
	const bareName = body.length === 1 && body[0].type === "IDENT";
	return bareName || isCollection(collection);
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
 * - map-reduce stays map-reduce: `sum(x, [10, 20, 30])` and `sum(10*x, 0:9)`,
 *   a two-argument `sum` whose first argument is a bare name or whose second
 *   is a list, a range or a name (see {@link isMapReduceSum}). Three or more
 *   arguments, two plain values (`sum(1, 2)`), or a first argument written
 *   with a colon (`sum(9:30, 10:15)`, two clock times) are an aggregate.
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
