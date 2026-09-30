import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { compileFences, extractFences, fenceNames, fenceSource, givenImports, MISSING_MARKER_SOURCE, publicExportNames, type FenceTreatment, type GuideFence } from "@tools/guideSnippets";
import { PROTOTYPE_WORDS } from "@tools/adversarial";

/**
 * The TypeScript in the developer guides, type-checked (#779).
 *
 * `GuideExamples.spec.ts` runs the fences under `guide/` and `getting-started/`
 * that state a result; the rest were read by nothing, so a fence could show a
 * call the engine's types refuse and no build would notice. Every ` ```ts `
 * fence there is now compiled under `strict` against the engine's public entry
 * points, in the shape `PackageGuideSnippets.spec.ts` compiles the package
 * guides: `solve-engine` and each `solve-engine/<name>` resolve to the source
 * their published types are built from, so a fence compiles against exactly
 * what a consumer installs, and a deep import past them does not resolve.
 *
 * The guides open with `import { createEngine } from "solve-engine"` and
 * `const engine = createEngine()`, and the fences below lean on both, so each
 * fence is given the public names it mentions and does not declare, and an
 * `engine` when it reads one it never makes (see `givenImports`). Anything else
 * a fence reads is declared in the manifest below, with its type, by page and
 * first line: a name an earlier fence or the prose defines, a fragment's
 * wrapper, or the reason a fence is not checked at all.
 *
 * The boundary: this proves that each fence type-checks as a consumer would
 * write it, not that it runs (GuideExamples runs the ones that state a
 * result), and a given import means a fence is not held to importing every
 * name it uses. The package-author pages under `packages/` are compiled the same
 * way by `PackageGuideSnippets.spec.ts`, which also runs them.
 */

const ENGINE_ROOT = path.resolve(__dirname, "../..");
const DOCS = path.resolve(ENGINE_ROOT, "../../docs/src/content/docs");
const DIRECTORIES = ["guide", "getting-started"];

/** Every published entry, in the order a name is imported from when two export it. */
const ENTRIES = [
	"solve-engine",
	"solve-engine/format",
	"solve-engine/errors",
	"solve-engine/vm",
	"solve-engine/engine",
	"solve-engine/parser",
	"solve-engine/lexer",
	"solve-engine/resolvers",
	"solve-engine/packages",
	"solve-engine/testing",
	"solve-engine/language",
	"solve-engine/uom",
	"solve-engine/worker",
	"solve-engine/temporal",
	"solve-engine/normalizer",
	"solve-engine/utilities",
	"solve-engine/services",
	"solve-engine/constants",
];

/** A fence's key: its page and its first line, with ` (2)` for the second fence on a page that starts the same way. */
function keyOf(fence: GuideFence, all: readonly GuideFence[]): string {
	const first = fence.code.split("\n")[0].trim();
	const same = all.filter((f) => f.page === fence.page && f.code.split("\n")[0].trim() === first);
	const position = same.indexOf(fence) + 1;
	return `${fence.page} | ${first}${position > 1 ? ` (${position})` : ""}`;
}

// ── What the pages take as given ─────────────────────────────────────────

/** The runtime's own `Temporal`, typed as `createTemporalCalendar` takes it: the dates-on-Temporal page runs where one exists. */
const TEMPORAL = `import type { createTemporalCalendar as __Temporal } from "solve-engine/temporal";\ndeclare global { var Temporal: Parameters<typeof __Temporal>[0]; }`;
/** The engine the performance page starts on a worker, and the text and painter it reads. */
const WORKER_ENGINE = `import type { WorkerEngine } from "solve-engine/worker";\ndeclare const engine: WorkerEngine;\ndeclare const text: string;\ndeclare function render(line: number, text: string): void;`;
/** The evaluator the live-editor and performance pages build over their document. */
const EVALUATOR = `import type { ThreeTierEvaluator } from "solve-engine/engine";\ndeclare const evaluator: ThreeTierEvaluator;`;
/** The service and the note the reference-aware editing page works on. */
const SERVICE = `import type { LanguageService } from "solve-engine/language";\ndeclare const service: LanguageService;\ndeclare const text: string;`;
/** A snapshot the embedding and upgrading pages restore. */
const SNAPSHOT = `import type { EngineSnapshot, IEnginePackage } from "solve-engine";\ndeclare const state: EngineSnapshot;\ndeclare const myPackages: IEnginePackage[];`;
/** The package a page registers, made on the page before. */
const MY_PACKAGE = `import type { IEnginePackage } from "solve-engine";\ndeclare const myPackage: IEnginePackage;`;
/** The formatting page's running example, the value of `3 km in m`, and "a backend" its settings section names. */
const FORMATTED = `import type { CalendarBackend } from "solve-engine";\nconst value = engine.evaluateExpression("3 km in m");\ndeclare const calendar: CalendarBackend;`;
/** The source-stamping fence's names, which the stocks package's own fetch has in scope. */
const HISTORICAL = `declare const quote: { close: number; currency?: string };\ndeclare const provider: string;\ndeclare const ticker: string;\ndeclare const isoDate: string;`;
/** The upgrading page's before halves are the 1.x API, which 2.0 removed on purpose. */
const BEFORE_AND_AFTER = "sets a 1.x call beside the 2.0 one in one fence, and the 1.x half no longer compiles by design";

