import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { COLOUR_PARSE_FN_IDX } from "../ColourPluginFunctions";

/**
 * A `#hex` colour literal (`#f00`, `#ff0000`, `#ff0000aa`). The core lexer has
 * already validated the shape and emitted a single `HEX_COLOUR` token carrying
 * the literal text, so this just hands that text to the same parse handler
 * `color("#...")` uses: push the string, call the colour-parse plugin. Parsing
 * cannot fail here (the lexer only emits `HEX_COLOUR` for a valid 3/4/6/8-digit
 * form), but routing through the one handler keeps a single source of truth.
 */
export class HexColourParselet implements PrefixParselet {
	readonly category = "Colour";
	parse(_parser: Parser, token: Token, builder: BytecodeBuilder): void {
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(token.value);
		builder.emitOpcode(OpCode.CALL_PLUGIN);
		builder.emitIndex(COLOUR_PARSE_FN_IDX);
		builder.emitIndex(1);
	}
}
