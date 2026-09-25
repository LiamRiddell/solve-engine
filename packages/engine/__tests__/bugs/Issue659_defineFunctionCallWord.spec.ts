import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { defineFunction } from "@solve-js/api/defineFunction";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { checkPackageCompatibility } from "@solve-js/api/PackageCompatibility";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { LanguageService } from "@solve-js/language/LanguageService";
import { BUILTIN_PACKAGES } from "@solve-js/packages";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import type { Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #659: `defineFunction` registered its name as a lexer keyword, and a
 * keyword is the function's token on every line. With `price` defined,
 * `:price = 5`, `price * 2` and a `price:` label stopped parsing. The name is
 * now a call word, fused only where `(` follows and never after `:`, the way
 * the built-in `sha256(` works; it highlights as a function and completes with
 * its signature. A name the engine already reads as something else is refused
 * at registration, since its call could never fire.
 */

const priced = (name = "price"): IEnginePackage =>
	defineFunction({ name, args: [{ name: "x", type: "number" }], returns: "number", call: (x) => x * 1.2 });

function engineWith(...extra: IEnginePackage[]): ExpressionEngine {
	return newTrackedEngine({ packages: [...BUILTIN_PACKAGES, ...extra] });
}

function one(engine: ExpressionEngine, text: string): string {
	try {
		return formatValue(engine.evaluateExpression(text) as Value);
	} catch (error) {
		return `THROWS ${(error as { code?: string }).code}`;
	}
}

function readLines(result: ParsingResult): string[] {
	return result.lines.map((line) => (line.error ? `ERROR: ${line.error}` : line.result ? formatValue(line.result) : ""));
}

const batch = (engine: ExpressionEngine, lines: string[]) => readLines(engine.parseDocument(lines.join("\n"), { inputType: "markdown" }));
const incremental = (engine: ExpressionEngine, lines: string[]) => readLines(evaluateDocument(engine, lines.join("\n"), { inputType: "markdown" }));

let logged: string[];
beforeEach(() => {
	logged = [];
	jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(String(args[0])));
	jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void logged.push(String(args[0])));
});
afterEach(() => jest.restoreAllMocks());

describe("the defined name is a call only where ( follows it", () => {
	test.each([
		["price(100)", "= 120"],
		["PRICE(100)", "= 120"],
		["Price(3)", "= 3.60"],
		[":price = 5", "= 5"],
		["price = 5", "= 5"],
	])("%s", (text, expected) => {
		expect(one(engineWith(priced()), text)).toBe(expected);
	});

	test("the survey's document: a variable, a use and a call in one note", () => {
		const lines = [":price = 5", "price * 2", "price(10)"];
		expect(batch(engineWith(priced()), lines)).toEqual(["= 5", "= 10", "= 12"]);
	});

	test("labels keep working", () => {
		expect(batch(engineWith(priced()), ["price: 3", "price per kg: 3 * 2"])).toEqual(["= 3", "= 6"]);
	});

	test("the incremental pass agrees with the batch pass", () => {
		const lines = [":price = 5", "price * 2", "price(10)", "price: 3", "price(price) + 1"];
		const batched = batch(engineWith(priced()), lines);
		expect(batched).toEqual(["= 5", "= 10", "= 12", "= 3", "= 7"]);
		expect(incremental(engineWith(priced()), lines)).toEqual(batched);
	});

	test("a line that does not call the function reads as it does on an engine without it", () => {
		const lines = ["the price is high", "price", "price per kg", "5 price", "price - 1"];
		const without = newTrackedEngine();
		expect(batch(engineWith(priced()), lines)).toEqual(batch(without, lines));
	});
});

describe("highlighting and completion", () => {
	test("the fused call highlights as a function, the variable as a variable", () => {
		const ls = new LanguageService(engineWith(priced()), { normalizeForHighlighting: true });
		const show = (text: string) => ls.getSemanticTokens(text, 1).map((t) => `${text.slice(t.from, t.to)}:${t.category}`);
		expect(show("price(10)")).toEqual(["price:function", "(:punctuation", "10:number", "):punctuation"]);
		expect(show(":price = 5")).toContain("price:variable");
	});

	test("completion offers the function with its signature", () => {
		const items = new LanguageService(engineWith(priced())).getCompletions("pric", 4);
		expect(items).toContainEqual({ label: "price", category: "function", detail: "price(x: number): number" });
	});
});