/** The page's "your syntax, your parse": the reader of the currency pair a line names. */
const READ_PAIR = `import type { Token as __Token } from "solve-engine/lexer";\ndeclare function readPairFromTokens(tokens: __Token[]): { from: string; to: string } | null;`;

const RATES = "guide/async-data-sources.md | import type { IAsyncResolver, AsyncCheckResult } from \"solve-engine/resolvers\";";

/** The fences that are not whole modules, and what each needs. */
const MANIFEST: Record<string, FenceTreatment> = {
	"guide/async-and-live-data.mdx | const stocks = createStocksPackage({": {
		prelude: `import type { StockQuote } from "solve-engine/packages";\ndeclare function myQuoteService(ticker: string, signal: AbortSignal): Promise<StockQuote>;`,
	},
	'guide/async-and-live-data.mdx | if (event.type === "error") {': {
		// The event the page's `watch` loop reads from the stream.
		prelude: `import type { AsyncResolutionEvent } from "solve-engine/engine";\ndeclare const event: AsyncResolutionEvent;`,
	},
	"guide/async-and-live-data.mdx | const value = engine.evaluateLine(n, text);": {
		prelude: `declare const n: number;\ndeclare const text: string;\ndeclare function replaceLine(line: number, text: string): void;`,
	},
	[RATES]: { prelude: READ_PAIR },
	"guide/async-data-sources.md | engine.registerPackage({": { continues: RATES, prelude: READ_PAIR },
	"guide/async-data-sources.md | class TableResolver implements IAsyncResolver {": {
		noCheck: "a sketch of the one field a local resolver adds, whose comment stands for the preflight and destroy above",
	},
	'guide/async-data-sources.md | import { OpCode } from "solve-engine/parser";': {
		noCheck: "a sketch of the one field a watching resolver adds, whose comment stands for the preflight and destroy above",
	},
	"guide/async-data-sources.md | const pluginFunction = (args: Value[], context?: LineExecutionContext) => {": {
		prelude: `import type { Value as __Value } from "solve-engine/vm";\ndeclare function keyFor(args: __Value[]): string[];\ndeclare function fetchIt(args: __Value[], signal: AbortSignal): Promise<__Value>;`,
	},
	'guide/async-data-sources.md | import { createQueryResolver } from "solve-engine/resolvers";': {
		prelude: `import type { Value as __Value } from "solve-engine/vm";\ndeclare const TIDES_FN: number;\ndeclare function fetchTide(port: string, signal: AbortSignal): Promise<__Value>;`,
	},
	"guide/async-data-sources.md | return {": {
		noCheck: "the return statement of the preflight above, shown alone for the two fields it adds, and it reads the class's own members",
	},
	"guide/async-data-sources.md | private async fetchRate(queryKey: string, pair: Pair, signal: AbortSignal): Promise<Value> {": {
		wrap: "class-member",
		prelude: `import type { Value } from "solve-engine/vm";\ninterface Pair { from: string; to: string }`,
		members: "private readonly cache = new Map<string, Value>();",
	},
	'guide/async-data-sources.md | const value = uomValue(quote.close, quote.currency ?? "USD");': { wrap: "function-body", prelude: HISTORICAL },
	'guide/dates-on-temporal.md | import { createEngine } from "solve-engine"; (2)': { prelude: TEMPORAL },
	'guide/dates-on-temporal.md | import { formatValue } from "solve-engine/format";': {
		prelude: TEMPORAL,
		continues: 'guide/dates-on-temporal.md | import { createEngine } from "solve-engine"; (2)',
	},
	'guide/dates-on-temporal.md | import { startWorkerRuntime } from "solve-engine/worker";': {
		prelude: `${TEMPORAL}\nimport type { WorkerTransport } from "solve-engine/worker";\ndeclare const transport: WorkerTransport;`,
	},
	'guide/dates-on-temporal.md | const tokyo = createEngine({ calendar: createTemporalCalendar(Temporal, { timeZone: "Asia/Tokyo" }) });': { prelude: TEMPORAL },
	'guide/determinism.md | dateCalendarInZone("UTC", { now: () => Date.UTC(2026, 0, 1) });': { prelude: TEMPORAL },
	"guide/embedding.md | const restored = ExpressionEngine.fromJSON(state, { packages: myPackages });": { prelude: SNAPSHOT },
	'guide/embedding.md | import { EngineError } from "solve-engine/errors";': {
		prelude: `import type { EngineSnapshot } from "solve-engine";\ndeclare const fromAnOlderEngine: EngineSnapshot;`,
	},
	'guide/formatting.md | import { formatValue } from "solve-engine/format";': { prelude: FORMATTED },
	'guide/formatting.md | import { formatValue } from "solve-engine/format"; (2)': { prelude: FORMATTED },
	'guide/live-editor.md | evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: [":bread = £1.50"] }]);': { prelude: EVALUATOR },
	"guide/live-editor.md | evaluator.dispose();": { prelude: EVALUATOR },
	'guide/live-editor.md | evaluator.applyTransaction([{ startLine: 4, deleteCount: 0, insertLines: [":milk = £0.95"] }]);': { prelude: EVALUATOR },
	"guide/live-editor.md | const view = evaluator.setViewport({ startLine: 4, endLine: 5 });": { prelude: EVALUATOR },
	"guide/live-editor.md | const liveEngine = createEngine();": { prelude: "declare function render(line: number, text: string): void;" },
	"guide/performance.mdx | // A keystroke on line 3: an edit in place, no line moves.": { prelude: EVALUATOR },
	'guide/performance.mdx | import { createWorkerEngine, eventTargetTransport } from "solve-engine/worker";': {
		prelude: "declare const text: string;\ndeclare function render(line: number, text: string): void;",
	},
	'guide/performance.mdx | const value = await engine.evaluateExpression("5 kg in m");': { prelude: WORKER_ENGINE },
	"guide/performance.mdx | const result = await engine.parseDocument(text, { signal });": { prelude: `${WORKER_ENGINE}\ndeclare const signal: AbortSignal;` },
	"guide/performance.mdx | const stop = engine.onResolved((lines) => {": { prelude: WORKER_ENGINE },
	"guide/performance.mdx | engine.onAsyncError(({ queryKey, packageId, error }) => {": { prelude: WORKER_ENGINE },
	"guide/performance.mdx | const doc = await engine.evaluateDocument(": { prelude: WORKER_ENGINE },
	"guide/reference-aware-editing.md | service.findReferences(text, { line: 2, character: 12 });": { prelude: SERVICE },
	"guide/reference-aware-editing.md | service.getDefinition(text, { line: 2, character: 12 });": { prelude: SERVICE },
	'guide/reference-aware-editing.md | import { formatValue } from "solve-engine/format";': { prelude: SERVICE },
	'guide/reference-aware-editing.md | const result = service.rename(text, { line: 1, character: 1 }, "vat");': { prelude: SERVICE },
	'guide/reference-aware-editing.md | service.rename(text, { line: 1, character: 1 }, "pi");': { prelude: SERVICE },
	"guide/reference-aware-editing.md | // A heading typed above the three lines of the note.": { prelude: SERVICE },
	'guide/reference-aware-editing.md | // Line 2 (the 20) of "10, 20, 30, line 3 - line 1, line 2 * 2" was deleted.': { prelude: SERVICE },
	"guide/reference-aware-editing.md | view.dispatch({": {
		noCheck: "a CodeMirror adapter, written against CodeMirror's EditorView, which the engine does not depend on",
	},
	'guide/results-as-json.md | const doc = serializeParsingResult(engine.parseDocument("a = 1.5\\na * 2\\n3 + * 4"), settings);': {
		prelude: `import type { FormattingSettings } from "solve-engine/format";\ndeclare const settings: FormattingSettings;`,
	},
	'guide/tracing-lines.md | import type { LineTrace } from "solve-engine";': {
		prelude: `import type { ParsingResult } from "solve-engine/engine";\ndeclare const document: ParsingResult;`,
	},
	"guide/tracing-lines.md | engine.traceLine(5, { document, maxDepth: 3, maxLines: 50 });": {
		prelude: `import type { ParsingResult } from "solve-engine/engine";\ndeclare const document: ParsingResult;`,
	},
	'guide/typescript-usage.md | import { ValueType } from "solve-engine/vm";': { wrap: "function-body" },
	"guide/upgrading-to-2.md | // before": { from: "// now" },
	"guide/upgrading-to-2.md | const engine = createEngine({ extraPackages: [myPackage] });": { prelude: MY_PACKAGE },
	"guide/upgrading-to-2.md | // before (2)": {
		from: "// now",
		prelude: `import type { ExpressionEngine as __Engine, IEnginePackage } from "solve-engine";\ndeclare const config: NonNullable<ConstructorParameters<typeof __Engine>[0]>["config"];\ndeclare const packages: IEnginePackage[];`,
	},
	"guide/upgrading-to-2.md | // before (3)": { from: "// now" },
	"guide/upgrading-to-2.md | // before (4)": { from: "// now" },
	"guide/upgrading-to-2.md | // before (5)": { noCheck: `${BEFORE_AND_AFTER}, and its 2.0 half registers on the \`engine\` it declares after` },
	"guide/upgrading-to-2.md | // before (6)": { noCheck: `${BEFORE_AND_AFTER}, and both halves are one member of a package literal` },
	"guide/upgrading-to-2.md | // before (7)": { noCheck: `${BEFORE_AND_AFTER}, and both halves are members of a package literal beside a parselet's body` },
	'guide/upgrading-to-2.md | import { pluginFunctionIndexFor } from "solve-engine/vm";': { prelude: "declare const packageName: string;" },
	"guide/upgrading-to-2.md | // a snapshot from a full engine": { prelude: SNAPSHOT },
};

