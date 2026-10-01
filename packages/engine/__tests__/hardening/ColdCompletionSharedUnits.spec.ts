/**
 * The first completion on a new engine no longer builds the built-in units.
 *
 * The benchmark gate measured the language-service case
 * `completions_cold_first_call` (a new engine and service, then one
 * `getCompletions("sq")`) at up to 2.00 times its merge base. Bisecting the
 * merged batches put the whole step at #771 (merged in b24b3e9), which put
 * every static candidate through a one-per-label check: a lowercase and a key
 * string per candidate, more than 1,300 of them built-in units, on every new
 * engine, beside the call words and phrases it added. Locally the first call
 * went from 0.46 ms to 1.19 ms (medians of interleaved fresh processes).
 *
 * No engine can change the built-in units, so they are now made once per
 * process (`language/builtinUnitCompletions.ts`), a first character's
 * candidates only when a prefix starting with it is first typed, and merged
 * per first character with the engine's own vocabulary, ties going to the
 * engine's, which is where the single list put them. A prefix of two
 * characters or more now reads its first-character bucket narrowed to its
 * first two characters, kept once made, so the warm cases with a longer prefix
 * test a few labels rather than the whole bucket. The results are proven
 * identical here against the whole-list implementation, rebuilt in
 * `tools/completionOracle.ts`.
 */

