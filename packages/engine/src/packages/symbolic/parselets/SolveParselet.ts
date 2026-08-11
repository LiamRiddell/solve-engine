import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { SYMBOLIC_BUILTIN_SOLVE } from "@solve-js/packages/symbolic/SymbolicBuiltinIndex";
import { emitVariableName, parseBoundExpression, emitBoundExpression } from "@solve-js/packages/symbolic/parselets/VariableArgument";

/**
 * `solve(equation, variable)`, for example `solve(x^2-4=0, x)`.
 *
 * Two things here cannot go through the ordinary function-call grammar, which
 * is why this is a hand-written parselet.
 *
 * The first argument contains a bare `=`, which no infix parselet consumes, so
 * an ordinary argument list would fail to parse it. This reads the two sides
 * separately and lets a missing right-hand side default to zero, so
 * `solve(x^2-4, x)` means the same as `solve(x^2-4=0, x)`.
 *
 * The second argument is a *name*, not a value. Compiling it as a `LOAD_VAR`
 * would demand that the variable already exist, which is exactly what solving
 * for it says it does not. Emitting it as a `PUSH_STRING` instead means the
 * builtin receives a plain String value and the VM needs no change at all.
 *
 * Both sides of the equation are held until that name has been read, so each
 * evaluates with the unknown bound to itself rather than to whatever value the
 * document may already have given it. See {@link emitBoundExpression}: with
 * `:x = 5` above it, `solve(x^2-4=0, x)` was solving `21 = 0` and reporting,
 * accurately for the question it was asked and uselessly for the one written,
 * that there is no solution.
 */
export class SolveParselet implements PrefixParselet {
	readonly category = "Symbolic";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		const left = parseBoundExpression(parser, builder, "solve");
		const right = parser.match("EQUALS") ? parseBoundExpression(parser, builder, "solve") : null;

		parser.consume("COMMA");
		// Requiring IDENT or UNIT here is the same protection VariableParselet
		// relies on: a reserved word always lexes as its own token type, so it
		// can never reach this position and be mistaken for a variable name.
		const variable = parser.peek();
		if (!variable || (variable.type !== "IDENT" && variable.type !== "UNIT")) {
			throw ErrorFactory.parsing(
				"SOLVE_REQUIRES_VARIABLE_NAME",
				`solve's second argument must be the name of the unknown to solve for, as in solve(x^2-4=0, x).`,
				{ found: variable?.type ?? "end of input" },
			);
		}
		parser.consume();

		emitBoundExpression(builder, left, variable.value);
		if (right) {
			emitBoundExpression(builder, right, variable.value);
		} else {
			// No `=` written, so the equation is "this expression equals zero".
			builder.emitOpcode(OpCode.PUSH_NUMBER);
			builder.emitNumber(0);
		}
		emitVariableName(builder, variable.value);

		parser.consume("RPAREN");

		builder.emitOpcode(OpCode.CALL_BUILTIN);
		builder.emitIndex(SYMBOLIC_BUILTIN_SOLVE);
		builder.emitIndex(3);
	}
}