/** The package the installation page imports as `./my-package`, the smallest one the engine accepts. */
const MY_PACKAGE_SOURCE = `import type { IEnginePackage } from "solve-engine";\nexport const myPackage: IEnginePackage = { name: "my-package", engineVersion: "^2.0.0" };\n`;

// ── The real guides ──────────────────────────────────────────────────────

const pages = DIRECTORIES.flatMap((dir) =>
	fs
		.readdirSync(path.join(DOCS, dir))
		.filter((file) => /\.mdx?$/.test(file))
		.sort()
		.map((file) => `${dir}/${file}`),
);
const fences = pages.flatMap((page) => extractFences(page, fs.readFileSync(path.join(DOCS, page), "utf8")));
const keys = new Map(fences.map((fence) => [fence, keyOf(fence, fences)]));
const byKey = new Map(fences.map((fence) => [keys.get(fence)!, fence]));

let exportsCache: Map<string, string> | null = null;
/** Every public name, and the entry it is imported from. */
function publicNames(): Map<string, string> {
	exportsCache ??= publicExportNames(ENGINE_ROOT, ENTRIES);
	return exportsCache;
}

/** A fence's full source: the imports the guides take as given, the manifest's prelude, the fence it continues, and the fence. */
function sourceOf(fence: GuideFence): string {
	const treatment = MANIFEST[keys.get(fence)!] ?? {};
	const continued = treatment.continues !== undefined ? byKey.get(treatment.continues)?.code ?? "" : "";
	const own = fenceSource(fence, treatment, continued);
	const given = givenImports(own, publicNames());
	return given === "" ? own : `${given}\n${own}`;
}