import { describe, expect, test } from "@jest/globals";
import { LanguageService, type CompletionItem } from "@solve-js/language/LanguageService";
import { groupUnitSpellings, rankedBuiltinUnitBucket } from "@solve-js/language/builtinUnitCompletions";
import { compareCompletionItems, mergeRankedCandidates, type IndexedCompletionCandidate } from "@solve-js/language/completionRanking";
import type { TokenCategory } from "@solve-js/language/TokenCategory";
import { knownUnits } from "@solve-js/lexer/units";
import { PhraseTrie } from "@solve-js/normalizer/PhraseTrie";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { newTrackedEngine } from "@tools/trackedEngine";
import { referenceCompletions } from "@tools/completionOracle";
import { PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";

type Engine = ReturnType<typeof newTrackedEngine>;

/** A service over `engine` reading the engine's own variables, and the oracle's answer beside it. */
function both(engine: Engine, ls: LanguageService, line: string, cursor = line.length): { now: CompletionItem[]; before: CompletionItem[] } {
	return { now: ls.getCompletions(line, cursor), before: referenceCompletions(engine, engine.getDag().keysInUse(), line, cursor) };
}

/** Every one-character prefix a reader can type into the prefix pattern. */
const ONE_CHARACTER = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"];

/** Every two-letter lowercase prefix. */
const TWO_LETTERS = ONE_CHARACTER.slice(0, 26).flatMap((a) => ONE_CHARACTER.slice(0, 26).map((b) => a + b));

/** Specific prefixes: whole words, units, phrases across words, a cursor after a number. */
const SPECIFIC = ["", "sq", "sqrt", "kg", "km", "metre", "usd", "USD", "Mb", "mph", "°", "average o", "net pres", "net  present v", "12 kg to l", "x = s", "zzzznomatch", "sha", "weather i", "workd"];

/** Assert the service and the oracle agree on every line given, cold first and then warm. */
function expectAgreement(engine: Engine, lines: readonly string[]): void {
	const ls = new LanguageService(engine);
	for (const line of lines) {
		const { now, before } = both(engine, ls, line);
		expect({ line, now }).toEqual({ line, now: before });
	}
	// The same lines again, now that every bucket they touch is ranked.
	for (const line of lines) {
		const { now, before } = both(engine, ls, line);
		expect({ line, now }).toEqual({ line, now: before });
	}
}

// ── The results are what they were ──────────────────────────────────────────

describe("completions match the whole-list implementation", () => {
	test("the built-in packages: empty, one-letter, two-letter and specific prefixes", () => {
		expectAgreement(newTrackedEngine(), [...SPECIFIC, ...ONE_CHARACTER, ...TWO_LETTERS]);
	});

	test("no packages registered: the units alone, and the lexer's own keywords", () => {
		const engine = newTrackedEngine({ packages: [] });
		expectAgreement(engine, [...SPECIFIC, ...ONE_CHARACTER]);
		expect(new LanguageService(engine).getCompletions("kg", 2).map((c) => c.label)).toContain("kg");
	});

	test("one package registered, then unregistered", () => {
		const engine = newTrackedEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name === "uom" || p.name === "arithmetic") });
		expectAgreement(engine, [...SPECIFIC, ...ONE_CHARACTER]);
		const late = newTrackedEngine();
		const name = BUILTIN_PACKAGES.find((p) => p.name === "uom")?.name ?? BUILTIN_PACKAGES[0].name;
		expect(late.unregisterPackage(name)).toBe(true);
		expectAgreement(late, [...SPECIFIC, ...ONE_CHARACTER]);
	});

	test("a language pack: German keywords are offered, and an English engine made after it has none", () => {
		const german = newTrackedEngine({ locale: "de" });
		expectAgreement(german, [...SPECIFIC, ...ONE_CHARACTER, "wu", "wurzel", "kubik"]);
		expect(new LanguageService(german).getCompletions("wu", 2).map((c) => c.label)).toContain("wurzel");
		const english = newTrackedEngine();
		expect(new LanguageService(english).getCompletions("wu", 2).map((c) => c.label)).not.toContain("wurzel");
		const french = newTrackedEngine({ locale: "fr" });
		expectAgreement(french, [...SPECIFIC, ...ONE_CHARACTER]);
	});

	test("a package's own unit item wins over the built-in unit with that label, on that engine only", () => {
		const pkg: IEnginePackage = { name: "p-own-kg", completionItems: [{ label: "KG", category: "unit", detail: "the package's own" }] };
		const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, pkg] });
		expectAgreement(engine, ["k", "kg", "K", "KG", "Kg"]);
		const labels = new LanguageService(engine).getCompletions("kg", 2).filter((c) => c.category === "unit").map((c) => `${c.label}:${c.detail}`);
		expect(labels).toContain("KG:the package's own");
		expect(labels.filter((l) => l.toLowerCase().startsWith("kg:"))).toHaveLength(1);
		// Another engine still offers the built-in one.
		const plain = new LanguageService(newTrackedEngine()).getCompletions("kg", 2).map((c) => c.label);
		expect(plain).toContain("kg");
	});

	test("the document's variables and units merge in as before", () => {
		const engine = newTrackedEngine();
		const variables = ["speed", "Sales", "kilo", "s1"];
		engine.parseDocument("1 sprint = 2 weeks\n1 kiloyard = 1000 yards");
		const ls = new LanguageService(engine, { variableNameSource: () => variables });
		for (const line of ["s", "k", "ki", "sp", "net pres"]) {
			expect({ line, now: ls.getCompletions(line, line.length) }).toEqual({ line, now: referenceCompletions(engine, variables, line, line.length) });
		}
	});
});

// ── Sharing and invalidation ────────────────────────────────────────────────

