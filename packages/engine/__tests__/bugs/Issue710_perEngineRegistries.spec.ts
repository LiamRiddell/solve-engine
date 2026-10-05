import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { QueryClient } from "@tanstack/query-core";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { createEngineContext, defaultEngineContext } from "@solve-js/engine/EngineContext";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { CONDITIONALS_PACKAGE } from "@solve-js/packages/conditionals/ConditionalsPackage";
import { NUMERALS_PACKAGE } from "@solve-js/packages/numerals/NumeralsPackage";
import { createCryptoPackage } from "@solve-js/packages/crypto";
import { isPackageConverter } from "@solve-js/packages/converters/normalizer/ConverterPrepositionNormalizerRule";
import { AsConverterRegistry } from "@solve-js/vm/AsConverterRegistry";
import { registerAsConverter, unregisterAsConverter, resolveAsConverter, pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { TokenCategoryTable, builtinTokenCategory, getTokenCategory, registerTokenCategory, unregisterTokenCategory } from "@solve-js/language/TokenCategoryMap";
import { LanguageService } from "@solve-js/language/LanguageService";
import { TokenNormalizer } from "@solve-js/normalizer/TokenNormalizer";
import { getActiveQueryClient } from "@solve-js/services/DataQueryService";
import { ExpressionEngine as Engine } from "@solve-js/engine/ExpressionEngine";
import { numberValue, stringValue, ValueType, type Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { numberText } from "@solve-js/utilities/Number";

/**
 * Issue #710: four pieces of per-engine state lived in module scope, so two
 * engines in one process saw each other's registrations. A converter one engine
 * registered answered on every engine, unregistering a package from one engine
 * took its token categories from all of them, and the query cache a plugin
 * function read was one slot the engine published and restored around every
 * nested run. The `as` converters (all three of #824's maps, as one
 * `AsConverterRegistry`), the token categories (`TokenCategoryTable`) and the
 * query client now live on each engine's `EngineContext`; the query client
 * reaches a plugin function through its `LineExecutionContext`.
 */

/** A one-converter test package, `5 as shout` answering `5!`. */
function shoutPackage(mark = "!"): IEnginePackage {
	// The number is written as the engine writes one, `∞` for an infinity, so
	// the honesty sweep below reads this package's text as an engine's.
	return { name: `shout${mark}`, asConverters: { shout: (v: Value) => stringValue(`${numberText(v.toNumber())}${mark}`) } };
}

function engineWith(...extra: IEnginePackage[]): ExpressionEngine {
	return newTrackedEngine({ packages: [...BUILTIN_PACKAGES, ...extra], config: { network: { enabled: false } } });
}

/** A line's answer without `= `, or its error code. */
function answer(engine: ExpressionEngine, line: string): string {
	const value = engine.evaluateExpression(line);
	if (value.type === ValueType.Error) return String(value.errorCode);
	return formatValue(value).replace(/^=\s*/, "");
}

/** Let settled promises and the batcher's flush run. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("as converters are per engine", () => {
	test("the issue's run: a registration on one engine is invisible to another, before and after", () => {
		const a = engineWith();
		expect(answer(a, "5 as shout")).toBe("UNKNOWN_AS_CONVERTER");
		const b = engineWith(shoutPackage());
		expect(answer(b, "5 as shout")).toBe("5!");
		expect(answer(a, "5 as shout")).toBe("UNKNOWN_AS_CONVERTER");
		expect(answer(a, "5 in shout")).not.toBe("5!");
	});

	test("an unregister on one engine leaves the other intact", () => {
		const x = engineWith();
		const y = engineWith();
		expect(answer(y, "1994 as roman")).toBe("MCMXCIV");
		expect(x.unregisterPackage(NUMERALS_PACKAGE.name)).toBe(true);
		expect(answer(x, "1994 as roman")).toBe("UNKNOWN_AS_CONVERTER");
		expect(answer(y, "1994 as roman")).toBe("MCMXCIV");
		expect(answer(y, "1994 in roman")).toBe("MCMXCIV");
	});

	test("two engines that register different packages under one converter name each keep their own", () => {
		const bang = engineWith(shoutPackage("!"));
		const query = engineWith(shoutPackage("?"));
		expect(answer(bang, "5 as shout")).toBe("5!");
		expect(answer(query, "5 as shout")).toBe("5?");
		expect(answer(bang, "5 in shout")).toBe("5!");
	});

	test("a what-if pass reads its engine's converter", () => {
		const engine = engineWith(shoutPackage());
		const scenario = engine.whatIf("x = 2\nx as shout", { x: 7 });
		expect(formatValue(scenario.lines[1].result!)).toBe("= 7!");
	});

	test("the deprecated module functions reach a registry no engine reads", () => {
		registerAsConverter("whisper", (v) => stringValue(`${v.toNumber()}...`));
		try {
			expect(resolveAsConverter("whisper")).toBeDefined();
			expect(defaultEngineContext.asConverters.match("whisper")).toBe("exact");
			expect(answer(engineWith(), "5 as whisper")).toBe("UNKNOWN_AS_CONVERTER");
		} finally {
			unregisterAsConverter("whisper");
		}
		expect(resolveAsConverter("whisper")).toBeUndefined();
	});
});

describe("token categories are per engine", () => {
	test("the issue's run: an unregister on P leaves Q's category", () => {
		const p = engineWith();
		const q = engineWith();
		expect(p.getTokenCategory("CHECK")).toBe("keyword");
		expect(q.getTokenCategory("CHECK")).toBe("keyword");
		p.unregisterPackage(CONDITIONALS_PACKAGE.name);
		expect(p.getTokenCategory("CHECK")).toBeUndefined();
		expect(q.getTokenCategory("CHECK")).toBe("keyword");
		expect(answer(q, "check 2 == 2")).toBe("✓");
		expect(new LanguageService(q).getTokenCategory("CHECK")).toBe("keyword");
	});

	test("two packages naming one token type different categories, on two engines, each keep their own", () => {
		const one = engineWith({ name: "one", tokenCategories: { MY_TOKEN: "keyword" } });
		const two = engineWith({ name: "two", tokenCategories: { MY_TOKEN: "unit" } });
		expect(one.getTokenCategory("MY_TOKEN")).toBe("keyword");
		expect(two.getTokenCategory("MY_TOKEN")).toBe("unit");
		expect(engineWith().getTokenCategory("MY_TOKEN")).toBeUndefined();
	});

	test("the lexer's highlight tokens and the language service read the engine's categories", () => {
		const zap: IEnginePackage = { name: "zap", lexerVocabulary: { keywords: { zap: "ZAP_KW" } }, tokenCategories: { ZAP_KW: "keyword" } };
		const engine = engineWith(zap);
		const other = engineWith();
		expect(engine.getLexer().getHighlightTokens("zap 2").find((t) => t.type === "ZAP_KW")?.category).toBe("keyword");
		expect(other.getTokenCategory("ZAP_KW")).toBeUndefined();
		expect(new LanguageService(engine).getTokenCategory("ZAP_KW")).toBe("keyword");
		expect(new LanguageService(other).getTokenCategory("ZAP_KW")).toBeUndefined();
		engine.unregisterPackage("zap");
		expect(engine.getTokenCategory("ZAP_KW")).toBeUndefined();
	});

	test("a language service with no engine reads the built-in table", () => {
		const service = new LanguageService(null);
		expect(service.getTokenCategory("NUMBER")).toBe("number");
		expect(service.getTokenCategory("CHECK")).toBeUndefined();
	});

	test("the deprecated module functions read the built-in table and their own, never an engine's", () => {
		engineWith();
		expect(getTokenCategory("NUMBER")).toBe("number");
		expect(getTokenCategory("CHECK")).toBeUndefined();
		registerTokenCategory("SHIM_TOKEN", "unit");
		try {
			expect(getTokenCategory("SHIM_TOKEN")).toBe("unit");
			expect(engineWith().getTokenCategory("SHIM_TOKEN")).toBeUndefined();
		} finally {
			unregisterTokenCategory("SHIM_TOKEN");
		}
		expect(getTokenCategory("SHIM_TOKEN")).toBeUndefined();
	});
});

/** A prefix parselet for `whichcache()`, calling the plugin function of that name. */
class WhichCacheParselet implements PrefixParselet {
	readonly category = "Function";
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.consume("RPAREN");
		builder.emitPluginCall("whichcache", 0);
	}
}

/** A package whose `whichcache()` answers the index in `clients` of the cache its context names, or -1. */
function whichCache(clients: QueryClient[]): IEnginePackage {
	return {
		name: "which-cache",
		callFusions: { whichcache: "WHICHCACHE_CALL" },
		prefixParselets: { WHICHCACHE_CALL: new WhichCacheParselet() },
		pluginFunctions: { whichcache: (_args, context) => numberValue(context?.queryClient ? clients.indexOf(context.queryClient) : -1) },
	};
}

describe("the query client is per engine and reaches a plugin function through its context", () => {
	test("each engine's plugin function reads its own engine's cache, on every path", () => {
		const clients: QueryClient[] = [];
		const a = engineWith(whichCache(clients));
		const b = engineWith(whichCache(clients));
		clients.push(a.queryClient, b.queryClient);
		expect(answer(a, "whichcache()")).toBe("0");
		expect(answer(b, "whichcache()")).toBe("1");
		expect(answer(a, "whichcache()")).toBe("0");
		expect(a.parseDocument("whichcache()\nprev + 0").lines.map((l) => l.result?.toNumber())).toEqual([0, 0]);
		expect(b.getContext().queryClient).toBe(b.queryClient);
		// A what-if runs on a scratch engine with a cache of its own, never b's
		// or a's, and reads that one.
		const scenario = b.whatIf("x = 1\nwhichcache() + x", { x: 1 });
		expect(scenario.lines[1].result?.toNumber()).toBe(0);
	});

	test("a plugin function on one engine, run while another engine's re-run is in flight, reads its own cache", async () => {
		let releaseA: (quote: { price: number }) => void = () => undefined;
		const a = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, createCryptoPackage({ fetchPrice: () => new Promise((resolve) => { releaseA = resolve; }) })] });
		const b = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, createCryptoPackage({ fetchPrice: async () => ({ price: 99_000 }) })] });
		const reportedA: string[] = [];
		a.getBatcher().onLineResult = (line: number, value: Value) => reportedA.push(`${line}: ${formatValue(value)}`);

		b.evaluateLine(1, 'crypto("BTC")');
		await settle();
		expect(a.evaluateLine(1, 'crypto("BTC")').isPending()).toBe(true);
		// A's fetch is in flight; B's plugin function reads B's cache.
		expect(formatValue(b.evaluateExpression('crypto("BTC")'))).toBe("= $99,000.00");
		releaseA({ price: 60_000 });
		await settle();
		expect(reportedA).toEqual(["1: = $60,000.00"]);
		// And after A's re-run, B still reads its own.
		expect(formatValue(b.evaluateExpression('crypto("BTC")'))).toBe("= $99,000.00");
		// The deprecated slot names whichever engine's plugin function ran last.
		expect(getActiveQueryClient()).toBe(b.queryClient);
	});

	test("a cleared engine leaves the deprecated slot empty rather than naming its cache", () => {
		const clients: QueryClient[] = [];
		const a = engineWith(whichCache(clients));
		answer(a, "whichcache()");
		expect(getActiveQueryClient()).toBe(a.queryClient);
		a.clear();
		expect(getActiveQueryClient()).toBeNull();
	});
});

