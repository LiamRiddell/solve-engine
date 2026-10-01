import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { knownTokenTypeId, tokenTypeId, tokenTypeName, type Token } from "@solve-js/lexer/Token";
import { PhraseTrie } from "@solve-js/normalizer/PhraseTrie";
import type { PrefixParselet, InfixParselet } from "@solve-js/parser/Parselet";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { NUMERALS_PACKAGE } from "@solve-js/packages/numerals/NumeralsPackage";
import { appendExact, exactLength } from "@solve-js/utilities/ExactArrays";
import { AsConverterRegistry, type AsConverter } from "@solve-js/vm/AsConverterRegistry";
import { stringValue, ValueType, type Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectHonestDocument, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * What a fresh engine keeps for its whole life.
 *
 * The 50-line document case of the allocation benchmark read 807,440 bytes on
 * CI against a 786,432 budget once the ISO 8601 duration parselets (#760) took
 * the built-in prefix parselets past 256, the size at which a `Map` doubles its
 * table. Three maps keyed by prefix token type doubled at once. A heap
 * snapshot of ten retained engines put the rest of each engine's cost in state
 * it never reads again or holds twice:
 *
 * - the package-compatibility index, about 47KB, read only when a package is
 *   registered, now released after construction and rebuilt on demand;
 * - a string-keyed copy of each parselet map beside the integer-keyed one the
 *   parser reads, about 18KB, now gone (names translate through the token
 *   table);
 * - an empty children `Map` on every leaf of the phrase trie, now built only
 *   when a phrase continues past the node;
 * - the room a `push` or a spread reserves on lists that are filled once and
 *   then only read (each converter's spellings, each package's contribution
 *   record), now held at their exact length.
 *
 * None of this changes an answer, so most of this file proves the parts keep
 * their behaviour, and that two engines built side by side stay independent
 * (the shape of `Issue710_perEngineRegistries.spec.ts`).
 */

/** A line's answer without `= `, or its error code. */
function answer(engine: ExpressionEngine, line: string): string {
	const value = engine.evaluateExpression(line);
	if (value.type === ValueType.Error) return String(value.errorCode);
	return formatValue(value).replace(/^=\s*/, "");
}

/** A one-converter test package, `5 as shout` answering `5!`. */
function shoutPackage(mark = "!", name = `shout${mark}`): IEnginePackage {
	return { name, asConverters: { shout: (v: Value) => stringValue(`${v.toNumber()}${mark}`) } };
}

/** The engine's compatibility index, read for the one structural check that needs it. */
function compatIndexOf(engine: ExpressionEngine): unknown {
	return (engine as unknown as { compatIndex: unknown }).compatIndex;
}

/** Every console.warn and console.error line written while `body` runs. */
function logsDuring(body: () => void): string[] {
	const lines: string[] = [];
	const warn = jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { lines.push(`warn ${args.join(" ")}`); });
	const error = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => { lines.push(`error ${args.join(" ")}`); });
	try {
		body();
	} finally {
		warn.mockRestore();
		error.mockRestore();
	}
	return lines;
}

/** A built-in phrase and the token type it fuses to, taken from the package set so the test follows it. */
function aBuiltinPhrase(): { phrase: string; tokenType: string } {
	for (const pkg of BUILTIN_PACKAGES) {
		const entries = Object.entries(pkg.phrases ?? {});
		if (entries.length > 0) return { phrase: entries[0][0], tokenType: entries[0][1] };
	}
	throw new Error("no built-in package declares a phrase");
}

/** A package that collides with the built-ins on a phrase and on the `roman` converter. */
function collidingPackage(name = "colliding"): IEnginePackage {
	const { phrase, tokenType } = aBuiltinPhrase();
	return {
		name,
		phrases: { [phrase]: `${tokenType}_ELSEWHERE` },
		asConverters: { roman: () => stringValue("not roman") },
	};
}