describe("the built-in units are shared, and an engine's own vocabulary is not", () => {
	test("two engines return the very same unit items, frozen", () => {
		const a = new LanguageService(newTrackedEngine()).getCompletions("kg", 2).find((c) => c.label === "kg");
		const b = new LanguageService(newTrackedEngine()).getCompletions("kg", 2).find((c) => c.label === "kg");
		expect(a).toBeDefined();
		expect(a).toBe(b);
		expect(Object.isFrozen(a)).toBe(true);
		expect(a).toEqual({ label: "kg", category: "unit", detail: "mass" });
	});

	test("a package registered after the first call appears once the cache is invalidated, units and all", () => {
		const engine = newTrackedEngine();
		const ls = new LanguageService(engine);
		expect(ls.getCompletions("saf", 3).map((c) => c.label)).not.toContain("saffron");
		expect(ls.getCompletions("k", 1).map((c) => c.detail)).not.toContain("late unit");
		engine.registerPackage({
			name: "p-late",
			completionItems: [
				{ label: "saffron", category: "function" },
				{ label: "kg", category: "unit", detail: "late unit" },
			],
		});
		ls.invalidateCache();
		expect(ls.getCompletions("saf", 3).map((c) => c.label)).toContain("saffron");
		const kg = ls.getCompletions("kg", 2).filter((c) => c.label.toLowerCase() === "kg" && c.category === "unit");
		expect(kg.map((c) => c.detail)).toEqual(["late unit"]);
		for (const line of ["s", "sa", "k", "kg"]) {
			const { now, before } = both(engine, ls, line);
			expect({ line, now }).toEqual({ line, now: before });
		}
		// Unregistering it and invalidating again brings the built-in unit back.
		engine.unregisterPackage("p-late");
		ls.invalidateCache();
		expect(ls.getCompletions("kg", 2).find((c) => c.label === "kg")?.detail).toBe("mass");
		expect(ls.getCompletions("saf", 3).map((c) => c.label)).not.toContain("saffron");
	});

	test("changing a returned item's list changes nothing another engine sees", () => {
		const first = new LanguageService(newTrackedEngine()).getCompletions("k", 1);
		const snapshot = first.map((c) => c.label);
		first.reverse();
		first.length = 2;
		expect(new LanguageService(newTrackedEngine()).getCompletions("k", 1).map((c) => c.label)).toEqual(snapshot);
	});
});

// ── The parts ────────────────────────────────────────────────────────────────

describe("groupUnitSpellings", () => {
	test("ordinary: grouped by lowercased first character, in the order given", () => {
		const groups = groupUnitSpellings(["kg", "m", "km", "Mb", "g"]);
		expect([...groups.entries()]).toEqual([["k", ["kg", "km"]], ["m", ["m", "Mb"]], ["g", ["g"]]]);
	});

	test("boundary: nothing, the empty spelling, and spellings that lowercase alike keep the first", () => {
		expect(groupUnitSpellings([]).size).toBe(0);
		expect(groupUnitSpellings([""]).size).toBe(0);
		expect([...groupUnitSpellings(["MB", "mb", "Mb", "mB"]).entries()]).toEqual([["m", ["MB"]]]);
		// A spelling whose lowercase grows (the dotted capital I) groups by the lowercase's first unit.
		expect([...groupUnitSpellings(["İn"]).keys()]).toEqual(["i"]);
	});

	test("boundary: the built-in units, one per lowercased spelling, none with a space (the phrase scan relies on it)", () => {
		const groups = groupUnitSpellings(knownUnits);
		const kept = [...groups.values()].flat();
		expect(new Set(kept.map((s) => s.toLowerCase())).size).toBe(kept.length);
		expect(kept.some((s) => s.includes(" "))).toBe(false);
		expect(kept.length).toBeGreaterThan(1000);
	});

	test("hostile: prototype words, look-alikes and a very long spelling are grouped as text", () => {
		expectPrototypeUntouched(() => {
			const groups = groupUnitSpellings([...PROTOTYPE_WORDS, "ѕ", "ｓ", "s", "​s", "a".repeat(100_000)]);
			expect(groups.get("_")).toEqual(PROTOTYPE_WORDS.filter((w) => w.startsWith("_")));
			expect(groups.get("ѕ")).toEqual(["ѕ"]);
			expect(groups.get("s")).toEqual(["s"]);
			expect(groups.get("​")).toEqual(["​s"]);
			expect(groups.get("a")?.[0]).toHaveLength(100_000);
		});
	});
});

