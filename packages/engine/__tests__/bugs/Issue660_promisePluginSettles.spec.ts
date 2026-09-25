import { describe, expect, test } from "@jest/globals";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { PluginFunctionHandler } from "@solve-js/engine/EngineContext";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import { BUILTIN_PACKAGES } from "@solve-js/packages";
import { PluginCallCache } from "@solve-js/vm/PluginCallCache";
import { numberValue, ValueType, type Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #660: a plugin function may return a promise, and the contract says the
 * engine resolves it and re-executes. Nothing kept what the promise settled to,
 * so the re-execution called the handler again and the line stayed pending for
 * good (`slowdouble(21)` was pending after sixteen evaluations and thirty-one
 * handler calls). The VM now records the promise under the call's key and
 * answers the re-run from the settled value.
 */

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Let every settled promise's reactions run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class CallParselet implements PrefixParselet {
	readonly category = "Function";
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		let count = 0;
		if (parser.peek()?.type !== "RPAREN") {
			parser.parseExpression(BindingPower.Lowest, builder);
			count++;
			while (parser.match("COMMA")) {
				parser.parseExpression(BindingPower.Lowest, builder);
				count++;
			}
		}
		parser.consume("RPAREN");
		builder.emitPluginCall("slowdouble", count);
	}
}

/** A package whose `slowdouble(` calls `handler`, counting the calls. */
function slowDouble(handler: PluginFunctionHandler): { pkg: IEnginePackage; calls: () => number } {
	let calls = 0;
	const pkg: IEnginePackage = {
		name: "slow-double",
		callFusions: { slowdouble: "SLOWDOUBLE_CALL" },
		prefixParselets: { SLOWDOUBLE_CALL: new CallParselet() },
		pluginFunctions: {
			slowdouble: (args, context) => {
				calls++;
				return handler(args, context);
			},
		},
	};
	return { pkg, calls: () => calls };
}

function engineWith(pkg: IEnginePackage, options: { networkEnabled?: boolean } = {}): ExpressionEngine {
	return newTrackedEngine({
		packages: [...BUILTIN_PACKAGES, pkg],
		...(options.networkEnabled === false ? { config: { network: { enabled: false } } } : {}),
	});
}

const shown = (value: Value) => (value.type === ValueType.Pending ? "Pending" : formatValue(value));

describe("a promise a plugin function returns is awaited once and answers the re-run", () => {
	test("the documented host loop: pending, lines-updated, the answer", async () => {
		const later = deferred<Value>();
		const { pkg, calls } = slowDouble(() => later.promise);
		const engine = engineWith(pkg);
		const reader = engine.getEventStream().getReader();

		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("Pending");
		later.resolve(numberValue(42));
		const { value: event } = await reader.read();
		expect(event?.type).toBe("lines-updated");
		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("= 42");
		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("= 42");
		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("= 42");
		// The first call, and one more after it settled, which returned another
		// promise and so marked the settled value as the answer.
		expect(calls()).toBe(2);
		reader.releaseLock();
	});

	test("re-evaluating while it waits hands back the same promise, not a new call", async () => {
		const later = deferred<Value>();
		const { pkg, calls } = slowDouble(() => later.promise);
		const engine = engineWith(pkg);
		for (let i = 0; i < 5; i++) expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("Pending");
		expect(calls()).toBe(1);
		later.resolve(numberValue(42));
		await flush();
		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("= 42");
		// One call while it waited, and one probe once it settled.
		expect(calls()).toBe(2);
	});

	test("two lines with the same arguments share one call", async () => {
		const { pkg, calls } = slowDouble((args) => Promise.resolve(numberValue(args[0].toNumber() * 2)));
		const engine = engineWith(pkg);
		const first = engine.parseDocument("slowdouble(4)\nslowdouble(4) + 1", { inputType: "markdown" });
		expect(first.lines.map((line) => line.result?.type)).toEqual([ValueType.Pending, ValueType.Pending]);
		await flush();
		const second = engine.parseDocument("slowdouble(4)\nslowdouble(4) + 1", { inputType: "markdown" });
		expect(second.lines.map((line) => (line.result ? formatValue(line.result) : line.error))).toEqual(["= 8", "= 9"]);
		// The shared call, and one probe after it settled; the second line reads
		// the answer the probe marked.
		expect(calls()).toBe(2);
	});

	test("a rejection settles to an error on the line, and the handler is not called again", async () => {
		const later = deferred<Value>();
		const { pkg, calls } = slowDouble(() => later.promise);
		const engine = engineWith(pkg);
		engine.evaluateExpression("slowdouble(1)");
		later.reject(new Error("the service said no"));
		await flush();
		const value = engine.evaluateExpression("slowdouble(1)");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("PLUGIN_CALL_FAILED");
		expect(formatValue(value)).toContain("the service said no");
		engine.evaluateExpression("slowdouble(1)");
		expect(calls()).toBe(2);
	});

	test("a result that lands after an edit superseded the line still answers the next run", async () => {
		const later = deferred<Value>();
		const { pkg, calls } = slowDouble(() => later.promise);
		const engine = engineWith(pkg);
		engine.evaluateExpression("slowdouble(3)");
		engine.evaluateExpression("1 + 1");
		later.resolve(numberValue(6));
		await flush();
		expect(shown(engine.evaluateExpression("slowdouble(3)"))).toBe("= 6");
		expect(calls()).toBe(2);
	});

	test("a handler that stores what it fetched answers the re-run itself, as the historical rate does", async () => {
		// The other reading of the contract: the promise only says when to look
		// again, and the handler answers the re-run from its own cache.
		const store = new Map<number, Value>();
		const { pkg, calls } = slowDouble((args) => {
			const n = args[0].toNumber();
			const known = store.get(n);
			if (known !== undefined) return numberValue(known.toNumber() * 2);
			return new Promise<Value>((resolve) => {
				store.set(n, numberValue(n));
				resolve(numberValue(-1)); // not the answer, only the signal
			});
		});
		const engine = engineWith(pkg);
		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("Pending");
		await flush();
		const before = calls();
		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("= 42");
		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("= 42");
		// Asked on every run, since it answers itself: the engine never stands in.
		expect(calls() - before).toBe(2);
	});

	test("after the probe, a handler with no cache of its own is not called again", async () => {
		const { pkg, calls } = slowDouble((args) => Promise.resolve(numberValue(args[0].toNumber() * 2)));
		const engine = engineWith(pkg);
		engine.evaluateExpression("slowdouble(5)");
		await flush();
		for (let i = 0; i < 10; i++) expect(shown(engine.evaluateExpression("slowdouble(5)"))).toBe("= 10");
		expect(calls()).toBe(2);
	});
});

