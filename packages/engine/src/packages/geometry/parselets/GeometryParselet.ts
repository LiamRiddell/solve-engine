import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { SHAPES, DIMENSIONS } from "../GeometryMath";

const SHAPE_SET = new Set(SHAPES);
const DIM_SET = new Set(DIMENSIONS);

/**
 * `<measure> of <shape> <dim> <value> <dim> <value> ...`, e.g. `area of circle
 * radius 5`, `volume of cylinder radius 2 height 5`. The measure trigger (`area
 * of`, `volume of`, ...) is a fused phrase already consumed; what follows is a
 * shape word and then dimension word / value pairs.
 *
 * The shape and dimension words are ordinary identifiers, recognised here by
 * their text rather than claimed as global keywords, so a variable named `width`
 * or `base` still works everywhere else. The whole clause lowers to one
 * `CALL_PLUGIN` carrying the measure, the shape, and each dimension name paired
 * with its value; the plugin looks up the formula and reports a missing or wrong
 * dimension.
 */
export function geometryParselet(measure: string): PrefixParselet {
	return {
		category: "Geometry",
		parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			const shapeToken = parser.peek();
			const shape = (shapeToken?.value ?? "").toLowerCase();
			if (!shapeToken || shapeToken.type !== "IDENT" || !SHAPE_SET.has(shape)) {
				throw ErrorFactory.parsing(
					"GEOMETRY_EXPECTED_SHAPE",
					`Expected a shape (${SHAPES.join(", ")}) after "${measure} of" but got ${shapeToken ? `"${shapeToken.value}"` : "end of input"}`,
				);
			}
			parser.consume();

			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(measure);
			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(shape);
			let argCount = 2;

			// Dimension word / value pairs, in any order, separated by a comma:
			// `width 4, height 6`. The comma matters. Without it, `4 height` is a
			// number directly followed by a word, which the engine reads as an
			// implicit multiplication (`4 * height`) before this parselet ever sees
			// it; the comma breaks that juxtaposition, and it keeps the dimension
			// words as ordinary identifiers rather than reserved keywords.
			for (;;) {
				const dimToken = parser.peek();
				const dim = (dimToken?.value ?? "").toLowerCase();
				if (!dimToken || dimToken.type !== "IDENT" || !DIM_SET.has(dim)) break;
				parser.consume();
				builder.emitOpcode(OpCode.PUSH_STRING);
				builder.emitString(dim);
				argCount++;
				// The value and what is written straight after it, a unit above
				// all: `radius 5 m` is five metres. Read at the tightest binding
				// power, only the `5` belonged to the dimension, and the stranded
				// `m` then labelled the whole answer (78.54 m for an area) or, in
				// front of the comma, stopped the line parsing at all (#638). At
				// Prefix a unit and the other postfix forms bind, and everything
				// looser does not: a trailing `in cm²` is left for the answer, and
				// `^`, `*` and `+` still apply to it as before.
				parser.parseExpression(BindingPower.Prefix, builder);
				argCount++;
				if (parser.peek()?.type === "COMMA") parser.consume(); // pair separator
			}

			builder.emitPluginCall("geometryCompute", argCount);
		},
	};
}
