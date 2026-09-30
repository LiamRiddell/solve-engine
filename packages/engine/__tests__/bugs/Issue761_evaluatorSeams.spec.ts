import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { ExpressionEngine, copyPlain } from "@solve-js/engine/ExpressionEngine";
import { EVALUATOR_SEAMS, type EvaluatorHost } from "@solve-js/engine/EvaluatorHost";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #761: `ExpressionEngine` published its evaluator seams as public
 * members, and some getters handed out live internals. `getBytecodeCache()`
 * returned the map the engine compiles through, so one `set` on it made `2 + 2`
 * answer 9 through both entry points, and `getConfig()` copied only its top
 * level, so a nested setting changed on the copy changed the engine.
 *
 * The 2.x half: the seams are marked `@internal` and named in one contract
 * (`EVALUATOR_SEAMS` / `EvaluatorHost`) that the incremental evaluator and
 * `evaluateDocument` hold the engine as; the leaky getters are deprecated,
 * `getBytecodeCache()` and `getConfig()` return copies, and a test below fails
 * when a public member lands with neither a docs mention nor `@internal`.
 * Removing the seams from the published types is 3.0.
 */

const SOURCE = path.resolve(__dirname, "../../src/engine/ExpressionEngine.ts");
const DOCS = path.resolve(__dirname, "../../../../docs/src/content/docs");

/** Every public member of `ExpressionEngine`, with whether its doc comment carries `@internal` and `@deprecated`. */
function publicMembers(): Array<{ name: string; internal: boolean; deprecated: boolean }> {
	const file = ts.createSourceFile(SOURCE, fs.readFileSync(SOURCE, "utf8"), ts.ScriptTarget.Latest, true);
	const out: Array<{ name: string; internal: boolean; deprecated: boolean }> = [];
	const seen = new Set<string>();
	file.forEachChild((node) => {
		if (!ts.isClassDeclaration(node) || node.name?.text !== "ExpressionEngine") return;
		for (const member of node.members) {
			if (ts.isConstructorDeclaration(member) || member.name === undefined || ts.isPrivateIdentifier(member.name)) continue;
			const flags = ts.getCombinedModifierFlags(member as ts.Declaration);
			if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue;
			const name = member.name.getText(file);
			const tags = ts.getJSDocTags(member).map((t) => t.tagName.text);
			const entry = { name, internal: tags.includes("internal"), deprecated: tags.includes("deprecated") };
			if (seen.has(name)) {
				// An overload: a tag on any signature counts.
				const prior = out.find((m) => m.name === name)!;
				prior.internal ||= entry.internal;
				prior.deprecated ||= entry.deprecated;
				continue;
			}
			seen.add(name);
			out.push(entry);
		}
	});
	return out;
}

/** Every .md and .mdx page's text under the docs content directory, joined. */
function docsText(): string {
	const parts: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (/\.mdx?$/.test(entry.name)) parts.push(fs.readFileSync(p, "utf8"));
		}
	};
	walk(DOCS);
	return parts.join("\n");
}

const members = publicMembers();

/** The settings a host written in plain JavaScript can assign to, read-only in the types. */
interface WritableSettings {
	performance: { maxDocumentLines: number };
	network: { enabled: boolean };
	vm: { maxGoalSeekIterations: number };
}

/** What `getConfig` returns, as a host that ignores the read-only types would use it. */
function writableConfig(engine: ExpressionEngine): WritableSettings {
	return engine.getConfig() as unknown as WritableSettings;
}

/** Two answers through evaluateExpression and a document's through parseDocument. */
function answers(engine: ExpressionEngine): string[] {
	const out = [formatValue(engine.evaluateExpression("2 + 2")), formatValue(engine.evaluateExpression("4 + 5"))];
	for (const line of engine.parseDocument(":x = 4\nx + 5\n2 + 2\n10 km in m").lines) out.push(line.result ? formatValue(line.result) : String(line.error));
	return out;
}

describe("the issue's run", () => {
	test("setting the cache a getter hands out cannot make 2 + 2 answer 9", () => {
		const engine = newTrackedEngine();
		expect(formatValue(engine.evaluateExpression("4 + 5"))).toBe("= 9");
		expect(formatValue(engine.evaluateExpression("2 + 2"))).toBe("= 4");
		const cache = engine.getBytecodeCache();
		expect(cache.size).toBe(2);
		const nine = cache.get("4 + 5")!;
		cache.set("2 + 2", nine);
		expect(formatValue(engine.evaluateExpression("2 + 2"))).toBe("= 4");
		expect(formatValue(engine.parseDocument("2 + 2").lines[0].result!)).toBe("= 4");
		// A copy, but a faithful one: what is cached, in recency order.
		expect([...engine.getBytecodeCache().keys()]).toEqual(["4 + 5", "2 + 2"]);
	});
});

