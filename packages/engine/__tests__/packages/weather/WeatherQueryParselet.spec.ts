import { describe, expect, test } from "@jest/globals";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { weatherQueryParselet } from "@solve-js/packages/weather/parselets/WeatherQueryParselet";

/**
 * The weather package files its single plugin function under
 * `solve-weather:weather` (see WeatherPackage.ts). A parselet driven directly
 * in this unit test builds its own {@link BytecodeBuilder} without an engine,
 * so it needs this name->index map for `emitPluginCall` to resolve the weather
 * function the way the engine's own map does at registration. Both paths
 * resolve to the same index through `pluginFunctionIndexFor`, so the bytecode a
 * parselet emits here agrees with the engine's.
 */
const WEATHER_FN_NAME = "weather";
const WEATHER_FN_IDX = pluginFunctionIndexFor("solve-weather:weather");
const WEATHER_INDEX_MAP = new Map<string, number>([[WEATHER_FN_NAME, WEATHER_FN_IDX]]);

function ident(value: string): LexerToken {
	return new LexerToken("IDENT", tokenTypeId("IDENT"), value, value, 0, 0, 1, 1);
}

/** Queue-based mock parser matching the style of __tests__/examples/osrs/OsrsPackage.spec.ts. */
function mockParser(tokens: LexerToken[]) {
	const queue = [...tokens];
	return {
		peek: () => (queue.length > 0 ? queue[0] : undefined),
		consume: () => queue.shift()!,
	} as any;
}

describe("weatherQueryParselet", () => {
	test("compiles a single-word city into PUSH_STRING(kind:city) + CALL_PLUGIN", () => {
		const parselet = weatherQueryParselet("current", WEATHER_FN_NAME);
		const builder = new BytecodeBuilder(WEATHER_INDEX_MAP);
		const triggerToken = new LexerToken("WEATHER_IN", tokenTypeId("WEATHER_IN"), "weather in", "weather in", 0, 0, 1, 1);

		parselet.parse(mockParser([ident("London")]), triggerToken, builder);

		const program = builder.build();
		const opcodes = Array.from(program.opcodes);
		expect(opcodes[0]).toBe(OpCode.PUSH_STRING);
		expect(opcodes[2]).toBe(OpCode.CALL_PLUGIN);
		expect(opcodes[3]).toBe(WEATHER_FN_IDX);
		expect(opcodes[4]).toBe(1);
		expect(program.strings[0]).toBe("current:London");
	});

	test("joins multi-word city names with a single space", () => {
		const parselet = weatherQueryParselet("temperature", WEATHER_FN_NAME);
		const builder = new BytecodeBuilder(WEATHER_INDEX_MAP);
		const triggerToken = new LexerToken("TEMPERATURE_IN", tokenTypeId("TEMPERATURE_IN"), "temperature in", "temperature in", 0, 0, 1, 1);

		parselet.parse(mockParser([ident("New"), ident("York")]), triggerToken, builder);

		const program = builder.build();
		expect(program.strings[0]).toBe("temperature:New York");
	});

	test("encodes the query kind for feelslike/high/low", () => {
		for (const kind of ["feelslike", "high", "low"] as const) {
			const parselet = weatherQueryParselet(kind, WEATHER_FN_NAME);
			const builder = new BytecodeBuilder(WEATHER_INDEX_MAP);
			const triggerToken = new LexerToken("X", tokenTypeId("X"), "x", "x", 0, 0, 1, 1);
			parselet.parse(mockParser([ident("Tokyo")]), triggerToken, builder);
			const program = builder.build();
			expect(program.strings[0]).toBe(`${kind}:Tokyo`);
		}
	});

	test("throws a clear parse error when no city name follows (was: could silently query an empty string)", () => {
		const parselet = weatherQueryParselet("current", WEATHER_FN_NAME);
		const builder = new BytecodeBuilder(WEATHER_INDEX_MAP);
		const triggerToken = new LexerToken("WEATHER_IN", tokenTypeId("WEATHER_IN"), "weather in", "weather in", 0, 0, 1, 1);

		expect(() => parselet.parse(mockParser([]), triggerToken, builder)).toThrow(/Expected a city name/);
	});

	test("category is Weather", () => {
		expect(weatherQueryParselet("current", WEATHER_FN_NAME).category).toBe("Weather");
	});
});
