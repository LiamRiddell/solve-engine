import { describe, expect, test } from "@jest/globals";
import { LanguageService, type CompletionItem } from "@solve-js/language/LanguageService";
import { completionItemToOption } from "@solve-js/language/adapters/codemirror";
import { getTokenCategory } from "@solve-js/language/TokenCategoryMap";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #771: completions offered only lexer keywords that had a highlight
 * category, the unit table and packages' `completionItems`. The declarative
 * call words (`sha256(`), registered phrases (the aggregates among them), the
 * units a document defines, and eight keywords with no category (the weekday
 * names and `by`) never entered, so `sha` offered only `shade` and `averag`
 * offered nothing.
 *
 * `getCompletions` now also offers the call words packages declare through
 * `callFusions` (as functions, via `engine.getCallWords()`), every registered
 * phrase by its opening words (and across the words already typed, with
 * `replaceLength`), and `engine.userUnitNames()` read fresh on each call; the
 * eight keywords have a category.
 */

/** The labels a prefix typed at the end of `line` is offered. */
function offered(service: LanguageService, line: string): string[] {
	return service.getCompletions(line, line.length).map((c) => c.label);
}

function service(): { engine: ReturnType<typeof newTrackedEngine>; ls: LanguageService } {
	const engine = newTrackedEngine();
	return { engine, ls: new LanguageService(engine) };
}

// ── The issue's prefixes, one source each ────────────────────────────────

