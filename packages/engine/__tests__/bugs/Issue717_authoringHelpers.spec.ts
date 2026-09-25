import { afterEach, describe, expect, test } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import * as resolvers from "@solve-js/resolvers";
import * as parser from "@solve-js/parser";
import * as vm from "@solve-js/vm";
import { createQueryResolver } from "@solve-js/resolvers/QueryResolver";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { numberValue, ValueType, type Value } from "@solve-js/vm/Value";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";

/**
 * Issue #717: the helpers the package guides tell an author to use were
 * exported from no public subpath, and `createQueryResolver` took only a raw
 * plugin-function index where every other extension point names a function.
 * They are exported now, and the resolver takes the function by name.
 */

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));
const engines: ExpressionEngine[] = [];
afterEach(() => {
	for (const engine of engines.splice(0)) engine.clear();
});

/** A package whose `lookup <word>` line fetches the word's length. */
function lookupPackage(name: string, fetchQuery: (query: string, signal: AbortSignal) => Promise<Value>, extra: Partial<Parameters<typeof createQueryResolver>[0]> = {}): IEnginePackage {
	const { resolver, pluginFunction } = createQueryResolver({ namespace: `${name}-ns`, packageName: name, functionName: "lookup", fetchQuery, ...extra });
	return {
		name,
		lexerVocabulary: { keywords: { [`${name}look`]: `${name.toUpperCase()}_LOOK` } },
		prefixParselets: {
			[`${name.toUpperCase()}_LOOK`]: {
				category: "Probe",
				parse(p, _token, builder) {
					const word = p.consume();
					builder.emitOpcode(OpCode.PUSH_STRING);
					builder.emitString(String(word.value));
					builder.emitPluginCall("lookup", 1);
				},
			},
		},
		pluginFunctions: { lookup: pluginFunction },
		asyncResolvers: [resolver],
		tokenCategories: { [`${name.toUpperCase()}_LOOK`]: "function" },
	};
}

function build(pkg: IEnginePackage): ExpressionEngine {
	const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, pkg], strict: true });
	engine.getBatcher().onLineResult = () => {};
	engines.push(engine);
	return engine;
}

describe("the helpers are exported from their public subpaths", () => {
	test("solve-engine/resolvers, /parser and /vm", () => {
		expect(typeof resolvers.createQueryResolver).toBe("function");
		expect(typeof parser.parseRightOperand).toBe("function");
		expect(typeof parser.definePhrasePattern).toBe("function");
		expect(typeof vm.boolValue).toBe("function");
		expect(typeof vm.percentageValue).toBe("function");
		expect(vm.boolValue(true).type).toBe(ValueType.Boolean);
		expect(formatValue(vm.percentageValue(0.25))).toBe("= 25.00%");
	});
});

