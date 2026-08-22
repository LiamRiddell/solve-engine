import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { GOAL_SEEK_FN_IDX } from "../GoalSeekPluginFunctions";

/**
 * `solve line M for <var> = <target>`, goal seek over a line reference.
 *
 * Reads as "find the value of `<var>` that makes line M's result equal
 * `<target>`". The word `solve` has already been fused into a `GOAL_SEEK`
 * token by `GoalSeekNormalizerRule` (it fires only when `solve` sits directly
 * before a `LINE_REF`, so the ordinary `solve(...)` call form is untouched),
 * and this parselet reads the rest of the line itself rather than through the
 * ordinary infix grammar, because none of `for`/the bare variable name/`=`
 * would combine into one expression on their own.
 *
 * Emits three arguments for the goal-seek plugin function, in the order it
 * reads them: the target line number, the variable name as a String (a name,
 * not a value, the same reason the algebra verbs push their unknown as a
 * String), and the target as an ordinary expression so `900`, `1,200` or a
 * small calculation all work. The plugin does the search.
 */
export class GoalSeekParselet implements PrefixParselet {
	readonly category = "GoalSeek";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		// Target line, the LINE_REF the normalizer left in place after fusing
		// "solve" into the GOAL_SEEK token this parselet fired on.
		const lineRef = parser.peek();
		if (!lineRef || lineRef.type !== "LINE_REF") {
			throw ErrorFactory.parsing(
				"GOAL_SEEK_SYNTAX",
				`Goal seek reads "solve line N for <var> = <target>", for example "solve line 4 for rate = 900".`,
				{ found: lineRef?.type ?? "end of input" },
			);
		}
		parser.consume();
		const targetLine = parseInt(lineRef.value, 10);

		// The "for" connective. It lexes as FOR_DURATION in the English locale
		// (a bare keyword there) and as a plain IDENT elsewhere, so both are
		// accepted rather than depending on the finance package's token being
		// present.
		const connective = parser.peek();
		const isFor =
			!!connective &&
			(connective.type === "FOR_DURATION" || (connective.type === "IDENT" && connective.value.toLowerCase() === "for"));
		if (!isFor) {
			throw ErrorFactory.parsing(
				"GOAL_SEEK_SYNTAX",
				`Goal seek reads "solve line N for <var> = <target>". Expected "for" after the line reference.`,
				{ found: connective?.type ?? "end of input" },
			);
		}
		parser.consume();

		// The unknown to vary. Requiring IDENT or UNIT gives the same
		// reserved-word protection the algebra verbs rely on: a keyword lexes as
		// its own token type and can never be taken for a variable name here.
		const variable = parser.peek();
		if (!variable || (variable.type !== "IDENT" && variable.type !== "UNIT")) {
			throw ErrorFactory.parsing(
				"GOAL_SEEK_REQUIRES_VARIABLE_NAME",
				`Goal seek needs the name of the variable to vary here, as in "solve line 4 for rate = 900".`,
				{ found: variable?.type ?? "end of input" },
			);
		}
		parser.consume();

		parser.consume("EQUALS");

		// Push the two known arguments first, then let the target parse inline so
		// the stack ends as [line, variable, target] for the CALL_PLUGIN below.
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(targetLine);
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(variable.value);

		// The target value, an ordinary expression (usually a literal).
		parser.parseExpression(BindingPower.Lowest, builder);

		builder.emitOpcode(OpCode.CALL_PLUGIN);
		builder.emitIndex(GOAL_SEEK_FN_IDX);
		builder.emitIndex(3);
	}
}