describe("rankedBuiltinUnitBucket", () => {
	test("ordinary: a first character's units in completion order, with their measure", () => {
		const bucket = rankedBuiltinUnitBucket("k");
		expect(bucket.map((c) => c.item.label)).toContain("kg");
		expect(bucket.find((c) => c.item.label === "kg")?.item).toEqual({ label: "kg", category: "unit", detail: "mass" });
		for (let i = 1; i < bucket.length; i++) expect(compareCompletionItems(bucket[i - 1].item, bucket[i].item)).toBeLessThanOrEqual(0);
		for (const c of bucket) expect(c.lowerLabel).toBe(c.item.label.toLowerCase());
	});

	test("ordinary: made once and shared, the list and its items frozen", () => {
		const bucket = rankedBuiltinUnitBucket("m");
		expect(rankedBuiltinUnitBucket("m")).toBe(bucket);
		expect(Object.isFrozen(bucket)).toBe(true);
		expect(bucket.every((c) => Object.isFrozen(c.item))).toBe(true);
	});

	test("boundary: no unit starts with it, an upper-case or empty argument, more than one character", () => {
		for (const arg of ["", "K", "kg", "!", "9", " "]) expect(rankedBuiltinUnitBucket(arg)).toEqual([]);
		expect(Object.isFrozen(rankedBuiltinUnitBucket("!"))).toBe(true);
	});

	test("hostile: prototype words, look-alikes and a very long argument find nothing and change nothing", () => {
		expectPrototypeUntouched(() => {
			for (const arg of [...PROTOTYPE_WORDS, "ѕ", "ｋ", "​", "‮", "<", RESOURCE_PROBES.longIdentifier(100_000)]) {
				expect(rankedBuiltinUnitBucket(arg)).toEqual([]);
			}
		});
	});
});

describe("LanguageService's narrowed two-character lists", () => {
	type Internals = {
		rankedStaticBucket(c: string): readonly IndexedCompletionCandidate[];
		rankedStaticPair(start: string): readonly IndexedCompletionCandidate[];
		rankedStaticPairs: Map<string, unknown>;
	};
	const internals = (ls: LanguageService): Internals => ls as unknown as Internals;

	test("ordinary: the first character's bucket narrowed to the start, in its order, made once", () => {
		const ls = internals(new LanguageService(newTrackedEngine()));
		const pair = ls.rankedStaticPair("sq");
		expect(pair).toEqual(ls.rankedStaticBucket("s").filter((c) => c.lowerLabel.startsWith("sq")));
		expect(pair.map((c) => c.item.label)).toContain("sqrt");
		expect(ls.rankedStaticPair("sq")).toBe(pair);
	});

	test("boundary: a start nothing has, a digit and an underscore, and the list is cleared by an invalidation", () => {
		const service = new LanguageService(newTrackedEngine());
		const ls = internals(service);
		for (const start of ["zq", "9z", "__", "q_"]) expect(ls.rankedStaticPair(start)).toEqual([]);
		const before = ls.rankedStaticPair("sq");
		service.invalidateCache();
		expect(ls.rankedStaticPairs.size).toBe(0);
		const after = ls.rankedStaticPair("sq");
		expect(after).not.toBe(before);
		expect(after).toEqual(before);
	});

	test("a longer prefix tests only the narrowed labels on a warm call", () => {
		const service = new LanguageService(newTrackedEngine());
		service.getCompletions("sqrt", 4);
		const narrowed = internals(service).rankedStaticPair("sq").length;
		const bucket = internals(service).rankedStaticBucket("s").length;
		expect(narrowed).toBeLessThan(bucket / 4);
		const calls: string[] = [];
		const original = String.prototype.startsWith;
		String.prototype.startsWith = function (this: string, search: string, position?: number): boolean {
			calls.push(search);
			return original.call(this, search, position);
		};
		try {
			service.getCompletions("sqrt", 4);
		} finally {
			String.prototype.startsWith = original;
		}
		expect(calls.filter((s) => s === "sqrt").length).toBeLessThanOrEqual(narrowed);
	});

	test("hostile: every two-character start a reader can type keeps the cache bounded and agrees with the oracle", () => {
		const engine = newTrackedEngine();
		const service = new LanguageService(engine);
		const characters = [..."abcdefghijklmnopqrstuvwxyz0123456789_"];
		expectPrototypeUntouched(() => {
			for (const a of characters) for (const b of characters) service.getCompletions(a + b, 2);
		});
		expect(internals(service).rankedStaticPairs.size).toBeLessThanOrEqual(characters.length ** 2);
		for (const line of ["co", "__", "pr", "to", "constructor", "__proto__"]) {
			const { now, before } = both(engine, service, line);
			expect({ line, now }).toEqual({ line, now: before });
		}
		// A start the prefix pattern cannot produce finds nothing, look-alike included.
		for (const start of ["ѕq", "ｓq", "s​"]) expect(internals(service).rankedStaticPair(start)).toEqual([]);
	});
});