/** The fences the harness itself must fail or pass, compiled in the same program as the guides. */
const HOSTILE = {
	typeError: `import { createEngine } from "solve-engine";\nconst n: string = createEngine().evaluateExpression("1");\nexport { n };\n`,
	deepImport: `import { ExpressionEngine } from "solve-engine/engine/ExpressionEngine";\nexport { ExpressionEngine };\n`,
	missingName: `const x = notDefinedAnywhere + 1;\nexport { x };\n`,
	widenedLiteral: `import { formatValue } from "solve-engine/format";\nimport { createEngine } from "solve-engine";\nconst o = { wordsResult: { spelling: "engine" } };\nexport const t = formatValue(createEngine().evaluateExpression("1"), o);\n`,
};

let compiled: Map<string, string[]> | null = null;
function diagnostics(): Map<string, string[]> {
	if (compiled !== null) return compiled;
	const sources = new Map<string, string>([["my-package.ts", MY_PACKAGE_SOURCE]]);
	fences.forEach((fence, i) => {
		if (MANIFEST[keys.get(fence)!]?.noCheck === undefined) sources.set(`fence${i}.ts`, sourceOf(fence));
	});
	for (const [name, text] of Object.entries(HOSTILE)) sources.set(`hostile-${name}.ts`, text);
	compiled = compileFences(ENGINE_ROOT, sources);
	return compiled;
}

