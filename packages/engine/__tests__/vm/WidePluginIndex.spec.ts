/**
 * More than 256 plugin functions. The plugin-function index is a bytecode
 * operand; it used to be a single byte, capping a process at 256 functions and
 * throwing once exhausted. CALL_PLUGIN_WIDE carries a two-byte index, so a call
 * to a function past index 255 must still dispatch to the exact slot, not wrap
 * (index 300 must not become index 44).
 */
import { describe, expect, test } from "@jest/globals";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { numberValue, type Value } from "@solve-js/vm/Value";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";

describe("emitPluginCall chooses the encoding by index size", () => {
	test("index <= 255 uses the one-byte CALL_PLUGIN", () => {
		const b = new BytecodeBuilder(new Map([["fn", 100]]));
		b.emitPluginCall("fn", 2);
		const program = b.build();
		expect(program.opcodes[0]).toBe(OpCode.CALL_PLUGIN);
		expect(program.opcodes[1]).toBe(100); // index
		expect(program.opcodes[2]).toBe(2); // argCount
	});

	test("index > 255 uses the two-byte CALL_PLUGIN_WIDE, little-endian", () => {
		const b = new BytecodeBuilder(new Map([["fn", 300]]));
		b.emitPluginCall("fn", 2);
		const program = b.build();
		expect(program.opcodes[0]).toBe(OpCode.CALL_PLUGIN_WIDE);
		expect(program.opcodes[1]).toBe(300 & 0xff); // low byte = 44
		expect(program.opcodes[2]).toBe((300 >> 8) & 0xff); // high byte = 1
		expect(program.opcodes[3]).toBe(2); // argCount
		// The bytes decode back to 300, not the wrapped 44.
		expect(program.opcodes[1] | (program.opcodes[2] << 8)).toBe(300);
	});
});

describe("a plugin function past index 255 dispatches correctly end to end", () => {
	// Pad with enough functions to push `widecheck` well beyond 255 regardless
	// of the ~137 the built-ins already allocate in this fresh test process.
	const PAD = 400;
	const MAGIC = 31337;

	class WideCheckParselet implements PrefixParselet {
		readonly category = "Test";
		parse(_parser: Parser, _token: Token, builder: import("@solve-js/parser/BytecodeBuilder").BytecodeBuilder): void {
			builder.emitPluginCall("widecheck", 0);
		}
	}

	function buildWidePackage(): IEnginePackage {
		const pluginFunctions: Record<string, (args: Value[]) => Value> = {};
		for (let i = 0; i < PAD; i++) pluginFunctions[`pad${i}`] = () => numberValue(0);
		// Registered last -> highest index (>= PAD, comfortably past 255).
		pluginFunctions["widecheck"] = () => numberValue(MAGIC);
		return {
			name: "solve-widetest",
			lexerVocabulary: { keywords: { widecheck: "WIDECHECK" } },
			prefixParselets: { WIDECHECK: new WideCheckParselet() },
			pluginFunctions,
		};
	}

	test("calls the right function, not the one at index & 0xFF", () => {
		const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, buildWidePackage()] });
		const result = engine.evaluateExpression("widecheck");
		expect(result.toNumber()).toBe(MAGIC);
	});
});