describe("mergeRankedCandidates", () => {
	const candidate = (label: string, category: TokenCategory, detail: string): IndexedCompletionCandidate => ({ item: { label, category, detail }, lowerLabel: label.toLowerCase() });

	/** A small seeded generator, so the property case is the same every run. */
	function seeded(seed: number): () => number {
		let x = seed >>> 0;
		return () => {
			x = (x * 1664525 + 1013904223) >>> 0;
			return x / 2 ** 32;
		};
	}

	test("ordinary: two sorted runs merge into the stable sort of their concatenation", () => {
		const own = [candidate("sqrt", "function", "o1"), candidate("sum of", "keyword", "o2")];
		const units = [candidate("s", "unit", "u1"), candidate("sq_ft", "unit", "u2")];
		expect(mergeRankedCandidates(own, units).map((c) => c.item.detail)).toEqual(["o1", "o2", "u1", "u2"]);
	});

	test("boundary: empty runs, and a tie goes to the first run", () => {
		const a = [candidate("kg", "unit", "first")];
		const b = [candidate("kg", "unit", "second")];
		expect(mergeRankedCandidates([], [])).toEqual([]);
		expect(mergeRankedCandidates(a, [])).toEqual(a);
		expect(mergeRankedCandidates([], b)).toEqual(b);
		expect(mergeRankedCandidates(a, b).map((c) => c.item.detail)).toEqual(["first", "second"]);
		expect(mergeRankedCandidates(b, a).map((c) => c.item.detail)).toEqual(["second", "first"]);
	});

	test("the runs are not changed, and the result is a new array", () => {
		const a = Object.freeze([candidate("a", "unit", "a")]);
		const b = Object.freeze([candidate("b", "unit", "b")]);
		const merged = mergeRankedCandidates(a, b);
		expect(merged).not.toBe(a);
		expect(merged.map((c) => c.item.label)).toEqual(["a", "b"]);
	});

	test("hostile: prototype-word labels and categories merge as text", () => {
		expectPrototypeUntouched(() => {
			const a = PROTOTYPE_WORDS.map((w) => candidate(w, w, "a")).sort((x, y) => compareCompletionItems(x.item, y.item));
			const b = PROTOTYPE_WORDS.map((w) => candidate(w, "unit", "b")).sort((x, y) => compareCompletionItems(x.item, y.item));
			expect(mergeRankedCandidates(a, b)).toEqual([...a, ...b].sort((x, y) => compareCompletionItems(x.item, y.item)));
		});
	});

	test("property: over seeded random runs with many ties, the merge equals the stable sort", () => {
		const random = seeded(844);
		const labels = ["s", "S", "sa", "sq", "sqrt", "s​qrt", "kg", "KG", "sum of", "constructor", "__proto__", ""];
		const categories: TokenCategory[] = ["function", "keyword", "unit", "colour", "toString"];
		for (let trial = 0; trial < 300; trial++) {
			const run = (tag: string): IndexedCompletionCandidate[] =>
				Array.from({ length: Math.floor(random() * 12) }, (_, i) => candidate(labels[Math.floor(random() * labels.length)], categories[Math.floor(random() * categories.length)], `${tag}${i}`)).sort((x, y) => compareCompletionItems(x.item, y.item));
			const a = run("a");
			const b = run("b");
			expect(mergeRankedCandidates(a, b)).toEqual([...a, ...b].sort((x, y) => compareCompletionItems(x.item, y.item)));
		}
	});
});