describe("the plugin-function index table", () => {
	test("an index names a function; the handler behind it is the engine's own", () => {
		const clients: QueryClient[] = [];
		const a = engineWith(whichCache(clients));
		const b = engineWith();
		const index = pluginFunctionIndexFor("which-cache:whichcache");
		expect(typeof a.getContext().pluginFunctions[index]).toBe("function");
		expect(b.getContext().pluginFunctions[index]).toBeUndefined();
		expect(() => b.evaluateExpression("whichcache()")).toThrow(/Undefined function/);
	});
});

// ── Unit tests of the parts ──────────────────────────────────────────────

describe("AsConverterRegistry", () => {
	let warn: ReturnType<typeof jest.spyOn>;
	beforeEach(() => {
		warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
	});
	afterEach(() => {
		warn.mockRestore();
	});
	const upper = (v: Value) => stringValue(`up ${v.toNumber()}`);
	const lower = (v: Value) => stringValue(`low ${v.toNumber()}`);

	test("ordinary: register, match, resolve, unregister", () => {
		const r = new AsConverterRegistry();
		r.register("roman", upper);
		expect(r.match("roman")).toBe("exact");
		expect(r.match("ROMAN")).toBe("folded");
		expect(r.resolve("Roman")).toBe(upper);
		r.unregister("roman");
		expect(r.match("roman")).toBeUndefined();
		expect(r.resolve("roman")).toBeUndefined();
	});

	test("a case pair keeps both spellings and refuses the folded one by name", () => {
		const r = new AsConverterRegistry();
		r.register("mZq", lower);
		r.register("MZq", upper);
		expect(r.resolve("mZq")).toBe(lower);
		expect(r.resolve("MZq")).toBe(upper);
		expect(r.match("mzq")).toBe("ambiguous");
		expect(r.resolve("mzq")?.(numberValue(1)).errorCode).toBe("AS_CONVERTER_AMBIGUOUS_CASE");
		r.unregister("MZq");
		expect(r.match("mzq")).toBe("folded");
		expect(r.match("MZq")).toBe("prefix");
		expect(r.resolve("MZq")?.(numberValue(1)).errorCode).toBe("AS_CONVERTER_PREFIX_CASE");
	});

	test("boundary: an empty name, unregistering what was never registered, the same handler twice", () => {
		const r = new AsConverterRegistry();
		expect(r.match("")).toBeUndefined();
		r.unregister("nothing");
		r.register("x", upper);
		r.register("x", upper);
		expect(warn).not.toHaveBeenCalled();
		r.register("x", lower);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(r.resolve("x")).toBe(lower);
	});

	test("two registries are independent", () => {
		const one = new AsConverterRegistry();
		const two = new AsConverterRegistry();
		one.register("shout", upper);
		expect(two.match("shout")).toBeUndefined();
		expect(createEngineContext().asConverters).not.toBe(createEngineContext().asConverters);
	});

	test("hostile: prototype words are keys like any other", () => {
		expectPrototypeUntouched(() => {
			const r = new AsConverterRegistry();
			for (const word of PROTOTYPE_WORDS) {
				expect(r.match(word)).toBeUndefined();
				expect(r.resolve(word)).toBeUndefined();
			}
			r.register("__proto__", upper);
			r.register("constructor", lower);
			expect(r.resolve("__proto__")).toBe(upper);
			expect(r.resolve("CONSTRUCTOR")).toBe(lower);
			r.unregister("__proto__");
			expect(r.resolve("__proto__")).toBeUndefined();
		});
	});
});