describe("mutating what each getter returns leaves the engine's answers", () => {
	const attacks: ReadonlyArray<readonly [string, (engine: ExpressionEngine) => void]> = [
		["getConfig, nested", (e) => {
			const c = writableConfig(e);
			c.performance.maxDocumentLines = 1;
			c.network.enabled = false;
			c.vm.maxGoalSeekIterations = 0;
		}],
		["getBytecodeCache: set, delete, clear", (e) => {
			const c = e.getBytecodeCache();
			const first = [...c.values()][0];
			for (const key of c.keys()) c.set(key, first);
			c.delete("2 + 2");
			c.clear();
		}],
		["getLineCache: clear", (e) => e.getLineCache().clear()],
		["getDag: clear", (e) => e.getDag().clear()],
		["getVM: reset", (e) => e.getVM().reset()],
		["getLexer: a stray reset", (e) => e.getLexer().resetExpression("9 * 9")],
		["getParseletRegistry: emptied", (e) => {
			const r = e.getParseletRegistry();
			r.prefix.length = 0;
			r.infix.length = 0;
		}],
		["getPackageCompletionItems: emptied", (e) => {
			e.getPackageCompletionItems().length = 0;
		}],
		["getCacheSnapshot: overwritten", (e) => {
			const s = e.getCacheSnapshot() as unknown as Record<string, unknown>;
			for (const key of Object.keys(s)) s[key] = null;
		}],
		["getCheckpoints: emptied", (e) => {
			e.getCheckpoints().length = 0;
		}],
		["getBatcherMetrics: overwritten", (e) => {
			const m = e.getBatcherMetrics() as unknown as Record<string, unknown>;
			for (const key of Object.keys(m)) m[key] = -1;
		}],
		["tokenizeForClassification: tokens rewritten", (e) => {
			for (const token of e.tokenizeForClassification("2 + 2")) token.value = "9";
		}],
	];
	test.each(attacks)("%s", (_name, attack) => {
		const engine = newTrackedEngine({ config: { network: { enabled: false } } });
		const before = answers(engine);
		attack(engine);
		expect(answers(engine)).toEqual(before);
	});
});

describe("the evaluator's contract", () => {
	test("every seam is a method of the engine", () => {
		const engine = newTrackedEngine();
		for (const name of EVALUATOR_SEAMS) expect(typeof (engine as unknown as Record<string, unknown>)[name]).toBe("function");
		// The engine satisfies the contract as a type, which is what the evaluator holds.
		const host: EvaluatorHost = engine;
		expect(host.getVM()).toBe(engine.getVM());
	});

	test("every seam but evaluateLine and getBatcher is marked @internal", () => {
		const byName = new Map(members.map((m) => [m.name, m]));
		for (const name of EVALUATOR_SEAMS) {
			if (name === "evaluateLine" || name === "getBatcher") continue;
			expect({ name, internal: byName.get(name)?.internal }).toEqual({ name, internal: true });
		}
	});

	test("the incremental evaluator reaches the engine only through the seams", () => {
		const text = fs.readFileSync(path.resolve(__dirname, "../../src/engine/ThreeTierEvaluator.ts"), "utf8");
		const used = new Set([...text.matchAll(/this\.engine\.([A-Za-z]+)/g)].map((m) => m[1]));
		const seams = new Set<string>(EVALUATOR_SEAMS);
		expect([...used].filter((name) => !seams.has(name))).toEqual([]);
	});

	test("evaluateDocument through the contract agrees with parseDocument", () => {
		const text = ":x = 3\nx * 2\nline 2 + 1";
		const show = (r: ReturnType<typeof evaluateDocument>) => r.lines.map((l) => (l.result ? formatValue(l.result) : l.error));
		expect(show(evaluateDocument(newTrackedEngine(), text))).toEqual(show(newTrackedEngine().parseDocument(text)));
	});
});