describe("adversarial: names that clash", () => {
	test.each([
		["sqrt", "a built-in function"],
		["kg", "a unit"],
		["m", "a unit"],
		["min", "a unit"],
		["in", "the keyword IN"],
		["pi", "the keyword PI"],
	])("%s is refused at registration: its call could never fire", (name, readAs) => {
		const engine = newTrackedEngine();
		let thrown: { code?: string; message?: string } | undefined;
		try {
			engine.registerPackage(priced(name));
		} catch (error) {
			thrown = error as { code?: string; message?: string };
		}
		expect(thrown?.code).toBe("PLUGIN_CALL_FUSION_UNREACHABLE");
		expect(thrown?.message).toContain(`reads "${name}" as ${readAs}`);
	});

	test("a refused name leaves the engine as it was", () => {
		const engine = engineWith(priced("sqrt"));
		expect(logged.some((line) => line.includes("PLUGIN_CALL_FUSION_UNREACHABLE"))).toBe(true);
		expect(one(engine, "sqrt(16)")).toBe("= 4");
		expect(one(engine, "5 kg")).toBe("= 5.00 kg");
	});

	test("another package's call word: the later registration is in force, and removing it hands the word back", () => {
		const engine = engineWith(priced("md5"));
		expect(logged.some((line) => line.includes("(callFusionName)") && line.includes('"md5("'))).toBe(true);
		expect(one(engine, "md5(10)")).toBe("= 12");
		engine.unregisterPackage("solve-fn-md5");
		expect(one(engine, 'md5("a")')).toBe("= 0cc175b9c0f1b6a831c399e269772661");
	});

	test("the compatibility check reports the shared call word", () => {
		const report = checkPackageCompatibility(priced("md5"), BUILTIN_PACKAGES);
		expect(report.conflicts.map((c) => c.kind)).toContain("callFusionName");
		expect(report.compatible).toBe(true);
	});

	test.each(["sum", "average", "count"])("a function named %s leaves the tag totals alone, while defined and after removal", (name) => {
		const engine = engineWith(priced(name));
		const doc = ["10 #a", "20 #a", `${name === "sum" ? "total" : name} of #a`];
		const expected = { sum: "= 30", average: "= 15", count: "= 2" }[name];
		expect(batch(engine, doc)[2]).toBe(expected);
		expect(one(engine, `${name}(10)`)).toBe("= 12");
		engine.unregisterPackage(`solve-fn-${name}`);
		expect(batch(engine, doc)[2]).toBe(expected);
	});

	test("two packages naming the same plugin function: removing one hands the name back to the other", () => {
		const call = (value: number) => (): Value => ({ toNumber: () => value }) as unknown as Value;
		const first: IEnginePackage = { name: "first", pluginFunctions: { shared: call(1) } };
		const second: IEnginePackage = { name: "second", pluginFunctions: { shared: call(2) } };
		const engine = engineWith(first, second);
		const indexOf = () => (engine as unknown as { pluginFunctionIndexByName: Map<string, number> }).pluginFunctionIndexByName.get("shared");
		const secondIndex = indexOf();
		engine.unregisterPackage("second");
		const firstIndex = indexOf();
		expect(firstIndex).toBeDefined();
		expect(firstIndex).not.toBe(secondIndex);
		engine.unregisterPackage("first");
		expect(indexOf()).toBeUndefined();
	});

	test("unregistering the function frees the word again", () => {
		const engine = engineWith(priced());
		engine.unregisterPackage("solve-fn-price");
		expect(one(engine, "price(10)")).toBe("THROWS UNDEFINED_FUNCTION");
		expect(batch(engine, [":price = 5", "price * 2"])).toEqual(["= 5", "= 10"]);
	});
});