describe("PhraseTrie.getAllPhrases", () => {
	/** The listing as it was built, a copied array of words per level, kept as an oracle. */
	function oldGetAllPhrases(trie: PhraseTrie): Record<string, string> {
		const root = (trie as unknown as { root: Map<string, { children: Map<string, unknown> | null; terminal: { tokenType: string } | null }> }).root;
		type Node = { children: Map<string, Node> | null; terminal: { tokenType: string } | null };
		const result: Record<string, string> = {};
		const collect = (node: Node, path: string[]): void => {
			if (node.terminal) result[path.join(" ")] = node.terminal.tokenType;
			if (node.children === null) return;
			for (const [word, child] of node.children) collect(child, [...path, word]);
		};
		for (const [first, node] of root as Map<string, Node>) collect(node, [first]);
		return result;
	}

	test("ordinary: overlapping and nested phrases, keyed in the order the trie holds them", () => {
		const trie = new PhraseTrie();
		trie.addPhrase("to the power of", "CARET");
		trie.addPhrase("power of", "CARET");
		trie.addPhrase("to", "TO");
		trie.addPhrase("average of", "AVG");
		const all = trie.getAllPhrases();
		expect(all).toEqual({ "to the power of": "CARET", "power of": "CARET", to: "TO", "average of": "AVG" });
		expect(Object.keys(all)).toEqual(Object.keys(oldGetAllPhrases(trie)));
	});

	test("boundary: an empty trie, and the real engine's phrases, agree with the old listing", () => {
		expect(new PhraseTrie().getAllPhrases()).toEqual({});
		for (const engine of [newTrackedEngine(), newTrackedEngine({ locale: "de" }), newTrackedEngine({ packages: [] })]) {
			const trie = (engine.getNormalizer() as unknown as { phraseTrie: PhraseTrie }).phraseTrie;
			expect(Object.entries(trie.getAllPhrases())).toEqual(Object.entries(oldGetAllPhrases(trie)));
		}
	});

	test("hostile: prototype words and look-alikes as phrase words list as text", () => {
		expectPrototypeUntouched(() => {
			const trie = new PhraseTrie();
			trie.addPhrase("constructor of", "A");
			trie.addPhrase("to string of", "B");
			trie.addPhrase("ѕum of", "C");
			const all = trie.getAllPhrases();
			expect(Object.keys(all)).toEqual(Object.keys(oldGetAllPhrases(trie)));
			expect(all["constructor of"]).toBe("A");
			expect(all["ѕum of"]).toBe("C");
		});
	});
});

// ── Adversarial ─────────────────────────────────────────────────────────────

describe("adversarial prefixes", () => {
	test("security: prototype words, look-alikes and markup-shaped text agree with the oracle", () => {
		const engine = newTrackedEngine();
		expectPrototypeUntouched(() => {
			const lines = [...PROTOTYPE_WORDS, ...PROTOTYPE_WORDS.map((w) => `x = ${w}`), ...TEXT_EDGES, "ѕ", "ｋg", "k​g", "‮kg", "<b>kg", "<script>m", "'; km"];
			expectAgreement(engine, lines);
		});
		const ls = new LanguageService(engine);
		expect(ls.getCompletions("ѕ", 1)).toEqual([]);
		expect(ls.getCompletions("ｋ", 1)).toEqual([]);
	});

	test("resource: a very long prefix and a long run of words answer quickly and agree", () => {
		const engine = newTrackedEngine();
		const long = RESOURCE_PROBES.longIdentifier(100_000);
		const words = Array.from({ length: 5_000 }, () => "net").join(" ") + " pres";
		const started = Date.now();
		expectAgreement(engine, [long, `k${long}`, words]);
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	test("realistic: many engines in one process each answer correctly, with their own packages", () => {
		const hostile: IEnginePackage = { name: "p-hostile-units", completionItems: PROTOTYPE_WORDS.map((w) => ({ label: w, category: "unit" })) };
		expectPrototypeUntouched(() => {
			for (let i = 0; i < 5; i++) {
				const engine = newTrackedEngine({ packages: i % 2 === 0 ? BUILTIN_PACKAGES : [...BUILTIN_PACKAGES, hostile] });
				expectAgreement(engine, ["c", "co", "_", "__", "p", "t", "kg"]);
			}
		});
	});
});