afterEach(() => {
	jest.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
// The parts: ExactArrays
// ══════════════════════════════════════════════════════════════════════

describe("exactLength", () => {
	test("an empty list comes back as itself", () => {
		const empty: number[] = [];
		expect(exactLength(empty)).toBe(empty);
	});

	test("a filled list comes back as an equal copy, and the input is unchanged", () => {
		const items = [3, 1, 2];
		const out = exactLength(items);
		expect(out).toEqual([3, 1, 2]);
		expect(out).not.toBe(items);
		expect(items).toEqual([3, 1, 2]);
	});

	test("appending to the input afterwards does not reach the result", () => {
		const items: string[] = [];
		items.push("a");
		const out = exactLength(items);
		items.push("b");
		expect(out).toEqual(["a"]);
	});

	test("edge values survive as themselves: negative zero, NaN, undefined", () => {
		const out = exactLength([-0, Number.NaN, undefined]);
		expect(Object.is(out[0], -0)).toBe(true);
		expect(Number.isNaN(out[1])).toBe(true);
		expect(out.length).toBe(3);
		expect(2 in out).toBe(true);
	});

	test("prototype words are elements like any other, and Object.prototype is unchanged", () => {
		expectPrototypeUntouched(() => {
			expect(exactLength([...PROTOTYPE_WORDS])).toEqual([...PROTOTYPE_WORDS]);
		});
	});

	test("a hundred thousand elements copy in order", () => {
		const big = Array.from({ length: 100_000 }, (_, i) => i);
		const out = exactLength(big);
		expect(out.length).toBe(100_000);
		expect(out[99_999]).toBe(99_999);
	});
});

describe("appendExact", () => {
	test("appends to an empty list", () => {
		expect(appendExact([], "mW")).toEqual(["mW"]);
	});

	test("appends to a filled list without changing it", () => {
		const items = Object.freeze(["mW"]);
		const out = appendExact(items, "MW");
		expect(out).toEqual(["mW", "MW"]);
		expect(items).toEqual(["mW"]);
	});

	test("every slot of the result is filled, so it reads like a literal", () => {
		const out = appendExact([1, 2], 3);
		expect(Object.keys(out)).toEqual(["0", "1", "2"]);
		expect(out.length).toBe(3);
	});

	test("edge values and prototype words are elements like any other", () => {
		expectPrototypeUntouched(() => {
			const out = appendExact<unknown>([-0, Number.NaN], "__proto__");
			expect(Object.is(out[0], -0)).toBe(true);
			expect(Number.isNaN(out[1] as number)).toBe(true);
			expect(out[2]).toBe("__proto__");
			expect(Object.getPrototypeOf(out)).toBe(Array.prototype);
		});
	});

	test("chained appends build the list one element at a time", () => {
		let list: readonly number[] = [];
		for (let i = 0; i < 1000; i++) list = appendExact(list, i);
		expect(list.length).toBe(1000);
		expect(list[0]).toBe(0);
		expect(list[999]).toBe(999);
	});
});

// ══════════════════════════════════════════════════════════════════════
// The parts: knownTokenTypeId
// ══════════════════════════════════════════════════════════════════════

describe("knownTokenTypeId", () => {
	test("a registered name answers its ID, the same one tokenTypeId gives", () => {
		expect(knownTokenTypeId("NUMBER")).toBe(tokenTypeId("NUMBER"));
	});

	test("an unregistered name answers undefined and stays unregistered", () => {
		const name = "FOOTPRINT_NEVER_REGISTERED_TOKEN";
		expect(knownTokenTypeId(name)).toBeUndefined();
		expect(knownTokenTypeId(name)).toBeUndefined();
	});

	test("the empty string and whitespace are names like any other", () => {
		expect(knownTokenTypeId("")).toBeUndefined();
		expect(knownTokenTypeId("   ")).toBeUndefined();
	});

	test.each(PROTOTYPE_WORDS)("%s is not a registered token type merely by being inherited", (word) => {
		expectPrototypeUntouched(() => {
			expect(knownTokenTypeId(word)).toBeUndefined();
		});
	});

	test("look-alike text is not the token type it resembles", () => {
		expect(knownTokenTypeId("NUM​BER")).toBeUndefined();
		expect(knownTokenTypeId("number")).toBeUndefined();
	});
});

// ══════════════════════════════════════════════════════════════════════
// The parts: ParseletRegistry with one map per kind
// ══════════════════════════════════════════════════════════════════════

/** A distinct prefix parselet that is never parsed with. */
function prefix(category = "test"): PrefixParselet {
	return { category, parse: () => { throw new Error("not parsed in this spec"); } } as unknown as PrefixParselet;
}

/** A distinct infix parselet that is never parsed with. */
function infix(bindingPower: number, rightAssociative = false): InfixParselet {
	return { category: "test", bindingPower, rightAssociative, parse: () => { throw new Error("not parsed in this spec"); } } as unknown as InfixParselet;
}

describe("ParseletRegistry: one integer-keyed map per kind", () => {
	test("a parselet registered by name is found by name and by ID alike", () => {
		const registry = new ParseletRegistry();
		const p = prefix();
		registry.registerPrefix("FOOTPRINT_P1", p);
		expect(registry.getPrefix("FOOTPRINT_P1")).toBe(p);
		expect(registry.getPrefix(tokenTypeId("FOOTPRINT_P1"))).toBe(p);
		expect(registry.hasPrefix("FOOTPRINT_P1")).toBe(true);
	});

	test("infix parselets answer the same way, and getAllInfix reports their names", () => {
		const registry = new ParseletRegistry();
		const i = infix(40, true);
		registry.registerInfix("FOOTPRINT_I1", i);
		expect(registry.getInfix("FOOTPRINT_I1")).toBe(i);
		expect(registry.getInfix(tokenTypeId("FOOTPRINT_I1"))).toBe(i);
		expect(registry.hasInfix("FOOTPRINT_I1")).toBe(true);
		expect(registry.getAllInfix()).toEqual([
			{ tokenType: "FOOTPRINT_I1", leftBindingPower: 40, rightBindingPower: 39, associativity: "right", category: "test" },
		]);
	});

	test("getAllPrefix names every parselet, in registration order", () => {
		const registry = new ParseletRegistry();
		registry.registerPrefix("FOOTPRINT_ORDER_B", prefix("b"));
		registry.registerPrefix("FOOTPRINT_ORDER_A", prefix("a"));
		expect(registry.getAllPrefix().map((e) => e.tokenType)).toEqual(["FOOTPRINT_ORDER_B", "FOOTPRINT_ORDER_A"]);
		expect(registry.prefixCount).toBe(2);
	});

	test("asking about a name nothing registered answers nothing and registers no token type", () => {
		const registry = new ParseletRegistry();
		const name = "FOOTPRINT_ASKED_NEVER_DECLARED";
		expect(registry.getPrefix(name)).toBeUndefined();
		expect(registry.hasPrefix(name)).toBe(false);
		expect(registry.getInfix(name)).toBeUndefined();
		expect(registry.hasInfix(name)).toBe(false);
		expect(knownTokenTypeId(name)).toBeUndefined();
	});

	test("an ID nothing is registered under answers nothing, including negative and huge IDs", () => {
		const registry = new ParseletRegistry();
		for (const id of [-1, -0, 2 ** 53, Number.MAX_VALUE, Number.NaN]) {
			expect(registry.getPrefix(id)).toBeUndefined();
			expect(registry.getInfix(id)).toBeUndefined();
		}
	});

	test.each(PROTOTYPE_WORDS)("%s finds no parselet unless one was registered under it", (word) => {
		expectPrototypeUntouched(() => {
			const registry = new ParseletRegistry();
			expect(registry.getPrefix(word)).toBeUndefined();
			expect(registry.hasPrefix(word)).toBe(false);
			const p = prefix();
			registry.registerPrefix(word, p);
			expect(registry.getPrefix(word)).toBe(p);
			expect(registry.getAllPrefix().map((e) => e.tokenType)).toEqual([word]);
		});
	});

	test("an overwrite still warns once and the later parselet wins", () => {
		const registry = new ParseletRegistry();
		const first = prefix("first");
		const second = prefix("second");
		registry.registerPrefix("FOOTPRINT_OVERWRITE", first);
		const logs = logsDuring(() => registry.registerPrefix("FOOTPRINT_OVERWRITE", second));
		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain('"FOOTPRINT_OVERWRITE"');
		expect(registry.getPrefix("FOOTPRINT_OVERWRITE")).toBe(second);
		expect(registry.prefixCount).toBe(1);
	});

	test("clear empties both kinds", () => {
		const registry = new ParseletRegistry();
		registry.registerPrefix("FOOTPRINT_CLEAR_P", prefix());
		registry.registerInfix("FOOTPRINT_CLEAR_I", infix(10));
		registry.clear();
		expect(registry.prefixCount).toBe(0);
		expect(registry.infixCount).toBe(0);
		expect(registry.hasPrefix("FOOTPRINT_CLEAR_P")).toBe(false);
	});

	test("two registries built side by side never see each other's parselets", () => {
		const a = new ParseletRegistry();
		const b = new ParseletRegistry();
		a.registerPrefix("FOOTPRINT_SIDE", prefix());
		expect(b.hasPrefix("FOOTPRINT_SIDE")).toBe(false);
		b.registerPrefix("FOOTPRINT_SIDE", prefix());
		expect(a.getPrefix("FOOTPRINT_SIDE")).not.toBe(b.getPrefix("FOOTPRINT_SIDE"));
	});

	test("a built-in engine's registry reports the same parselets by name and by ID", () => {
		const engine = newTrackedEngine();
		const registry = (engine as unknown as { registry: ParseletRegistry }).registry;
		const all = registry.getAllPrefix();
		expect(all.length).toBeGreaterThan(256);
		for (const { tokenType } of all) {
			expect(registry.getPrefix(tokenType)).toBe(registry.getPrefix(tokenTypeId(tokenType)));
			expect(tokenTypeName(tokenTypeId(tokenType))).toBe(tokenType);
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// The parts: PhraseTrie with children built on demand
// ══════════════════════════════════════════════════════════════════════

function tk(type: string, value: string, offset = 0): Token {
	return new LexerToken(type, tokenTypeId(type), value, value, offset, 0, 1, offset + 1);
}

function tokensFrom(words: string): Token[] {
	return words.split(" ").map((w, i) => tk("IDENT", w, i));
}

describe("PhraseTrie: a leaf has no children map until a phrase continues past it", () => {
	test("a phrase that ends where another continues matches both ways", () => {
		const trie = new PhraseTrie();
		trie.addPhrase("power of", "CARET");
		trie.addPhrase("power of ten", "TENFOLD");
		expect(trie.matchAt(tokensFrom("power of ten"), 0)?.ruleName).toBe("power of ten");
		expect(trie.matchAt(tokensFrom("power of two"), 0)?.ruleName).toBe("power of");
	});

	test("a shorter phrase added after a longer one marks an inner node", () => {
		const trie = new PhraseTrie();
		trie.addPhrase("a b c", "ABC");
		trie.addPhrase("a b", "AB");
		expect(trie.matchAt(tokensFrom("a b c"), 0)?.consumed).toBe(3);
		expect(trie.matchAt(tokensFrom("a b x"), 0)?.consumed).toBe(2);
		expect(trie.getAllPhrases()).toEqual({ "a b c": "ABC", "a b": "AB" });
	});

	test("a walk that reaches a leaf stops there, with the leaf's match", () => {
		const trie = new PhraseTrie();
		trie.addPhrase("per cent", "PERCENT");
		const match = trie.matchAt(tokensFrom("per cent more words after"), 0);
		expect(match?.consumed).toBe(2);
		expect(match?.replacement[0].type).toBe("PERCENT");
	});

	test("a single-word phrase is a leaf at the root and matches alone", () => {
		const trie = new PhraseTrie();
		trie.addPhrase("assuming", "ASSUMING");
		expect(trie.matchAt(tokensFrom("assuming x"), 0)?.consumed).toBe(1);
		expect(trie.getAllPhrases()).toEqual({ assuming: "ASSUMING" });
	});

	test("an empty or whitespace-only phrase adds nothing", () => {
		const trie = new PhraseTrie();
		trie.addPhrase("", "X");
		trie.addPhrase("   ", "X");
		expect(trie.size).toBe(0);
		expect(trie.getAllPhrases()).toEqual({});
	});

	test("prototype words are words like any other in a phrase", () => {
		expectPrototypeUntouched(() => {
			const trie = new PhraseTrie();
			for (const word of PROTOTYPE_WORDS) trie.addPhrase(`${word} of`, "PROTO");
			trie.addPhrase("of constructor", "PROTO_TAIL");
			for (const word of PROTOTYPE_WORDS) {
				expect(trie.matchAt(tokensFrom(`${word} of`), 0)?.ruleName).toBe(`${word} of`);
				expect(trie.matchAt(tokensFrom(`${word} toString`), 0)).toBeNull();
			}
			expect(trie.matchAt(tokensFrom("of constructor"), 0)?.ruleName).toBe("of constructor");
			expect(trie.matchAt(tokensFrom("of __proto__"), 0)).toBeNull();
		});
	});

	test("a phrase two thousand words long is added and matched", () => {
		const trie = new PhraseTrie();
		const words = Array.from({ length: 2000 }, (_, i) => `w${i}`).join(" ");
		trie.addPhrase(words, "LONG");
		expect(trie.matchAt(tokensFrom(words), 0)?.consumed).toBe(2000);
	});

	test("two tries built side by side stay independent", () => {
		const a = new PhraseTrie();
		const b = new PhraseTrie();
		a.addPhrase("only in a", "A");
		expect(b.matchAt(tokensFrom("only in a"), 0)).toBeNull();
		expect(b.getAllPhrases()).toEqual({});
	});
});

// ══════════════════════════════════════════════════════════════════════
// The parts: AsConverterRegistry spellings held at exact length
// ══════════════════════════════════════════════════════════════════════

describe("AsConverterRegistry keeps its behaviour with exact-length spellings", () => {
	const milli: AsConverter = () => stringValue("milli");
	const mega: AsConverter = () => stringValue("mega");

	test("a case pair keeps both exact spellings and refuses the shared folded one", () => {
		const registry = new AsConverterRegistry();
		registry.register("mW", milli);
		registry.register("MW", mega);
		expect(registry.match("mW")).toBe("exact");
		expect(registry.match("MW")).toBe("exact");
		expect(registry.match("mw")).toBe("ambiguous");
		expect(registry.resolve("MW")).toBe(mega);
	});

	test("re-registering a known spelling changes nothing, and unregistering one of a pair leaves the other", () => {
		const registry = new AsConverterRegistry();
		registry.register("mW", milli);
		registry.register("MW", mega);
		registry.register("MW", mega);
		registry.unregister("mW");
		expect(registry.match("mW")).toBe("prefix");
		expect(registry.match("mw")).toBe("prefix");
		expect(registry.resolve("MW")).toBe(mega);
	});

	test("a lower-case name replaces a case pair rather than joining it", () => {
		const registry = new AsConverterRegistry();
		registry.register("mW", milli);
		registry.register("MW", mega);
		const plain: AsConverter = () => stringValue("plain");
		logsDuring(() => registry.register("mw", plain));
		expect(registry.match("mw")).toBe("exact");
		expect(registry.match("MW")).toBe("prefix");
		expect(registry.resolve("mw")).toBe(plain);
	});

	test.each(PROTOTYPE_WORDS)("%s resolves to nothing it was not given", (word) => {
		expectPrototypeUntouched(() => {
			const registry = new AsConverterRegistry();
			expect(registry.resolve(word)).toBeUndefined();
			registry.register(word, milli);
			expect(registry.resolve(word)).toBe(milli);
		});
	});
});

// ══════════════════════════════════════════════════════════════════════
// The engine: the compatibility index is released after construction
// ══════════════════════════════════════════════════════════════════════

describe("the package-compatibility index after construction", () => {
	test("construction releases it, and a later registration builds it again", () => {
		const engine = newTrackedEngine();
		expect(compatIndexOf(engine)).toBeNull();
		engine.registerPackage(shoutPackage());
		expect(compatIndexOf(engine)).not.toBeNull();
		expect(answer(engine, "5 as shout")).toBe("5!");
	});

	test("a colliding package reports the same conflicts registered later as given at construction", () => {
		const atConstruction = logsDuring(() => {
			newTrackedEngine({ packages: [...BUILTIN_PACKAGES, collidingPackage()] });
		}).filter((l) => l.includes("compatibility"));
		const engine = newTrackedEngine();
		const later = logsDuring(() => engine.registerPackage(collidingPackage())).filter((l) => l.includes("compatibility"));
		expect(atConstruction.length).toBeGreaterThan(0);
		expect(later).toEqual(atConstruction);
	});

	test("after an unregister on a released index, a re-registration still reports its conflicts", () => {
		const engine = newTrackedEngine();
		expect(engine.unregisterPackage(NUMERALS_PACKAGE.name)).toBe(true);
		expect(compatIndexOf(engine)).toBeNull();
		const quiet = logsDuring(() => engine.registerPackage({ name: "roman-elsewhere", asConverters: { roman: () => stringValue("x") } }));
		expect(quiet.filter((l) => l.includes("compatibility"))).toEqual([]);
		const loud = logsDuring(() => engine.registerPackage(NUMERALS_PACKAGE)).filter((l) => l.includes("compatibility"));
		expect(loud.length).toBeGreaterThan(0);
		expect(loud.join("\n")).toContain("roman");
	});

	test("two engines built side by side keep their own index and their own registrations", () => {
		const a = newTrackedEngine();
		const b = newTrackedEngine();
		a.registerPackage(shoutPackage("!", "shout"));
		expect(compatIndexOf(a)).not.toBeNull();
		expect(compatIndexOf(b)).toBeNull();
		expect(answer(a, "5 as shout")).toBe("5!");
		expect(answer(b, "5 as shout")).toBe("UNKNOWN_AS_CONVERTER");
		// b reports no conflict for a converter only a holds.
		const onB = logsDuring(() => b.registerPackage(shoutPackage("?", "shout2"))).filter((l) => l.includes("compatibility"));
		expect(onB).toEqual([]);
		const onA = logsDuring(() => a.registerPackage(shoutPackage("?", "shout2"))).filter((l) => l.includes("compatibility"));
		expect(onA.length).toBeGreaterThan(0);
		expect(answer(a, "5 as shout")).toBe("5?");
		expect(answer(b, "5 as shout")).toBe("5?");
	});

	test("re-registering a built-in package by name on a released index answers as before", () => {
		const engine = newTrackedEngine();
		logsDuring(() => engine.registerPackage(NUMERALS_PACKAGE));
		expect(answer(engine, "1994 as roman")).toBe("MCMXCIV");
	});

	test.each(PROTOTYPE_WORDS)("a package whose names are %s registers after construction without touching Object.prototype", (word) => {
		expectPrototypeUntouched(() => {
			const engine = newTrackedEngine();
			logsDuring(() => engine.registerPackage({
				name: word,
				phrases: { [`${word} footprint`]: "IDENT" },
				asConverters: { [word]: () => stringValue(`as ${word}`) },
				pluginFunctions: { [`${word}Fn`]: () => stringValue("fn") },
			}));
			expect(answer(engine, `5 as ${word}`)).not.toBe("");
			expect(engine.unregisterPackage(word)).toBe(true);
			expectHonestLine(`5 as ${word}`, { engine });
		});
	});
});

// ══════════════════════════════════════════════════════════════════════
// The engine: answers are unchanged, through both document passes
// ══════════════════════════════════════════════════════════════════════

describe("answers a reader sees are unchanged", () => {
	test.each([
		["2 to the power of 10", "1,024"],
		["1994 as roman", "MCMXCIV"],
		["PT1H30M in minutes", "90 minutes"],
		["10% of 200", "20"],
	])("%s answers %s", (line, expected) => {
		expect(answer(newTrackedEngine(), line)).toBe(expected);
	});

	test("a phrase document reads the same through parseDocument and evaluateDocument", () => {
		expectHonestDocument("a = 2 to the power of 3\nb = a times 2\n1994 as roman\nPT2H in minutes");
	});

	test("realistic breakage: a typo in a phrase and an unknown converter are refused honestly", () => {
		expectHonestLine("2 to teh power of 3");
		expectHonestLine("5 as nosuchconverter");
		expectHonestLine("5 as MW");
	});

	test("edge cases: empty, whitespace-only, CRLF and a trailing newline", () => {
		expectHonestDocument("");
		expectHonestDocument("   \n\t");
		expectHonestDocument("1 + 1\r\n2 to the power of 2\n");
	});
});
