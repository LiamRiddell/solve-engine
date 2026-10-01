/**
 * A short completion prefix no longer sorts the static vocabulary per keystroke.
 *
 * The benchmark gate measured the language-service case
 * `completions_warm_short_prefix` (`s`, warm) at 1.64 and 1.76 times its merge
 * base, with the neighbouring cases flat. Bisecting the merged batches put the
 * whole step at #771, which brought the call words, the registered phrases and
 * the eight uncategorised keywords into completions: the `s` bucket grew from
 * 49 candidates to 78. `getCompletions` sorted every match on every call by
 * tier and `localeCompare`, so a one-letter prefix, the case that matches the
 * most, paid for the larger vocabulary in comparisons.
 *
 * The static buckets are now sorted once, when the index is built, and a call
 * merges them with the few candidates that change with the document (its
 * variables, its units, phrases matched across words), ties going to the run
 * gathered first, which is what the stable sort did. The results are proven
 * identical here against the implementation it replaced, kept below as an
 * oracle.
 */

import { describe, expect, jest, test } from "@jest/globals";
import { LanguageService, type CompletionItem } from "@solve-js/language/LanguageService";
import { compareCompletionItems, completionTier, mergeRankedCompletions } from "@solve-js/language/completionRanking";
import type { TokenCategory } from "@solve-js/language/TokenCategory";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";

// ── The implementation replaced, kept as an oracle ──────────────────────────

/** The tier table as it was, an object literal read by the category. */
const OLD_CATEGORY_TIER: Partial<Record<TokenCategory, number>> = {
	variable: 0, function: 1, keyword: 1, operator: 1, comparison: 1, bitwise: 1, datetime: 1, vector: 1, unit: 2,
};

/** The private candidate list the index is built from, which this change leaves as it was. */
function staticCandidates(ls: LanguageService): CompletionItem[] {
	return (ls as unknown as { getStaticCompletionCandidates(): CompletionItem[] }).getStaticCompletionCandidates();
}

/**
 * `getCompletions` as it was: gather the document's names, the static matches
 * in candidate order and the cross-word phrases, then sort all of them on
 * every call. The first-character bucket it read is a pure filter over the
 * candidate list, so the oracle filters the list directly.
 */
function oldGetCompletions(ls: LanguageService, engine: ReturnType<typeof newTrackedEngine>, variables: Iterable<string>, lineText: string, cursorOffset: number): CompletionItem[] {
	const prefixMatch = /[A-Za-z0-9_]+$/.exec(lineText.slice(0, cursorOffset));
	if (!prefixMatch) return [];
	const prefix = prefixMatch[0].toLowerCase();
	const matches: CompletionItem[] = [];
	for (const name of variables) {
		if (name.toLowerCase().startsWith(prefix)) matches.push({ label: name, category: "variable" });
	}
	for (const name of engine.userUnitNames()) {
		if (name.toLowerCase().startsWith(prefix)) matches.push({ label: name, category: "unit", detail: "defined in this document" });
	}
	const candidates = staticCandidates(ls);
	for (const item of candidates) {
		if (item.label.toLowerCase().startsWith(prefix)) matches.push(item);
	}
	const words = /(?:[A-Za-z0-9_]+ +){0,5}[A-Za-z0-9_]+$/.exec(lineText.slice(0, cursorOffset));
	if (words !== null && words[0].length > prefixMatch[0].length) {
		const typed = words[0];
		let start = 0;
		for (let n = 0; n < 6 && start < typed.length - prefixMatch[0].length; n++) {
			const tail = typed.slice(start).toLowerCase().replace(/ +/g, " ");
			for (const item of candidates) {
				const lower = item.label.toLowerCase();
				if (lower.includes(" ") && lower.startsWith(tail)) matches.push({ ...item, replaceLength: typed.length - start });
			}
			const nextSpace = typed.indexOf(" ", start);
			if (nextSpace < 0) break;
			start = nextSpace;
			while (typed[start] === " ") start++;
		}
	}
	matches.sort((a, b) => {
		const tierDiff = (OLD_CATEGORY_TIER[a.category] ?? 3) - (OLD_CATEGORY_TIER[b.category] ?? 3);
		if (tierDiff !== 0) return tierDiff;
		return a.label.localeCompare(b.label);
	});
	return matches.slice(0, 50);
}

