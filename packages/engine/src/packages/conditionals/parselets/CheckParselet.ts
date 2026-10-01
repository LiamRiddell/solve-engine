import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { EngineError } from "@solve-js/errors/EngineError";

/** The comparison each token stands for, as the check function reads it. */
const OPERATORS: Readonly<Record<string, string>> = {
	EQUALITY: "==",
	NEQ: "!=",
	LT: "<",
	GT: ">",
	LTE: "<=",
	GTE: ">=",
	APPROX: "≈",
};

/** The tokens that join two comparisons into one check: the word `and` and `&&`. */
const JOINS: ReadonlySet<string> = new Set(["AND_CONJ", "LOGICAL_AND"]);

/** The tokens that join two comparisons with `or`, which a check does not read. */
const EITHER: ReadonlySet<string> = new Set(["OR", "LOGICAL_OR"]);

/**
 * The tokens that would otherwise be applied to a check's tick once the check
 * is read, since each binds looser than a comparison: the bitwise operators.
 */
const AFTER_A_CHECK: ReadonlySet<string> = new Set(["BIT_OR", "BIT_XOR", "BIT_AND"]);

/**
 * The comparison a token stands for (`==`, `<`, `≈` and the rest), or
 * undefined for any other token. Read from the table's own entries only, so a
 * token type named after an inherited property is not a comparison.
 *
 * @param token - The token, or undefined at the end of the line.
 */
export function comparisonOf(token: Token | undefined): string | undefined {
	if (token === undefined || !Object.prototype.hasOwnProperty.call(OPERATORS, token.type)) return undefined;
	return OPERATORS[token.type];
}

/**
 * The refusal for a token a check cannot read after its comparison, or null
 * when the token ends the check honestly (the end of the line, or a token the
 * line's own parse already reports).
 *
 * Without it, the token was applied to the check's answer: `check 1 == 1 or 1
 * == 2` answered false (the tick read as a yes-or-no answer), and `check 1 == 1
 * | 2` answered 2.
 *
 * @param token - The token after the check, or undefined at the end of the line.
 */
export function refusalAfterCheck(token: Token | undefined): EngineError | null {
	if (token === undefined) return null;
	if (EITHER.has(token.type)) {
		return ErrorFactory.parsing(
			"CHECK_JOIN_UNSUPPORTED",
			`a check states things that must all hold, so it joins them with "and", not "or". To check that one of two things holds, compare the answer, as in "check (:a > 0 or :b > 0) == true"`,
		);
	}
	if (AFTER_A_CHECK.has(token.type) || comparisonOf(token) !== undefined) {
		return ErrorFactory.parsing(
			"CHECK_JOIN_UNSUPPORTED",
			`a check ends with its comparison, so "${token.value}" after it is not read. Put a side in brackets to use "${token.value}" in it, or join two checks with "and"`,
		);
	}
	return null;
}

/**
 * One run of comparisons, `a < b < c`, and its `within` clause, compiled to
 * the check's answer for that run.
 *
 * Each link but the last is `checkLink`, which hands its right side on to the
 * next link when it holds, so a side shared by two links is worked out once,
 * and hands on its failure otherwise; a failed or unreadable value carries
 * itself through every later call, so the first link that fails is the one
 * the check reports. The last link is `checkComparison`, and a `within`
 * clause belongs to it, the comparison it is written after.
 */
function parseRun(parser: Parser, builder: BytecodeBuilder): void {
	parser.parseExpression(BindingPower.Comparison, builder);
	let op = comparisonOf(parser.peek());
	if (op === undefined) {
		throw ErrorFactory.parsing(
			"CHECK_EXPECTED_COMPARISON",
			`a check compares two things, as in "check :spent <= :budget" or "check 22/7 ≈ pi within 0.1%"`,
		);
	}
	for (;;) {
		parser.consume();
		parser.parseExpression(BindingPower.Comparison, builder);
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(op);
		const next = comparisonOf(parser.peek());
		if (next === undefined) break;
		builder.emitPluginCall("checkLink", 3);
		op = next;
	}
	let argCount = 3;
	if (parser.peek()?.type === "WITHIN") {
		parser.consume();
		parser.parseExpression(BindingPower.Conditional, builder);
		argCount = 4;
	}
	builder.emitPluginCall("checkComparison", argCount);
}

/**
 * `check <a> <comparison> <b> [within <tolerance>]`: a statement that must
 * hold (#506).
 *
 * The two sides are compiled separately rather than as one comparison, so the
 * check can name both of them when it fails: "check failed: $2,010.00 is more
 * than $1,950.00", where a bare comparison could only say false. The work is
 * the `checkComparison` plugin function (see CheckFunctions.ts).
 *
 * Each side is read at `Comparison`, the comparisons' own level, so it runs to
 * the comparison and takes in any conversion written on it: `check 255 in hex
 * == 255` compares the hex value with 255. Read at `Conditional`, the left side
 * stopped before the `as` a conversion is read as, and the line was refused as
 * having no comparison at all.
 *
 * A chain, `check 1 < :x < 10`, is every link at once, as `1 < :x and :x <
 * 10`, and comparisons joined with `and` are one check of all of them; the
 * first that fails is reported. Read as one comparison, the leftover `== 1` of
 * `check 1 == 1 == 1` compared the tick with 1 and answered false, and the
 * `and` of `check 1 == 1 and 1 == 1` added the tick to a yes-or-no answer.
 * `or`, and anything else after the comparison, is refused by name (see
 * {@link refusalAfterCheck}).
 */
export const checkParselet: PrefixParselet = {
	category: "Conditionals",
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parseRun(parser, builder);
		while (JOINS.has(parser.peek()?.type ?? "")) {
			parser.consume();
			parseRun(parser, builder);
			builder.emitPluginCall("checkBoth", 2);
		}
		const refusal = refusalAfterCheck(parser.peek());
		if (refusal !== null) throw refusal;
	},
};
