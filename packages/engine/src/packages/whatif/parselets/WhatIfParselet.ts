import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { WHAT_IF_FN_NAME } from "../WhatIfPluginFunctions";

/**
 * The most inputs one what-if may override. Each is two arguments to the
 * plugin call, whose argument count is one bytecode byte, and a line that
 * changes more inputs than this is better written as a scenario of its own.
 */
export const WHAT_IF_MAX_OVERRIDES = 16;

/**
 * `line N with <name> = <value> [and <name> = <value> ...]`, a what-if.
 *
 * Reads as "what line N would say if <name> were <value>". The words `line N
 * with` are already one `WHAT_IF` token carrying N (see
 * `whatIfNormalizerRule`); this reads the overrides that follow.
 *
 * Each value is an ordinary expression, so `$120`, `5%`, `2 * 75000` and a
 * reference to another variable all work, and a unit on it is kept. It is
 * parsed at `Conjunction`, the level the word `and` itself binds at, so the
 * `and` that joins two overrides ends the first value rather than being read
 * as the addition it also is (the same reason a phrase list does). A comma
 * joins two overrides the same way.
 *
 * Emits the target line, then each override as its name (a String, since it is
 * a name to bind rather than a value to read) and its value, for the what-if
 * plugin function.
 */
export class WhatIfParselet implements PrefixParselet {
	readonly category = "WhatIf";

	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const targetLine = parseInt(token.value, 10);
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(targetLine);

		const names = new Set<string>();
		for (;;) {
			const nameToken = parser.peek();
			if (!nameToken || (nameToken.type !== "IDENT" && nameToken.type !== "UNIT")) {
				throw ErrorFactory.parsing(
					"WHAT_IF_REQUIRES_VARIABLE_NAME",
					`A what-if names the input to change, as in "line ${targetLine} with deposit = 150000".`,
					{ found: nameToken?.type ?? "end of input" },
				);
			}
			parser.consume();
			const name = nameToken.value;
			if (names.has(name)) {
				throw ErrorFactory.parsing(
					"WHAT_IF_DUPLICATE_INPUT",
					`This what-if sets ${name} twice. Give each input once.`,
					{ name },
				);
			}
			names.add(name);
			if (names.size > WHAT_IF_MAX_OVERRIDES) {
				throw ErrorFactory.parsing(
					"WHAT_IF_TOO_MANY_INPUTS",
					`A what-if can change at most ${WHAT_IF_MAX_OVERRIDES} inputs at once.`,
					{ limit: WHAT_IF_MAX_OVERRIDES },
				);
			}
			parser.consume("EQUALS");

			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(name);
			parser.parseExpression(BindingPower.Conjunction, builder);

			// Another override follows only when the joining word is followed by
			// a name and an `=`; anything else is left for the ordinary grammar,
			// which reports trailing input the way it does for any expression.
			const joiner = parser.peek();
			const nextName = parser.peekAt(1);
			const isJoined =
				!!joiner &&
				(joiner.type === "AND_CONJ" || joiner.type === "COMMA") &&
				!!nextName &&
				(nextName.type === "IDENT" || nextName.type === "UNIT") &&
				parser.peekAt(2)?.type === "EQUALS";
			if (!isJoined) break;
			parser.consume();
		}

		builder.emitPluginCall(WHAT_IF_FN_NAME, 1 + names.size * 2);
	}
}