/** A service over a fresh built-in engine, with an optional fixed variable list. */
function setup(variables?: readonly string[]): { engine: ReturnType<typeof newTrackedEngine>; ls: LanguageService; vars: () => Iterable<string> } {
	const engine = newTrackedEngine();
	const vars = variables === undefined ? () => engine.getDag().keysInUse() : () => variables;
	const ls = new LanguageService(engine, variables === undefined ? undefined : { variableNameSource: () => variables });
	return { engine, ls, vars };
}

/** The new result and the oracle's for a prefix typed at the end of `line`. */
function both(s: ReturnType<typeof setup>, line: string, cursor = line.length): { now: CompletionItem[]; before: CompletionItem[] } {
	return { now: s.ls.getCompletions(line, cursor), before: oldGetCompletions(s.ls, s.engine, s.vars(), line, cursor) };
}

/** Every one-character prefix a reader can type into the prefix pattern. */
const ONE_CHARACTER = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_"];

/** The prefixes the regression was measured on and its neighbours, as lines. */
const LINES = ["", "a", "c", "m", "s", "to", "S", "sq", "sqrt", "zzzznomatch", "x = s", "1 + m", "net pres", "average o", "net  present v", "total of c", "12 kg to l", "s ", "(s"];

// ── The results are what they were ──────────────────────────────────────────

describe("completions match the implementation they replaced", () => {
	test("the issue's short prefixes and the empty line, on an empty document", () => {
		const s = setup();
		for (const line of LINES) {
			const { now, before } = both(s, line);
			expect({ line, now }).toEqual({ line, now: before });
		}
	});

	test("every one-character prefix, every bucket", () => {
		const s = setup();
		for (const prefix of ONE_CHARACTER) {
			const { now, before } = both(s, prefix);
			expect({ prefix, now }).toEqual({ prefix, now: before });
		}
	});

	test("with the document's variables and units, which sort per call and merge", () => {
		// The batch pass leaves the engine's graph empty afterwards, so the
		// variables come from a source, as a host with its own document does.
		const s = setup(["speed", "Sales", "s1", "mass", "count", "total", "sum of"]);
		s.engine.parseDocument("speed = 5\nSales = 10\ns1 = 3\nmass = 2\ncount = 4\n1 sprint = 2 weeks\n1 smoot = 1.7 m\ntotal = speed + mass");
		expect(s.engine.userUnitNames()).toEqual(expect.arrayContaining(["sprint", "smoot"]));
		for (const line of [...LINES, ...ONE_CHARACTER]) {
			const { now, before } = both(s, line);
			expect({ line, now }).toEqual({ line, now: before });
		}
		expect(s.ls.getCompletions("s", 1).slice(0, 3).map((c) => c.label)).toEqual(["s1", "Sales", "speed"]);
	});

	test("500 variables, more than the cap, all matching", () => {
		const s = setup(Array.from({ length: 500 }, (_, i) => `variable${i}`));
		for (const line of ["v", "var", "variable1", "s", "a"]) {
			const { now, before } = both(s, line);
			expect({ line, now }).toEqual({ line, now: before });
		}
	});

	test("a cursor inside the line reads the prefix before it", () => {
		const s = setup(["sales", "speed"]);
		for (const [line, cursor] of [["s + 1", 1], ["net pres and more", 8], ["average of 1, 2", 5], ["sqrt", 0]] as const) {
			const { now, before } = both(s, line, cursor);
			expect({ line, cursor, now }).toEqual({ line, cursor, now: before });
		}
	});

	test("ties keep the order they were gathered in: a package's same-label items and a zero-width label", () => {
		const engine = newTrackedEngine();
		engine.registerPackage({
			name: "p-completion-ties",
			completionItems: [
				{ label: "sqrt", category: "keyword", detail: "tie one" },
				{ label: "sqrt", category: "operator", detail: "tie two" },
				{ label: "s​qrt", category: "datetime", detail: "zero-width" },
				{ label: "Sqrt", category: "vector", detail: "capital" },
				{ label: "squib", category: "colour", detail: "an unlisted category" },
			],
		});
		const s = { engine, ls: new LanguageService(engine), vars: () => engine.getDag().keysInUse() };
		for (const line of ["s", "sq", "sqrt", "S"]) {
			const { now, before } = both(s, line);
			expect({ line, now }).toEqual({ line, now: before });
		}
		const details = s.ls.getCompletions("sqr", 3).map((c) => c.detail);
		expect(details.indexOf("tie one")).toBeLessThan(details.indexOf("tie two"));
	});

	test("an edit and a cache invalidation give the same answers as the oracle", () => {
		const s = setup();
		expect(both(s, "s").now).toEqual(both(s, "s").before);
		s.engine.registerPackage({ name: "p-completion-late", completionItems: [{ label: "saffron", category: "function" }] });
		s.ls.invalidateCache();
		const { now, before } = both(s, "sa");
		expect(now).toEqual(before);
		expect(now.map((c) => c.label)).toContain("saffron");
	});

	test("the warm short prefix compares no labels: the buckets were sorted when the index was built", () => {
		const s = setup();
		s.ls.getCompletions("s", 1);
		const spy = jest.spyOn(String.prototype, "localeCompare");
		try {
			const items = s.ls.getCompletions("s", 1);
			expect(items).toHaveLength(50);
			expect(spy).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});

	test("the returned list is the caller's own: changing it changes nothing the next call returns", () => {
		const s = setup();
		const first = s.ls.getCompletions("s", 1);
		const snapshot = first.map((c) => c.label);
		first.reverse();
		first.length = 3;
		expect(s.ls.getCompletions("s", 1).map((c) => c.label)).toEqual(snapshot);
	});
});

// ── The parts ────────────────────────────────────────────────────────────────

describe("completionTier", () => {
	test("ordinary: variables, then grammar, then units", () => {
		expect(completionTier("variable")).toBe(0);
		for (const c of ["function", "keyword", "operator", "comparison", "bitwise", "datetime", "vector"]) expect(completionTier(c)).toBe(1);
		expect(completionTier("unit")).toBe(2);
	});

	test("boundary: a category the table does not list goes last, the empty one included", () => {
		for (const c of ["number", "string", "punctuation", "error", "colour", "", " ", "Unit", "VARIABLE"]) expect(completionTier(c)).toBe(3);
	});

	test("hostile: a category named after an inherited property is unlisted, not a function off the prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(completionTier(word)).toBe(3);
		});
	});
});