describe("TokenCategoryTable and builtinTokenCategory", () => {
	test("ordinary: a package category over the built-in table, and removing it", () => {
		const t = new TokenCategoryTable();
		expect(t.get("NUMBER")).toBe("number");
		t.set("NUMBER", "unit");
		expect(t.get("NUMBER")).toBe("unit");
		t.delete("NUMBER");
		expect(t.get("NUMBER")).toBe("number");
		t.set("MINE", "my-thing");
		expect(t.get("MINE")).toBe("my-thing");
	});

	test("boundary: an unknown type, deleting what was never set, an empty type", () => {
		const t = new TokenCategoryTable();
		expect(t.get("NO_SUCH_TYPE")).toBeUndefined();
		t.delete("NO_SUCH_TYPE");
		expect(t.get("")).toBeUndefined();
	});

	test("hostile: a prototype word reaches nothing in either table", () => {
		expectPrototypeUntouched(() => {
			const t = new TokenCategoryTable();
			for (const word of PROTOTYPE_WORDS) {
				expect(builtinTokenCategory(word)).toBeUndefined();
				expect(t.get(word)).toBeUndefined();
			}
			t.set("__proto__", "keyword");
			expect(t.get("__proto__")).toBe("keyword");
		});
	});
});

describe("the normaliser environment", () => {
	test("isPackageConverter reads the environment's converters and nothing else", () => {
		const r = new AsConverterRegistry();
		r.register("roman", (v) => v);
		expect(isPackageConverter("roman", { asConverters: r })).toBe(true);
		expect(isPackageConverter("ROMAN", { asConverters: r })).toBe(true);
		expect(isPackageConverter("roman", {})).toBe(false);
		expect(isPackageConverter("roman")).toBe(false);
		for (const word of PROTOTYPE_WORDS) expect(isPackageConverter(word, { asConverters: r })).toBe(false);
	});

	test("a normaliser no engine owns hands an empty environment; an engine's hands its own", () => {
		expect(new TokenNormalizer().environment).toEqual({});
		const engine = engineWith();
		expect(engine.getNormalizer().environment.asConverters).toBe(engine.getContext().asConverters);
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test("a package registering prototype words as converters and token types changes nothing outside its engine", () => {
		expectPrototypeUntouched(() => {
			const converters: Record<string, (v: Value) => Value> = {};
			const categories: Record<string, "keyword"> = {};
			for (const word of PROTOTYPE_WORDS) {
				converters[word] = (v) => stringValue(`p${v.toNumber()}`);
				categories[word] = "keyword";
			}
			const hostile = engineWith({ name: "hostile", asConverters: converters, tokenCategories: categories });
			const plain = engineWith();
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`5 as ${word}`, { engine: plain });
				expectHonestLine(`5 as ${word}`, { engine: hostile });
				expect(plain.getTokenCategory(word)).toBeUndefined();
			}
		});
	});

	test("fifty engines each with its own converter answer their own", () => {
		const engines = Array.from({ length: 50 }, (_, i) => engineWith(shoutPackage(String(i))));
		engines.forEach((engine, i) => expect(answer(engine, "5 as shout")).toBe(`5${i}`));
	});
});