describe("every ts fence in the developer guides", () => {
	test("the manifest names only fences that exist, so it cannot drift from the pages", () => {
		expect(Object.keys(MANIFEST).filter((key) => !byKey.has(key))).toEqual([]);
		for (const treatment of Object.values(MANIFEST)) {
			if (treatment.continues !== undefined) expect(byKey.has(treatment.continues)).toBe(true);
			if (treatment.noCheck !== undefined) expect(treatment.noCheck.length).toBeGreaterThan(20);
		}
	});

	test("there are fences to check on both directories, and few go unchecked", () => {
		expect(fences.length).toBeGreaterThan(100);
		for (const dir of DIRECTORIES) expect(fences.some((f) => f.page.startsWith(`${dir}/`))).toBe(true);
		const unchecked = Object.values(MANIFEST).filter((t) => t.noCheck !== undefined).length;
		expect(unchecked).toBeLessThan(fences.length / 10);
	});

	test("each compiles under strict against the public entry points", () => {
		const d = diagnostics();
		const failures = fences
			.map((fence, i) => ({ key: keys.get(fence)!, line: fence.line, errors: d.get(`fence${i}.ts`) ?? [] }))
			.filter((f) => f.errors.length > 0);
		expect(failures).toEqual([]);
	}, 240_000);

	test("every directory of docs with ts fences is checked by this spec or by the package-guide spec", () => {
		const withFences = fs
			.readdirSync(DOCS, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.filter((dir) =>
				fs.readdirSync(path.join(DOCS, dir)).some((file) => /\.mdx?$/.test(file) && extractFences(file, fs.readFileSync(path.join(DOCS, dir, file), "utf8")).length > 0),
			);
		// The syntax pages' few ts fences are host configuration beside the
		// proven solve blocks; architecture and contributing describe the repo
		// rather than the published surface.
		const elsewhere = new Set(["syntax", "architecture", "contributing"]);
		expect(withFences.filter((dir) => !DIRECTORIES.includes(dir) && dir !== "packages" && !elsewhere.has(dir))).toEqual([]);
		expect(withFences).toEqual(expect.arrayContaining([...DIRECTORIES, "packages"]));
	});
});

// ── The parts ────────────────────────────────────────────────────────────

describe("fenceSource, the treatments this spec adds", () => {
	const fence = (code: string): GuideFence => ({ page: "p.md", index: 1, code, line: 1 });

	test("a function body is wrapped in an async function, with its imports hoisted out", () => {
		const out = fenceSource(fence('import { a } from "b";\nreturn a;'), { wrap: "function-body" });
		expect(out).toBe('import { a } from "b";\nexport async function __fragment(): Promise<unknown> {\nreturn a;\n}\nexport {};');
	});

	test("a class member is wrapped in a class, after the members it reads", () => {
		const out = fenceSource(fence("m() { return this.c; }"), { wrap: "class-member", members: "c = 1;" });
		expect(out).toContain("class __Fragment {\nc = 1;\nm() { return this.c; }\n}");
	});

	test("from compiles the fence from its marker, and a missing marker compiles to a failure", () => {
		expect(fenceSource(fence("// before\nold();\n// now\nnew_();"), { from: "// now" })).toBe("// now\nnew_();\nexport {};");
		expect(fenceSource(fence("old();"), { from: "// now" })).toContain("throw new Error");
		// The marker's text never reaches the generated source: a fixed line does.
		expect(fenceSource(fence(""), { from: "// now" })).toContain(MISSING_MARKER_SOURCE);
		expect(fenceSource(fence(""), { from: '"); process.exit(1); ("' })).not.toContain("process.exit");
	});

	test("prototype words as a marker or a member are text", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(fenceSource(fence(`${word}\nx;`), { from: word })).toBe(`${word}\nx;\nexport {};`);
			expect(fenceSource(fence("x;"), { wrap: "class-member", members: `${word} = 1;` })).toContain(`${word} = 1;`);
		}
		expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
	});
});

