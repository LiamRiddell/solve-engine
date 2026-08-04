import { Parser } from "@solve-js/parser/Parser";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * Reads a bare variable name argument and emits it as a string constant.
 *
 * Shared by every algebra verb that takes "which unknown" as an argument.
 * Compiling the name as an ordinary variable read would require it to already
 * have a value, which is precisely what differentiating or solving with respect
 * to it says it does not. Pushing the name as a String instead means the
 * builtin receives it directly and the VM needs no special case.
 *
 * Requiring `IDENT` or `UNIT` here gives the same reserved-word protection
 * `VariableParselet` relies on: a keyword always lexes as its own token type,
 * so it can never reach this position and be taken for a variable name.
 *
 * @param parser - The parser, positioned at the name.
 * @param builder - The bytecode builder to emit into.
 * @param verb - The calling verb's name, for the error message.
 * @throws {EngineError} `SYMBOLIC_REQUIRES_VARIABLE_NAME` when the next token is
 * not a bare name.
 */
export function consumeVariableName(parser: Parser, builder: BytecodeBuilder, verb: string): void {
	const token = parser.peek();
	if (!token || (token.type !== "IDENT" && token.type !== "UNIT")) {
		throw ErrorFactory.parsing(
			"SYMBOLIC_REQUIRES_VARIABLE_NAME",
			`${verb} needs the name of an unknown here, as in ${verb}(x^2, x).`,
			{ found: token?.type ?? "end of input" },
		);
	}
	parser.consume();
	builder.emitOpcode(OpCode.PUSH_STRING);
	builder.emitString(token.value);
}