describe("createQueryResolver takes the function by name", () => {
	test("a name-keyed live-data package answers with what it fetched", async () => {
		const engine = build(lookupPackage("probea", async (query) => numberValue(query.length)));
		expect(engine.evaluateExpression("probealook hello").type).toBe(ValueType.Pending);
		await later(30);
		expect(formatValue(engine.evaluateExpression("probealook hello"))).toBe("= 5");
	});

	test("the name resolves to the index the engine assigns the package's function", async () => {
		const { resolver } = createQueryResolver({ namespace: "probeb-ns", packageName: "probeb", functionName: "lookup", fetchQuery: async () => numberValue(1) });
		const builder = new BytecodeBuilder();
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString("x");
		builder.emitOpcode(OpCode.CALL_PLUGIN);
		builder.emitByte(pluginFunctionIndexFor("probeb:lookup"));
		builder.emitByte(1);
		builder.emitOpcode(OpCode.HALT);
		const qc = new QueryClient();
		const check = resolver.preflight!([], builder.build(), "_engine", new AbortController().signal, qc);
		expect(check).not.toBeNull();
		expect(resolver.pluginFunction).toEqual({ package: "probeb", name: "lookup" });
		await check!.resolver;
		qc.clear();
	});

	test("the index form the built-in packages use still works", () => {
		expect(() => createQueryResolver({ namespace: "probec-ns", pluginFunctionIndex: 250, fetchQuery: async () => numberValue(1) })).not.toThrow();
	});

	test("both forms, half a name, or neither is refused when the resolver is built", () => {
		const fetchQuery = async () => numberValue(1);
		expect(() => createQueryResolver({ namespace: "d", packageName: "p", functionName: "f", pluginFunctionIndex: 3, fetchQuery })).toThrow(RangeError);
		expect(() => createQueryResolver({ namespace: "d", packageName: "p", fetchQuery })).toThrow(RangeError);
		expect(() => createQueryResolver({ namespace: "d", functionName: "f", fetchQuery })).toThrow(RangeError);
		expect(() => createQueryResolver({ namespace: "d", packageName: "", functionName: "f", fetchQuery })).toThrow(RangeError);
		expect(() => createQueryResolver({ namespace: "d", fetchQuery })).toThrow(RangeError);
		expect(() => createQueryResolver({ namespace: "d", pluginFunctionIndex: -1, fetchQuery })).toThrow(RangeError);
	});
});

describe("registration refuses a resolver whose function would never be called", () => {
	test("a function the package does not declare", () => {
		const { resolver } = createQueryResolver({ namespace: "probee-ns", packageName: "probee", functionName: "missing", fetchQuery: async () => numberValue(1) });
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		engines.push(engine);
		expect(() => engine.registerPackage({ name: "probee", asyncResolvers: [resolver] })).toThrow(expect.objectContaining({ code: "PACKAGE_RESOLVER_FUNCTION_MISSING" }));
		expect(engine.getRegisteredPackages()).not.toContain("probee");
	});

	test("a resolver built for another package's name", () => {
		const pkg = lookupPackage("probef", async () => numberValue(1));
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		engines.push(engine);
		expect(() => engine.registerPackage({ ...pkg, name: "renamed" })).toThrow(/built for the package "probef"/);
	});
});

describe("adversarial fetches", () => {
	test("a fetch that throws synchronously answers with the resolver's error", async () => {
		const engine = build(lookupPackage("probeg", () => { throw new Error("boom"); }));
		engine.evaluateExpression("probeglook x");
		await later(30);
		expect(engine.evaluateExpression("probeglook x").type).toBe(ValueType.Error);
	});

	test("a fetch that resolves to something that is not a Value is a failed fetch, not a figure", async () => {
		const engine = build(lookupPackage("probeh", async () => 42 as unknown as Value));
		engine.evaluateExpression("probehlook x");
		await later(30);
		const value = engine.evaluateExpression("probehlook x");
		expect(value.type).toBe(ValueType.Error);
		expect(String(value.errorMessage)).toMatch(/not a Value|42/);
	});

	test("a fetch that never settles ends at its timeout", async () => {
		const engine = build(lookupPackage("probei", () => new Promise<Value>(() => {}), { timeoutMs: 20 }));
		engine.evaluateExpression("probeilook x");
		await later(80);
		expect(engine.evaluateExpression("probeilook x").type).toBe(ValueType.Error);
	});

	test("two resolvers claiming one namespace: the second replaces the first, with a warning", () => {
		const warnings: string[] = [];
		const warn = console.warn;
		console.warn = (message: string) => warnings.push(message);
		try {
			const a = lookupPackage("probej", async () => numberValue(1));
			const b = lookupPackage("probek", async () => numberValue(2));
			(b.asyncResolvers![0] as { namespace: string }).namespace = "probej-ns";
			const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, a, b] });
			engines.push(engine);
			expect(warnings.some((w) => w.includes('Namespace "probej-ns" already registered'))).toBe(true);
		} finally {
			console.warn = warn;
		}
	});
});
