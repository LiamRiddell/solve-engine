import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { numberValue, type Value } from "@solve-js/vm/Value";
import { createEngineContext, defaultEngineContext } from "@solve-js/engine/EngineContext";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { registerTestPluginFunction } from "@tools/testUtils";

/**
 * Two engines in one process must not share package registrations.
 *
 * Before {@link createEngineContext}, every engine read plugin functions from
 * one module-level object, so registering a package on one engine changed what
 * a different engine computed. Nothing tested it, and per-document engines were
 * safe only because registration happened to be idempotent.
 */
describe("engine context isolation", () => {
	/**
	 * Run `PUSH_NUMBER 1, CALL_PLUGIN <index> 1, HALT` on an engine.
	 *
	 * `executeCached` reads `vm.activeSignal`, which the normal evaluation
	 * entry points set for it. Calling it directly means setting it here, or
	 * the plugin branch returns a pending result with no signal to attach.
	 */
	function runPlugin(engine: ExpressionEngine, index: number): number {
		engine.getVM().activeSignal = new AbortController().signal;
		return engine.executeCached(callPlugin(index)).toNumber();
	}

	/** `PUSH_NUMBER 1, CALL_PLUGIN <index> 1, HALT`. */
	function callPlugin(index: number) {
		const builder = new BytecodeBuilder();
		builder.reset();
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(1);
		builder.emitOpcode(OpCode.CALL_PLUGIN);
		builder.emitIndex(index);
		builder.emitIndex(1);
		builder.emitOpcode(OpCode.HALT);
		return builder.build();
	}

	test("two engines registering the same index do not see each other's handler", () => {
		const a = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const b = new ExpressionEngine({ packages: BUILTIN_PACKAGES });

		// Deliberately the same index, written straight into each engine's own
		// context. Under a shared registry the second write overwrote the first,
		// and both engines then returned 20.
		registerTestPluginFunction(a, 240, (): Value => numberValue(10));
		registerTestPluginFunction(b, 240, (): Value => numberValue(20));

		expect(runPlugin(a, 240)).toBe(10);
		expect(runPlugin(b, 240)).toBe(20);

		a.clear();
		b.clear();
	});

	test("unregistering on one engine leaves the other working", () => {
		const a = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const b = new ExpressionEngine({ packages: BUILTIN_PACKAGES });

		const disposeA = registerTestPluginFunction(a, 241, (): Value => numberValue(7));
		registerTestPluginFunction(b, 241, (): Value => numberValue(9));

		// Remove the handler on `a` only. What this proves is unchanged:
		// tearing down one engine's registration must not disturb the other's.
		disposeA();

		// A missing handler pushes 0 rather than throwing, so this distinguishes
		// "unregistered on a only" from "unregistered on both".
		expect(runPlugin(a, 241)).toBe(0);
		expect(runPlugin(b, 241)).toBe(9);

		a.clear();
		b.clear();
	});

	test("registering on an engine does not write into the shared default context", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		registerTestPluginFunction(engine, 242, (): Value => numberValue(5));

		// The deprecated module-level `pluginFunctionRegistry` is this object.
		// An engine writing through it would defeat the whole arrangement.
		expect(defaultEngineContext.pluginFunctions[242]).toBeUndefined();

		engine.clear();
	});

	test("a fresh context starts empty and is not shared", () => {
		const one = createEngineContext();
		const two = createEngineContext();

		one.pluginFunctions[243] = (): Value => numberValue(1);

		expect(two.pluginFunctions[243]).toBeUndefined();
		expect(defaultEngineContext.pluginFunctions[243]).toBeUndefined();
	});
});