describe("adversarial: realistic breakage", () => {
	test("re-registering a package on one engine leaves the other's converter", () => {
		const one = engineWith(shoutPackage());
		const two = engineWith(shoutPackage());
		const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			one.registerPackage(shoutPackage());
		} finally {
			warn.mockRestore();
		}
		one.unregisterPackage("shout!");
		expect(answer(one, "5 as shout")).toBe("UNKNOWN_AS_CONVERTER");
		expect(answer(two, "5 as shout")).toBe("5!");
	});

	test("a snapshot restored into a fresh engine answers with that engine's converters", () => {
		const engine = engineWith(shoutPackage());
		engine.parseDocument("x = 5 as shout");
		const restored = Engine.fromJSON(engine.toJSON(), { packages: [...BUILTIN_PACKAGES, shoutPackage("?")] });
		try {
			expect(answer(restored, "6 as shout")).toBe("6?");
		} finally {
			restored.clear();
		}
	});

	test("an unregister on one engine, then the other's document through both passes", async () => {
		const { evaluateDocument } = await import("@solve-js/engine/evaluateDocument");
		const x = engineWith();
		const y = engineWith();
		x.unregisterPackage(NUMERALS_PACKAGE.name);
		const text = "1994 as roman\ncheck 2 == 2";
		const batch = y.parseDocument(text).lines.map((l) => formatValue(l.result!));
		expect(batch).toEqual(["= MCMXCIV", "= ✓"]);
		expect(evaluateDocument(engineWith(), text).lines.map((l) => formatValue(l.result!))).toEqual(batch);
	});
});

describe("adversarial: edge cases", () => {
	test("unregistering twice, and a package declaring no converters", () => {
		const engine = engineWith(shoutPackage());
		expect(engine.unregisterPackage("shout!")).toBe(true);
		expect(engine.unregisterPackage("shout!")).toBe(false);
		expect(answer(engineWith({ name: "empty", asConverters: {} }), "5 as roman")).toBe("V");
	});

	test("a converter over the numeric edges answers or refuses honestly on its own engine only", () => {
		const engine = engineWith(shoutPackage());
		for (const edge of ["0", "-0", "1/0", "2^53 + 1", "1e308"]) {
			expectHonestLine(`(${edge}) as shout`, { engine, allowNaN: true });
			expect(answer(engineWith(), `(${edge}) as shout`)).toBe("UNKNOWN_AS_CONVERTER");
		}
	});
});
