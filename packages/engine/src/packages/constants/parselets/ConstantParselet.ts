import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";

/**
 * A named constant (`gravity`, `speed of light`, `tau`): a nullary form that
 * pushes its name and calls the `constantValue` plugin, which returns the value,
 * with its unit where it has one. The name travels as data so a single plugin
 * serves every constant.
 */
export function constantParselet(name: string): PrefixParselet {
	return {
		category: "Constants",
		parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(name);
			builder.emitPluginCall("constantValue", 1);
		},
	};
}