describe("compareCompletionItems", () => {
	const item = (label: string, category: TokenCategory): CompletionItem => ({ label, category });

	test("ordinary: tier decides first, then the label", () => {
		expect(compareCompletionItems(item("zeta", "variable"), item("alpha", "function"))).toBeLessThan(0);
		expect(compareCompletionItems(item("alpha", "unit"), item("zeta", "keyword"))).toBeGreaterThan(0);
		expect(compareCompletionItems(item("alpha", "keyword"), item("beta", "function"))).toBeLessThan(0);
	});

	test("boundary: equal tier and label is a tie, and the order is antisymmetric", () => {
		expect(compareCompletionItems(item("sqrt", "keyword"), item("sqrt", "operator"))).toBe(0);
		const pairs: [CompletionItem, CompletionItem][] = [[item("a", "unit"), item("B", "unit")], [item("s", "keyword"), item("S", "keyword")], [item("", "unit"), item("a", "unit")]];
		for (const [a, b] of pairs) expect(Math.sign(compareCompletionItems(a, b))).toBe(-Math.sign(compareCompletionItems(b, a)));
	});

	test("hostile: prototype-word labels and categories compare as text, never NaN", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const r = compareCompletionItems(item(word, word), item("a", "unit"));
				expect(Number.isNaN(r)).toBe(false);
				expect(r).toBeGreaterThan(0);
			}
		});
	});
});

