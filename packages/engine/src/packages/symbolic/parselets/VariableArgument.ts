import { Parser } from "@solve-js/parser/Parser";
import { BytecodeBuilder, type BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Reads a bare variable name argument and returns it, consuming the token.
 *
 * Shared by every algebra verb that takes "which unknown" as an argument.
 * Compiling the name as an ordinary variable read would require it to already
 * have a value, which is precisely what differentiating or solving with respect
 * to it says it does not.
 *
 * Requiring `IDENT` or `UNIT` here gives the same reserved-word protection
 * `VariableParselet` relies on: a keyword always lexes as its own token type,
 * so it can never reach this position and be taken for a variable name.
 *
 * @param parser - The parser, positioned at the name.
 * @param verb - The calling verb's name, for the error message.
 * @returns The name as written.
 * @throws {EngineError} `SYMBOLIC_REQUIRES_VARIABLE_NAME` when the next token is
 * not a bare name.
 */
export function readVariableName(parser: Parser, verb: string): string {
	const token = parser.peek();
	if (!token || (token.type !== "IDENT" && token.type !== "UNIT")) {
		throw ErrorFactory.parsing(
			"SYMBOLIC_REQUIRES_VARIABLE_NAME",
			`${verb} needs the name of an unknown here, as in ${verb}(x^2, x).`,
			{ found: token?.type ?? "end of input" },
		);
	}
	parser.consume();
	return token.value;
}

/** Emits an already-read unknown's name as the String argument the algebra builtins read it as. */
export function emitVariableName(builder: BytecodeBuilder, name: string): void {
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(name);
}

/**
 * Parses an algebra verb's expression argument into its own independent
 * program, rather than emitting it inline.
 *
 * The verb names its unknown AFTER the expression (`der(x^2, x)`), so the
 * expression has to be held rather than emitted: only once the name is known
 * can it be paired with {@link emitBoundExpression}, which is what makes the
 * name shadow any document value it happens to share. Compiled into an
 * isolated builder exactly like a user-defined function body or a map/reduce
 * transform, and `parseExpression` leaves `parser.builder` pointing at the
 * isolated one with no automatic restore, so the caller's builder is put back
 * before returning.
 *
 * @param parser - The parser, positioned at the start of the expression.
 * @param builder - The builder to restore afterwards.
 * @param verb - The calling verb's name, for the error message.
 * @returns The compiled expression, to be handed to {@link emitBoundExpression}.
 */
export function parseBoundExpression(parser: Parser, builder: BytecodeBuilder, verb: string): BytecodeProgram {
	const inner = new BytecodeBuilder(builder.pluginIndexMap);
	parser.parseExpression(BindingPower.Lowest, inner);
	parser.setBuilder(builder);
	const program = inner.build();
	if (program.hasAsync) {
		// Same v1 restriction every other deferred body carries (user-defined
		// functions, map/reduce transforms): a reentrant execution cannot
		// suspend and resume the outer expression around an async result.
		throw ErrorFactory.parsing(
			"SYMBOLIC_ARGUMENT_MUST_BE_SYNCHRONOUS",
			`${verb}'s expression must be synchronous (no weather/stocks/currency calls).`,
		);
	}
	return program;
}

/**
 * Emits a held expression so that it evaluates with `name` bound to itself.
 *
 * This is what makes `der(x^2, x)` mean the derivative of a square rather than
 * the derivative of a constant on a page that also says `:x = 5`. Naming `x` as
 * the verb's argument declares it bound, so within the expression it is an
 * unknown and nothing else, exactly the way a function's parameter shadows a
 * document variable of the same name inside its body. Before this, the
 * expression was compiled inline and its `x` was an ordinary variable read, so
 * the verb received 25 and answered 0 with no indication that it had not been
 * asked the question the user wrote.
 *
 * @param builder - The builder to emit into.
 * @param program - The expression, from {@link parseBoundExpression}.
 * @param name - The unknown the verb named, bound for the expression's evaluation.
 */
export function emitBoundExpression(builder: BytecodeBuilder, program: BytecodeProgram, name: string): void {
	const index = builder.emitAnonymousBody([name], program);
	builder.emitOpcode(OpCode.BIND_UNKNOWN);
	builder.emitIndex(index);
}
