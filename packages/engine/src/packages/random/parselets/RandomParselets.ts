import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { OpCode } from "@solve-js/parser/OpCode";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * A nullary keyword that produces a value on its own: `uuid`, `coin`. It parses
 * no operand and lowers to a zero-argument plugin call.
 */
export function nullaryRandomParselet(pluginName: string): PrefixParselet {
	return {
		category: "Random",
		parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			builder.emitPluginCall(pluginName, 0);
		},
	};
}

/**
 * A one-operand keyword: `shuffle X`, `random hex N`. The operand is parsed at
 * `Prefix`, so it takes just the next value (`random hex 8` reads the 8, not an
 * expression around it).
 */
export function unaryRandomParselet(pluginName: string): PrefixParselet {
	return {
		category: "Random",
		parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			parser.parseExpression(BindingPower.Prefix, builder);
			builder.emitPluginCall(pluginName, 1);
		},
	};
}

/**
 * `pick(a, b, c)`: the parenthesised, comma-separated options, one returned at
 * random. Triggered on the `PICK_CALL` token the normaliser mints.
 */
export const pickCallParselet: PrefixParselet = {
	category: "Random",
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		let argCount = 0;
		if (parser.peek()?.type !== "RPAREN") {
			parser.parseExpression(BindingPower.Lowest, builder);
			argCount++;
			while (parser.match("COMMA")) {
				parser.parseExpression(BindingPower.Lowest, builder);
				argCount++;
			}
		}
		parser.consume("RPAREN");
		builder.emitPluginCall("randomPick", argCount);
	},
};

/**
 * `random seed <value>`: the line that seeds a document's random draws.
 *
 * The seeding itself happens before the document runs, not here: the engine
 * reads the first `random seed` line of the document at the start of every pass
 * (see engine/SeededRandom.ts), so the seed applies to every line wherever this
 * one sits, and a draw never depends on the order lines happen to run in. This
 * parselet gives the line its own answer, confirming the seed in force, rather
 * than leaving it an error. The rest of the line is the seed, any text at all.
 */
export const randomSeedParselet: PrefixParselet = {
	category: "Random",
	parse(parser: Parser, token: Token, builder: BytecodeBuilder): void {
		const parts: string[] = [];
		for (let next = parser.peek(); next !== undefined && next.type !== "EOF"; next = parser.peek()) {
			parts.push(next.text ?? next.value ?? "");
			parser.consume();
		}
		if (parts.length === 0) {
			throw ErrorFactory.parsing(
				"RANDOM_SEED_EXPECTED_VALUE",
				`"${token.value}" needs a seed after it, any number or word, as in "random seed 42"`,
			);
		}
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(`random draws seeded with ${parts.join(" ")}`);
	},
};