describe("mergeRankedCompletions", () => {
	const item = (label: string, category: TokenCategory, detail?: string): CompletionItem => (detail === undefined ? { label, category } : { label, category, detail });

	/** A small seeded generator, so the property case is the same every run. */
	function seeded(seed: number): () => number {
		let x = seed >>> 0;
		return () => {
			x = (x * 1664525 + 1013904223) >>> 0;
			return x / 2 ** 32;
		};
	}

	test("ordinary: three sorted runs merge into the stable sort of their concatenation", () => {
		const a = [item("sales", "variable"), item("sprint", "unit")];
		const b = [item("sin", "function"), item("sqrt", "function"), item("s", "unit")];
		const c = [item("sum of", "keyword")];
		const expected = [...a, ...b, ...c].sort(compareCompletionItems);
		expect(mergeRankedCompletions([a, b, c], 50)).toEqual(expected);
	});

	test("boundary: no groups, empty groups, a limit of 0, negative, NaN, below and above the total", () => {
		const g = [[item("a", "unit"), item("b", "unit")], [item("c", "unit")]];
		expect(mergeRankedCompletions([], 50)).toEqual([]);
		expect(mergeRankedCompletions([[], [], []], 50)).toEqual([]);
		expect(mergeRankedCompletions(g, 0)).toEqual([]);
		expect(mergeRankedCompletions(g, -1)).toEqual([]);
		expect(mergeRankedCompletions(g, Number.NaN)).toEqual([]);
		expect(mergeRankedCompletions(g, 2).map((i) => i.label)).toEqual(["a", "b"]);
		expect(mergeRankedCompletions(g, Number.POSITIVE_INFINITY).map((i) => i.label)).toEqual(["a", "b", "c"]);
	});

	test("boundary: a tie goes to the earlier group, then to the earlier place in it", () => {
		const first = [item("sqrt", "keyword", "g0")];
		const second = [item("sqrt", "function", "g1a"), item("sqrt", "operator", "g1b")];
		const third = [item("sqrt", "datetime", "g2")];
		expect(mergeRankedCompletions([first, second, third], 50).map((i) => i.detail)).toEqual(["g0", "g1a", "g1b", "g2"]);
		expect(mergeRankedCompletions([third, second, first], 50).map((i) => i.detail)).toEqual(["g2", "g1a", "g1b", "g0"]);
	});

	test("the groups are not changed", () => {
		const a = [item("b", "unit"), item("d", "unit")];
		const b = [item("a", "unit"), item("c", "unit")];
		const copies = [a.slice(), b.slice()];
		mergeRankedCompletions([a, b], 50);
		expect([a, b]).toEqual(copies);
	});

	test("property: over seeded random runs with many ties, the merge equals the stable sort", () => {
		const random = seeded(771);
		const labels = ["s", "S", "sa", "sq", "sqrt", "s​qrt", "speed", "sum of", "constructor", "__proto__", ""];
		const categories: TokenCategory[] = ["variable", "function", "keyword", "unit", "colour", "toString"];
		for (let trial = 0; trial < 300; trial++) {
			const groups = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, g) =>
				Array.from({ length: Math.floor(random() * 12) }, (_, i) => item(labels[Math.floor(random() * labels.length)], categories[Math.floor(random() * categories.length)], `${g}:${i}`)).sort(compareCompletionItems),
			);
			const limit = Math.floor(random() * 40);
			expect(mergeRankedCompletions(groups, limit)).toEqual(groups.flat().sort(compareCompletionItems).slice(0, limit));
		}
	});
});

// ── Adversarial ─────────────────────────────────────────────────────────────

describe("adversarial prefixes", () => {
	test("security: prototype words as prefixes agree with the oracle and leave Object.prototype alone", () => {
		const s = setup();
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				for (const line of [word, word.slice(0, 3), `x = ${word}`]) {
					const { now, before } = both(s, line);
					expect({ line, now }).toEqual({ line, now: before });
				}
			}
		});
	});

	test("security: look-alike, zero-width and markup-shaped text agree with the oracle", () => {
		const s = setup();
		const lines = [...TEXT_EDGES, "ѕ", "s​", "​s", "ｓ", "‮s", "<b>s", "<script>s", "s</script>", "'; s"];
		for (const line of lines) {
			const { now, before } = both(s, line);
			expect({ line, now }).toEqual({ line, now: before });
		}
		expect(s.ls.getCompletions("ѕ", 1)).toEqual([]);
		expect(s.ls.getCompletions("s​", 2)).toEqual([]);
	});

	test("resource: a very long prefix and a long run of words answer quickly and agree", () => {
		const s = setup();
		const long = RESOURCE_PROBES.longIdentifier(100_000);
		const words = Array.from({ length: 5_000 }, () => "net").join(" ") + " pres";
		const started = Date.now();
		for (const line of [long, `s${long}`, words]) {
			const { now, before } = both(s, line);
			expect(now).toEqual(before);
		}
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	test("realistic: a hostile category from a package ranks last and the answer is deterministic", () => {
		const engine = newTrackedEngine();
		engine.registerPackage({
			name: "p-completion-hostile",
			completionItems: PROTOTYPE_WORDS.map((word) => ({ label: `s${word}`, category: word })),
		});
		const ls = new LanguageService(engine);
		expectPrototypeUntouched(() => {
			const first = ls.getCompletions("s", 1).map((c) => `${c.category}:${c.label}`);
			expect(ls.getCompletions("s", 1).map((c) => `${c.category}:${c.label}`)).toEqual(first);
			const hostile = ls.getCompletions("sc", 2).filter((c) => c.label === "sconstructor");
			expect(hostile).toEqual([{ label: "sconstructor", category: "constructor" }]);
			const all = ls.getCompletions("sc", 2);
			expect(all[all.length - 1].label).toBe("sconstructor");
		});
	});
});