describe("fenceNames", () => {
	test("reads every top-level declaration shape, and every identifier mentioned", () => {
		const { declared, mentioned } = fenceNames(
			'import d, { a, b as c } from "m";\nimport * as ns from "n";\nconst { e, f: [g] } = h;\nfunction i() {}\nclass J {}\ninterface K {}\ntype L = 1;\nenum M {}\nk(q);',
		);
		expect([...declared].sort()).toEqual(["J", "K", "L", "M", "a", "c", "d", "e", "g", "i", "ns"].sort());
		expect(mentioned.has("h")).toBe(true);
		expect(mentioned.has("q")).toBe(true);
	});

	test("an empty fence, and a fence that does not parse, declare nothing and do not throw", () => {
		expect(fenceNames("").declared.size).toBe(0);
		expect(() => fenceNames("const = = ;")).not.toThrow();
		expect(fenceNames("{{{").declared.size).toBe(0);
	});
});

describe("givenImports", () => {
	const names = new Map([
		["createEngine", "solve-engine"],
		["formatValue", "solve-engine/format"],
		["numberValue", "solve-engine/vm"],
	]);

	test("imports each public name the fence reads and does not declare, grouped by entry, and the given engine", () => {
		expect(givenImports("formatValue(engine.evaluateExpression(\"1\"));", names)).toBe(
			'import { formatValue } from "solve-engine/format";\nimport type { ExpressionEngine as __GivenEngine } from "solve-engine";\ndeclare const engine: __GivenEngine;',
		);
	});

	test("a name the fence declares or imports itself is left alone, and a fence that needs nothing gets nothing", () => {
		expect(givenImports('import { formatValue } from "x";\nconst engine = createEngine();\nformatValue(engine);', names)).toBe('import { createEngine } from "solve-engine";');
		expect(givenImports("const x = 1;", names)).toBe("");
		expect(givenImports("", names)).toBe("");
	});

	test("prototype words are never imported, since no entry exports them", () => {
		for (const word of PROTOTYPE_WORDS) expect(givenImports(`${word}(1);`, names)).toBe("");
	});
});

describe("publicExportNames", () => {
	test("finds values and type-only exports, each at the first entry that has it", () => {
		const out = publicNames();
		expect(out.get("createEngine")).toBe("solve-engine");
		expect(out.get("IEnginePackage")).toBe("solve-engine");
		expect(out.get("WorkerEngine")).toBe("solve-engine/worker");
		expect(out.get("createQueryResolver")).toBe("solve-engine/resolvers");
		expect(out.has("constructor")).toBe(false);
	}, 120_000);

	test("an entry that does not exist exports nothing, and does not throw", () => {
		expect(publicExportNames(ENGINE_ROOT, ["solve-engine/not-an-entry"]).size).toBe(0);
		expect(publicExportNames(ENGINE_ROOT, []).size).toBe(0);
	}, 120_000);
});

// ── Adversarial: the harness fails what it should ────────────────────────

describe("adversarial: the harness", () => {
	test("a type error, a deep import, an undefined name and a widened literal are each reported", () => {
		const d = diagnostics();
		expect(d.get("hostile-typeError.ts")?.join("\n")).toContain("TS2322");
		expect(d.get("hostile-deepImport.ts")?.join("\n")).toMatch(/TS2307|TS2305|Cannot find module/);
		expect(d.get("hostile-missingName.ts")?.join("\n")).toContain("TS2304");
		// The shape formatting.md had: an options object built untyped widens
		// "engine" to string, which the settings type refuses.
		expect(d.get("hostile-widenedLiteral.ts")?.join("\n")).toContain("TS2345");
	}, 240_000);

	test("a fence the manifest does not check is not compiled, so its sketch cannot hide a real error elsewhere", () => {
		const d = diagnostics();
		fences.forEach((fence, i) => {
			if (MANIFEST[keys.get(fence)!]?.noCheck !== undefined) expect(d.has(`fence${i}.ts`)).toBe(false);
		});
	}, 240_000);
});