describe("adversarial", () => {
	test("a promise that never settles stays pending without calling the handler again", () => {
		const { pkg, calls } = slowDouble(() => new Promise<Value>(() => undefined));
		const engine = engineWith(pkg);
		for (let i = 0; i < 20; i++) expect(shown(engine.evaluateExpression("slowdouble(9)"))).toBe("Pending");
		expect(calls()).toBe(1);
	});

	test("a promise that resolves to something that is not a Value is reported, not shown as a number", async () => {
		const { pkg } = slowDouble(() => Promise.resolve(42 as unknown as Value));
		const engine = engineWith(pkg);
		engine.evaluateExpression("slowdouble(1)");
		await flush();
		const value = engine.evaluateExpression("slowdouble(1)");
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("PLUGIN_RESULT_NOT_A_VALUE");
		expect(formatValue(value)).toContain("the number 42");
	});

	test("arguments that differ only in type or unit are separate calls", async () => {
		const { pkg, calls } = slowDouble((args) => Promise.resolve(numberValue(args.length)));
		const engine = engineWith(pkg);
		for (const text of ["slowdouble(5)", 'slowdouble("5")', "slowdouble(5 m)"]) engine.evaluateExpression(text);
		expect(calls()).toBe(3);
		await flush();
		for (const text of ["slowdouble(5)", 'slowdouble("5")', "slowdouble(5 m)"]) expect(shown(engine.evaluateExpression(text))).toBe("= 1");
		// Three calls, and a probe for each once it settled.
		expect(calls()).toBe(6);
	});

	test("with live data off the promise is not awaited and nothing is recorded", async () => {
		const { pkg, calls } = slowDouble(() => Promise.reject(new Error("never read")));
		const engine = engineWith(pkg, { networkEnabled: false });
		const value = engine.evaluateExpression("slowdouble(2)");
		expect(value.value).toBe("NETWORK_DISABLED");
		await flush();
		expect(engine.evaluateExpression("slowdouble(2)").value).toBe("NETWORK_DISABLED");
		expect(calls()).toBe(2);
		expect((engine as unknown as { context: { pluginCalls: PluginCallCache } }).context.pluginCalls.size).toBe(0);
	});

	test("a synchronous handler records nothing", () => {
		const { pkg, calls } = slowDouble((args) => numberValue(args[0].toNumber() * 2));
		const engine = engineWith(pkg);
		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("= 42");
		expect(shown(engine.evaluateExpression("slowdouble(21)"))).toBe("= 42");
		expect(calls()).toBe(2);
		expect((engine as unknown as { context: { pluginCalls: PluginCallCache } }).context.pluginCalls.size).toBe(0);
	});

	test("unregistering the package forgets its calls", async () => {
		const { pkg } = slowDouble(() => Promise.resolve(numberValue(1)));
		const engine = engineWith(pkg);
		engine.evaluateExpression("slowdouble(1)");
		await flush();
		const cache = (engine as unknown as { context: { pluginCalls: PluginCallCache } }).context.pluginCalls;
		expect(cache.size).toBe(1);
		engine.unregisterPackage("slow-double");
		expect(cache.size).toBe(0);
	});
});

describe("PluginCallCache", () => {
	test("keeps at most its limit, dropping the oldest", () => {
		const cache = new PluginCallCache(2);
		for (const key of ["plugin:1:a", "plugin:1:b", "plugin:1:c"]) cache.track(1, key, new Promise<Value>(() => undefined));
		expect(cache.size).toBe(2);
		expect(cache.lookup("plugin:1:a")).toBeUndefined();
		expect(cache.lookup("plugin:1:c")).toBeDefined();
	});

	test("forget drops only the one function's calls", () => {
		const cache = new PluginCallCache();
		cache.track(1, "plugin:1:a", new Promise<Value>(() => undefined));
		cache.track(12, "plugin:12:a", new Promise<Value>(() => undefined));
		cache.forget(1);
		expect(cache.isAsync(1)).toBe(false);
		expect(cache.lookup("plugin:1:a")).toBeUndefined();
		expect(cache.lookup("plugin:12:a")).toBeDefined();
	});

	test("a settled value is a copy, so a later change to the original cannot reach it", async () => {
		const cache = new PluginCallCache();
		const original = numberValue(5);
		cache.track(1, "plugin:1:a", Promise.resolve(original));
		await flush();
		expect(cache.lookup("plugin:1:a")?.settled).not.toBe(original);
		expect(cache.lookup("plugin:1:a")?.settled?.toNumber()).toBe(5);
	});
});
