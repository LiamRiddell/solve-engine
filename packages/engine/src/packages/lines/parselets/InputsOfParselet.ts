import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { TRACE_INPUTS } from "../LinesPluginFunctions";

/**
 * `inputs of line N`, which lines fed line N's answer, followed upwards.
 *
 * The words `inputs of` were fused into an `INPUTS_OF` token by
 * `InputsOfNormalizerRule`, which fires only with a line reference after
 * them, so this parselet reads that reference and hands its number to the
 * lines package's `lineRef` plugin function with a second argument,
 * {@link TRACE_INPUTS}, which routes it to the tracing handler.
 *
 * It shares `lineRef`'s slot rather than taking a plugin function of its own,
 * since it reads the same target through the same line context. (A seeded
 * random draw keys a plugin call by the function's name, so a new function
 * would not have moved any draw either.)
 *
 * The number goes through the constant pool (`PUSH_NUMBER`), not a raw byte,
 * so a document past line 255 traces the same as one before it; see
 * `LineRefParselet`.
 */
export class InputsOfParselet implements PrefixParselet {
	readonly category = "Lines";

	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		const lineRef = parser.peek();
		if (!lineRef || lineRef.type !== "LINE_REF") {
			throw ErrorFactory.parsing(
				"INPUTS_OF_SYNTAX",
				`Tracing reads "inputs of line N", for example "inputs of line 4".`,
				{ found: lineRef?.type ?? "end of input" },
			);
		}
		parser.consume();
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(parseInt(lineRef.value, 10));
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(TRACE_INPUTS);
		builder.emitPluginCall("lineRef", 2);
	}
}