describe("the engine's public surface is documented or internal", () => {
	const docs = docsText();

	test("the scan finds the members it is meant to", () => {
		// Guards the scan against a rename that would leave it checking nothing.
		const names = members.map((m) => m.name);
		for (const name of ["evaluateExpression", "parseDocument", "getBytecodeCache", "restoreToPrefix", "getTokenCategory"]) expect(names).toContain(name);
	});

	test.each(members.map((m) => [m.name, m] as const))("%s is on a docs page or marked @internal", (name, member) => {
		const documented = new RegExp(`\\b${name}\\b`).test(docs);
		expect({ name, documentedOrInternal: documented || member.internal }).toEqual({ name, documentedOrInternal: true });
	});

	test("the leaky getters are deprecated", () => {
		const byName = new Map(members.map((m) => [m.name, m]));
		for (const name of ["getBytecodeCache", "getLineCache", "getDag", "getVM", "getLexer", "getNormalizer", "getParser", "getScopeManager", "getDiagnosticPipeline", "getDocumentModel"]) {
			expect({ name, deprecated: byName.get(name)?.deprecated }).toEqual({ name, deprecated: true });
		}
	});
});

// ── Unit tests of the parts ──────────────────────────────────────────────

describe("copyPlain", () => {
	test("ordinary: a nested tree is equal and shares no object or array", () => {
		const tree = { a: 1, b: { c: [1, { d: "x" }] }, e: null };
		const copy = copyPlain(tree);
		expect(copy).toEqual(tree);
		expect(copy).not.toBe(tree);
		expect(copy.b).not.toBe(tree.b);
		expect(copy.b.c).not.toBe(tree.b.c);
		expect(copy.b.c[1]).not.toBe(tree.b.c[1]);
	});

	test("boundary: primitives, an empty object, functions and class instances pass through", () => {
		expect(copyPlain(5)).toBe(5);
		expect(copyPlain(undefined)).toBeUndefined();
		expect(copyPlain({})).toEqual({});
		const fn = () => 1;
		const date = new Date(0);
		const out = copyPlain({ fn, date });
		expect(out.fn).toBe(fn);
		expect(out.date).toBe(date);
	});

	test("hostile: an own __proto__ key stays a key, and Object.prototype is unchanged", () => {
		expectPrototypeUntouched(() => {
			const parsed = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}}') as Record<string, unknown>;
			const copy = copyPlain(parsed);
			expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
			expect(Object.prototype.hasOwnProperty.call(copy, "__proto__")).toBe(true);
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
			for (const word of PROTOTYPE_WORDS) expect(copyPlain({ [word]: 1 })[word]).toBe(1);
		});
	});

	test("hostile: a deep tree is copied without a stack overflow at a config's depth", () => {
		let tree: Record<string, unknown> = { leaf: 1 };
		for (let i = 0; i < 1_000; i++) tree = { next: tree };
		expect(() => copyPlain(tree)).not.toThrow();
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: a hostile key written into what getConfig returns reaches neither the engine nor Object.prototype", () => {
		expectPrototypeUntouched(() => {
			const engine = newTrackedEngine();
			const config = engine.getConfig() as unknown as Record<string, Record<string, unknown>>;
			config.performance["__proto__"] = { maxDocumentLines: 1 };
			config["constructor"] = { prototype: { polluted: true } } as unknown as Record<string, unknown>;
			expect(engine.getConfig().performance.maxDocumentLines).toBeGreaterThan(1);
			expect(engine.parseDocument("1\n2\n3").lines.length).toBe(3);
		});
	});

	test("realistic: a host that reads a getter every keystroke sees the engine move on, not a frozen copy", () => {
		const engine = newTrackedEngine();
		engine.evaluateExpression("1 + 1");
		const first = engine.getBytecodeCache().size;
		engine.evaluateExpression("2 + 2");
		expect(engine.getBytecodeCache().size).toBe(first + 1);
		expect(engine.getConfig()).toEqual(engine.getConfig());
		expect(engine.getConfig()).not.toBe(engine.getConfig());
	});

	test("realistic: a snapshot taken after a getter was mutated carries the engine's own settings", () => {
		const engine = newTrackedEngine();
		engine.parseDocument(":x = 4\nx + 5");
		engine.getBytecodeCache().clear();
		writableConfig(engine).performance.maxDocumentLines = 1;
		const restored = ExpressionEngine.fromJSON(engine.toJSON());
		try {
			expect(restored.getConfig().performance.maxDocumentLines).toBe(engine.getConfig().performance.maxDocumentLines);
		} finally {
			restored.clear();
		}
	});

	test("edge: an engine that has compiled nothing hands out an empty copy", () => {
		const engine = newTrackedEngine();
		const cache = engine.getBytecodeCache();
		expect(cache.size).toBe(0);
		cache.set("", cache.get("x")!);
		expect(engine.getBytecodeCache().size).toBe(0);
		expect(formatValue(engine.evaluateExpression("0"))).toBe("= 0");
	});
});