describe("each source enters completions", () => {
	test("call words: sha offers the digests as functions, and the words evaluate", () => {
		const { engine, ls } = service();
		const items = ls.getCompletions("sha", 3);
		for (const digest of ["sha1", "sha256", "sha512"]) {
			expect(items).toContainEqual({ label: digest, category: "function", detail: "function call" });
		}
		expect(formatValue(engine.evaluateExpression('sha256("abc")'))).toBe("= ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});

	test("engine.getCallWords lists the declared call words, lower-cased", () => {
		const { engine } = service();
		const words = engine.getCallWords();
		expect(words).toEqual(expect.arrayContaining(["sha256", "base64", "slugify", "md5"]));
		expect(words.every((w) => w === w.toLowerCase())).toBe(true);
	});

	test("phrases: presen offers present value of, averag offers average of, weath offers weather in", () => {
		const { engine, ls } = service();
		expect(offered(ls, "presen")).toContain("present value of");
		expect(offered(ls, "averag")).toEqual(expect.arrayContaining(["average of", "average above"]));
		expect(offered(ls, "weath")).toContain("weather in");
		expect(formatValue(engine.evaluateExpression("average of 10, 20, 30"))).toBe("= 20");
	});

	test("a phrase matched across typed words carries the length it replaces", () => {
		const { engine, ls } = service();
		const items = ls.getCompletions("net pres", 8);
		expect(items).toContainEqual({ label: "net present value of", category: "keyword", detail: "phrase", replaceLength: 8 });
		// The single-word match is offered too, and replaces only the last word.
		const lone = items.find((i) => i.label === "present value of");
		expect(lone?.replaceLength).toBeUndefined();
		expect(formatValue(engine.evaluateExpression("net present value of -1000, 300, 400, 500 at 10%"))).toBe("= -21.04");
	});

	test("the phrase match reads only the words before the cursor", () => {
		const { ls } = service();
		const line = "net pres and more";
		expect(ls.getCompletions(line, 8).map((c) => c.label)).toContain("net present value of");
	});

	test("user units: after 1 sprint = 2 weeks, spr offers sprint", () => {
		const { engine, ls } = service();
		expect(offered(ls, "4 spr")).not.toContain("sprint");
		const doc = engine.parseDocument("1 sprint = 2 weeks\n3 sprints in days");
		expect(formatValue(doc.lines[1].result!)).toBe("= 42 days");
		const items = ls.getCompletions("4 spr", 5);
		expect(items).toContainEqual({ label: "sprint", category: "unit", detail: "defined in this document" });
	});

	test("the eight uncategorised keywords now have one and are offered", () => {
		const { ls } = service();
		for (const type of ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "BY"]) {
			expect(getTokenCategory(type)).toBe("keyword");
		}
		expect(offered(ls, "frid")).toContain("friday");
		expect(offered(ls, "by")).toContain("by");
	});

	test("every lexer keyword now has a category", () => {
		const { engine } = service();
		const missing = Object.entries(engine.getLexer().getKeywords()).filter(([, type]) => getTokenCategory(type) === undefined);
		expect(missing).toEqual([]);
	});

	test("what was offered before is still offered", () => {
		const { ls } = service();
		expect(offered(ls, "sqr")).toContain("sqrt");
		expect(offered(ls, "sha")).toContain("shade");
		expect(offered(ls, "kilom")).toContain("kilometer");
	});
});

describe("the static list, the part", () => {
	test("each label appears once per category", () => {
		const { ls } = service();
		for (const prefix of ["s", "a", "m", "p", "w", "l"]) {
			const items = ls.getCompletions(prefix, 1);
			const keys = items.map((i) => `${i.category}:${i.label.toLowerCase()}`);
			expect(new Set(keys).size).toBe(keys.length);
		}
	});

	test("a package's own item wins over the same word as a call word, keeping its detail", () => {
		const engine = newTrackedEngine();
		const pkg: IEnginePackage = {
			name: "p771-detail",
			callFusions: { zzcall: "ZZCALL" },
			completionItems: [{ label: "zzcall", category: "function", detail: "zzcall(x): number" }],
		};
		engine.registerPackage(pkg);
		const items = new LanguageService(engine).getCompletions("zzc", 3).filter((i) => i.label === "zzcall");
		expect(items).toEqual([{ label: "zzcall", category: "function", detail: "zzcall(x): number" }]);
	});

	test("a package registered after the service is built is offered once the cache is invalidated", () => {
		const engine = newTrackedEngine();
		const ls = new LanguageService(engine);
		expect(offered(ls, "qqwo")).toEqual([]);
		engine.registerPackage({ name: "p771-late", callFusions: { qqword: "QQWORD" } });
		ls.invalidateCache();
		// The static list is rebuilt lazily; invalidateCache clears the line cache,
		// and a fresh service reads the new registration.
		expect(offered(new LanguageService(engine), "qqwo")).toContain("qqword");
	});

	test("a package phrase is offered by its opening words", () => {
		const engine = newTrackedEngine();
		engine.registerPackage({ name: "p771-phrase", phrases: { "zebra crossing time": "ZEBRA_TIME" }, tokenCategories: { ZEBRA_TIME: "keyword" } });
		const ls = new LanguageService(engine);
		expect(offered(ls, "zebr")).toContain("zebra crossing time");
		expect(ls.getCompletions("zebra cro", 9)).toContainEqual(expect.objectContaining({ label: "zebra crossing time", replaceLength: 9 }));
	});
});

describe("the CodeMirror adapter, the part", () => {
	type Spec = { changes: { from: number; to: number; insert: string }; selection: { anchor: number } };

	test("a phrase matched across typed words replaces them, and the cursor lands after it", () => {
		const option = completionItemToOption({ label: "net present value of", category: "keyword", replaceLength: 8 });
		const calls: Spec[] = [];
		option.apply!({ dispatch: (spec) => calls.push(spec) }, null, 4, 8);
		expect(calls).toEqual([{ changes: { from: 0, to: 8, insert: "net present value of" }, selection: { anchor: 20 } }]);
	});

	test("an ordinary item has no apply, so CodeMirror replaces the word as it always did", () => {
		expect(completionItemToOption({ label: "sqrt", category: "function" })).toEqual({ label: "sqrt", type: "function", detail: undefined });
	});

	test.each([0, -1, Number.NaN, 1.5, Number.POSITIVE_INFINITY])("a replaceLength of %p is ignored", (replaceLength) => {
		expect(completionItemToOption({ label: "x", category: "unit", replaceLength }).apply).toBeUndefined();
	});

	test("a replaceLength past the start of the document is clamped to it", () => {
		const calls: Spec[] = [];
		completionItemToOption({ label: "average of", category: "keyword", replaceLength: 50 }).apply!({ dispatch: (spec) => calls.push(spec) }, null, 0, 3);
		expect(calls[0].changes).toEqual({ from: 0, to: 3, insert: "average of" });
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test("prototype words as prefixes offer nothing inherited and leave Object.prototype alone", () => {
		const { ls } = service();
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				for (const item of ls.getCompletions(word, word.length)) {
					expect(typeof item.label).toBe("string");
					expect(item.label.toLowerCase().startsWith(word.toLowerCase())).toBe(true);
				}
			}
		});
	});

	test("a user unit named like a prototype word is offered as a unit, and nothing else changes", () => {
		const { engine, ls } = service();
		expectPrototypeUntouched(() => {
			engine.parseDocument("1 constructor = 2 m");
			const items = ls.getCompletions("constr", 6);
			for (const item of items) expect(item.label).not.toBe("[object Object]");
		});
	});

	test("a one-character prefix never returns more than the cap", () => {
		const { ls } = service();
		for (const c of "abcdefghijklmnopqrstuvwxyz") {
			expect(ls.getCompletions(c, 1).length).toBeLessThanOrEqual(50);
		}
	});

	test("a document of 10,000 defined units keeps a keystroke's completion within budget", () => {
		const { engine, ls } = service();
		const text = Array.from({ length: 10_000 }, (_, i) => `1 zu${i} = 2 m`).join("\n");
		engine.parseDocument(text);
		expect(engine.userUnitNames().length).toBeGreaterThan(9_000);
		ls.getCompletions("zu", 2);
		const started = performance.now();
		for (let i = 0; i < 20; i++) ls.getCompletions("zu12", 4);
		const perKeystroke = (performance.now() - started) / 20;
		expect(perKeystroke).toBeLessThan(50);
		expect(ls.getCompletions("zu", 2).length).toBe(50);
	});

	test("a very long run of words before the cursor is looked back over only a few words", () => {
		const { ls } = service();
		const line = `${"word ".repeat(20_000)}net pres`;
		const started = performance.now();
		const items = ls.getCompletions(line, line.length);
		expect(performance.now() - started).toBeLessThan(500);
		expect(items.map((i) => i.label)).toContain("net present value of");
	});

	test.each(TEXT_EDGES)("text edge %p is answered with a list, never a throw", (text) => {
		const { ls } = service();
		const items = ls.getCompletions(text, text.length);
		expect(Array.isArray(items)).toBe(true);
	});

	test("markup-shaped text offers what matches its last word only", () => {
		const { ls } = service();
		const line = "<script>sha";
		expect(offered(ls, line)).toContain("sha256");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a user unit named like a keyword: the keyword is offered, the definition is refused or kept honestly", () => {
		const { engine, ls } = service();
		engine.parseDocument("1 friday = 2 days");
		const labels = ls.getCompletions("frid", 4);
		expect(labels.some((l) => l.label === "friday")).toBe(true);
	});

	test("a unit whose defining line is deleted disappears from completions", () => {
		const engine = newTrackedEngine();
		const ls = new LanguageService(engine);
		const doc = new DocumentModel();
		doc.setDocument("1 sprint = 2 weeks\n3 sprints in days");
		const evaluator = new ThreeTierEvaluator(doc, engine);
		evaluator.evaluate({ startLine: 1, endLine: 2 });
		expect(offered(ls, "4 spr")).toContain("sprint");
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
		evaluator.evaluate({ startLine: 1, endLine: 1 });
		expect(offered(ls, "4 spr")).not.toContain("sprint");
		evaluator.dispose();
	});

	test("an edit that renames the unit swaps the offer", () => {
		const engine = newTrackedEngine();
		const ls = new LanguageService(engine);
		const doc = new DocumentModel();
		doc.setDocument("1 sprint = 2 weeks");
		const evaluator = new ThreeTierEvaluator(doc, engine);
		evaluator.evaluate({ startLine: 1, endLine: 1 });
		evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: ["1 sprunt = 2 weeks"] }]);
		evaluator.evaluate({ startLine: 1, endLine: 1 });
		const labels = offered(ls, "4 spr");
		expect(labels).toContain("sprunt");
		expect(labels).not.toContain("sprint");
		evaluator.dispose();
	});

	test("a typo that matches nothing offers nothing", () => {
		const { ls } = service();
		expect(offered(ls, "averqq")).toEqual([]);
	});

	test("completions do not evaluate or change the document's answers", () => {
		const { engine, ls } = service();
		const before = engine.parseDocument(":x = 4\nx * 2").lines.map((l) => (l.result ? formatValue(l.result) : l.error));
		ls.getCompletions("sha", 3);
		ls.getCompletions("net pres", 8);
		const after = engine.parseDocument(":x = 4\nx * 2").lines.map((l) => (l.result ? formatValue(l.result) : l.error));
		expect(after).toEqual(before);
	});
});

describe("adversarial: edge cases", () => {
	test("a cursor at the start of the line, or after a space, offers nothing", () => {
		const { ls } = service();
		expect(ls.getCompletions("sha", 0)).toEqual([]);
		expect(ls.getCompletions("sha ", 4)).toEqual([]);
	});

	test("several spaces between typed words still match the phrase", () => {
		const { ls } = service();
		const items: CompletionItem[] = ls.getCompletions("net    pres", 11);
		expect(items).toContainEqual(expect.objectContaining({ label: "net present value of", replaceLength: 11 }));
	});

	test("upper case is matched case-insensitively", () => {
		const { ls } = service();
		expect(offered(ls, "SHA")).toContain("sha256");
		expect(offered(ls, "Net Pres")).toContain("net present value of");
	});

	test("a digit-only prefix offers no phrase and no crash", () => {
		const { ls } = service();
		expect(() => ls.getCompletions("12 34", 5)).not.toThrow();
	});

	test("an engine-less service offers nothing", () => {
		expect(new LanguageService(null).getCompletions("sha", 3)).toEqual([]);
	});
});
