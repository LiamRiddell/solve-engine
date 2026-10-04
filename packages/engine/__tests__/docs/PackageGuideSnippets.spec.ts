import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { EngineError } from "@solve-js/errors/EngineError";
import { Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { createTestEngine } from "@solve-js/testing";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import {
	annotatedStatement,
	compileFences,
	extractFences,
	fenceSource,
	isPackageLike,
	runFence,
	statedOutcomes,
	type FenceTreatment,
	type GuideFence,
} from "@tools/guideSnippets";
import { PROTOTYPE_WORDS } from "@tools/adversarial";

/**
 * The TypeScript in the package-author guides, proven (#772).
 *
 * The syntax pages' examples are evaluated at build time (DocExamples.spec.ts);
 * the package guides' TypeScript was not, and six places showed or claimed what
 * the engine does not do, the first of them a contract example the running
 * engine refuses (`engineVersion: "^1.0.0"`). Every ` ```ts ` fence under
 * `docs/src/content/docs/packages/` is now compiled under `strict` against the
 * engine's public entry points, the fences that build something are run, every
 * package they export is registered the way a test registers it (so a refusal
 * throws), and every outcome they state is checked: a statement annotated
 * `; // RESULT`, and a sentence of the shape `` `EXPR` now reads `RESULT` ``.
 *
 * A fence that is not a whole module is described below, by the page and its
 * first line, so a fence added elsewhere on the page does not move another's
 * entry. A new fence that is a whole module needs no entry.
 */

const ENGINE_ROOT = path.resolve(__dirname, "../..");
const GUIDES = path.resolve(ENGINE_ROOT, "../../docs/src/content/docs/packages");

/** A fence's key: its page and its first line, with ` (2)` for the second fence on a page that starts the same way. */
function keyOf(fence: GuideFence, all: readonly GuideFence[]): string {
	const first = fence.code.split("\n")[0].trim();
	const same = all.filter((f) => f.page === fence.page && f.code.split("\n")[0].trim() === first);
	const position = same.indexOf(fence) + 1;
	return `${fence.page} | ${first}${position > 1 ? ` (${position})` : ""}`;
}

const VM_TYPES = `import type { Value, LineExecutionContext } from "solve-engine/vm";`;
const PARSELET_TYPES = `import type { Parser, BytecodeBuilder } from "solve-engine/parser";\nimport type { Token } from "solve-engine/lexer";`;
const A_PACKAGE = `import type { IEnginePackage } from "solve-engine";\nconst myPackage: IEnginePackage = { name: "my-package", engineVersion: "^2.0.0" };`;

/** The fences that are not whole modules, and what each needs. */
const MANIFEST: Record<string, FenceTreatment> = {
	"as-converters.md | asConverters?: Record<string, (value: Value, context?: LineExecutionContext) => Value>;": { wrap: "interface-member", prelude: VM_TYPES },
	'authoring-a-package.md | engine.evaluateExpression("vat()");      // vat() takes 1 argument, but was given none': {
		continues: 'authoring-a-package.md | import { createEngine, defineFunction } from "solve-engine";',
	},
	'authoring-a-package.md | import { createEngine } from "solve-engine";': { prelude: A_PACKAGE },
	'authoring-a-package.md | import { ExpressionEngine } from "solve-engine";': { prelude: A_PACKAGE },
	"explaining-steps.md | explain?: (call: ExplainCall, context: ExplainContext) => readonly ExplanationStep[] | undefined;": {
		wrap: "interface-member",
		prelude: `import type { ExplainCall, ExplainContext, ExplanationStep } from "solve-engine";`,
	},
	"functions-and-operators.md | interface PrefixParselet {": { prelude: PARSELET_TYPES },
	"functions-and-operators.md | type PluginFunctionHandler = (args: Value[], context?: LineExecutionContext) => Value | Promise<Value>;": { prelude: VM_TYPES },
	"functions-and-operators.md | interface InfixParselet {": { prelude: PARSELET_TYPES },
	"functions-and-operators.md | class BinaryOpParselet implements InfixParselet {": {
		prelude: `import type { InfixParselet, Parser, BytecodeBuilder } from "solve-engine/parser";\nimport { BindingPower, OpCode } from "solve-engine/parser";\nimport type { Token } from "solve-engine/lexer";`,
	},
	"highlighting-and-completions.md | tokenCategories: {": { wrap: "package-member" },
	"highlighting-and-completions.md | completionItems: [": { wrap: "package-member" },
	'highlighting-and-completions.md | import { LanguageService } from "solve-engine/language";': {
		prelude: `import { createEngine } from "solve-engine";\nconst engine = createEngine();`,
	},
	'recognising-phrases.md | import type { IEnginePackage } from "solve-engine";': {
		prelude: `import type { PrefixParselet } from "solve-engine/parser";\ndeclare const AggregateParselet: new (kind: number) => PrefixParselet;\ndeclare const TOTAL: number;\ndeclare const AVERAGE: number;`,
		noRun: "AggregateParselet, TOTAL and AVERAGE are the page's sketch of the built-in aggregate parselet, declared rather than defined",
	},
	"recognising-phrases.md | callFusions: {": { wrap: "package-member" },
	'testing-a-package.md | const result = expectExpression(engine, "10 gp * 3").toEvaluate().value;': {
		continues: 'testing-a-package.md | import { createTestEngine, expectExpression } from "solve-engine/testing";',
	},
	'testing-a-package.md | import { expectPackage } from "solve-engine/testing";': { prelude: `import { myPackage } from "./my-package";` },
	"unit-aliases.md | unitAliases?: Readonly<Record<string, string>>;": { wrap: "interface-member" },
	"units-and-keywords.md | export const myPackage: IEnginePackage = {": { prelude: `import type { IEnginePackage } from "solve-engine";` },
	'units-and-keywords.md | lexerVocabulary: { keywords: { prev: "PREV" } }': { wrap: "package-member" },
	"units-and-keywords.md | export const myPackage: IEnginePackage = { (2)": {
		prelude: `import type { IEnginePackage } from "solve-engine";\nimport type { PrefixParselet } from "solve-engine/parser";\ndeclare const PrevParselet: new () => PrefixParselet;`,
		noRun: "PrevParselet is the page's sketch of the built-in lines package's parselet, and `prev` is that package's keyword",
	},
};

/** The package the testing guide imports as `./my-package`: a unit, the smallest thing `2 gp + 3 gp` needs. */
const MY_PACKAGE_SOURCE = `import type { IEnginePackage } from "solve-engine";\nexport const myPackage: IEnginePackage = { name: "my-package", engineVersion: "^2.0.0", lexerVocabulary: { units: ["gp"] } };\n`;
const MY_PACKAGE: IEnginePackage = { name: "my-package", engineVersion: "^2.0.0", lexerVocabulary: { units: ["gp"] } };

/** Bind a fence's imports to the engine's own modules, the way the published subpaths map onto them. */
function load(specifier: string): unknown {
	if (specifier === "solve-engine") return require("@solve-js/api");
	if (specifier === "./my-package") return { myPackage: MY_PACKAGE };
	if (specifier.startsWith("solve-engine/")) return require(`@solve-js/${specifier.slice("solve-engine/".length)}`);
	throw new Error(`A guide fence imports "${specifier}", which is not a public subpath`);
}

/** A value as a guide states it: a Value as the engine formats it without the `= `, an error by its message, anything else as JSON. */
function asStated(actual: unknown): string[] {
	if (actual instanceof Value) {
		const text = formatValue(actual).replace(/^=\s*/, "");
		return actual.isError() ? [text, String(actual.errorMessage ?? "")] : [text];
	}
	if (actual instanceof Error) return [actual.message];
	return [JSON.stringify(actual), String(actual)];
}

/** Whether `actual` is what the guide states: the same text, or the same JSON however it is spaced. */
function matchesStated(actual: unknown, expected: string): boolean {
	if (asStated(actual).includes(expected)) return true;
	try {
		return JSON.stringify(JSON.parse(expected)) === JSON.stringify(actual);
	} catch {
		return false;
	}
}

/** Register each package on its own test engine, which throws on a refusal, and answer the refusals. */
function refusals(packages: readonly { name: string }[]): string[] {
	const out: string[] = [];
	for (const pkg of packages) {
		try {
			createTestEngine([pkg as IEnginePackage]).clear();
		} catch (error) {
			out.push(`${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return out;
}

/** Each stated `EXPR now reads RESULT` on a page that the engine, with the page's packages, does not give. */
function driftedOutcomes(text: string, packages: readonly { name: string }[]): string[] {
	const out: string[] = [];
	for (const { expression, expected } of statedOutcomes(text)) {
		let actual: string;
		const engine = createTestEngine(packages as IEnginePackage[]);
		try {
			actual = formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
		} catch (error) {
			actual = `threw ${error instanceof EngineError ? error.code : String(error)}`;
		} finally {
			engine.clear();
		}
		if (actual !== expected) out.push(`\`${expression}\` is stated to read \`${expected}\`, and reads \`${actual}\``);
	}
	return out;
}

// ── The real guides ──────────────────────────────────────────────────────

const pages = fs.readdirSync(GUIDES).filter((f) => f.endsWith(".md")).sort();
const texts = new Map(pages.map((page) => [page, fs.readFileSync(path.join(GUIDES, page), "utf8")]));
const fences = pages.flatMap((page) => extractFences(page, texts.get(page)!));
const keys = new Map(fences.map((fence) => [fence, keyOf(fence, fences)]));
const byKey = new Map(fences.map((fence) => [keys.get(fence)!, fence]));

/** A fence's full source, with the fence it continues put before it. */
function sourceOf(fence: GuideFence): string {
	const treatment = MANIFEST[keys.get(fence)!] ?? {};
	const continued = treatment.continues !== undefined ? byKey.get(treatment.continues)?.code ?? "" : "";
	return fenceSource(fence, treatment, continued);
}

/** The adversarial fences the harness itself must fail, compiled in the same program as the guides. */
const HOSTILE = {
	typeError: `import { numberValue } from "solve-engine/vm";\nconst n: string = numberValue(1);\nexport { n };\n`,
	deepImport: `import { ExpressionEngine } from "solve-engine/engine/ExpressionEngine";\nexport { ExpressionEngine };\n`,
	refusedVersion: `import type { IEnginePackage } from "solve-engine";\nexport const old: IEnginePackage = { name: "guide-old", engineVersion: "^1.0.0" };\n`,
};

let compiled: Map<string, string[]> | null = null;
function diagnostics(): Map<string, string[]> {
	if (compiled !== null) return compiled;
	const sources = new Map<string, string>([["my-package.ts", MY_PACKAGE_SOURCE]]);
	fences.forEach((fence, i) => sources.set(`fence${i}.ts`, sourceOf(fence)));
	for (const [name, text] of Object.entries(HOSTILE)) sources.set(`hostile-${name}.ts`, text);
	compiled = compileFences(ENGINE_ROOT, sources);
	return compiled;
}

describe("every ts fence in the package guides", () => {
	test("the manifest names only fences that exist, so it cannot drift from the pages", () => {
		const missing = Object.keys(MANIFEST).filter((key) => !byKey.has(key));
		expect(missing).toEqual([]);
		for (const treatment of Object.values(MANIFEST)) {
			if (treatment.continues !== undefined) expect(byKey.has(treatment.continues)).toBe(true);
		}
	});

	test("there are fences to prove on every page", () => {
		expect(fences.length).toBeGreaterThan(25);
		for (const page of pages) expect(fences.some((f) => f.page === page)).toBe(true);
	});

	test("each compiles under strict against the public entry points", () => {
		const d = diagnostics();
		const failures = fences
			.map((fence, i) => ({ key: keys.get(fence)!, line: fence.line, errors: d.get(`fence${i}.ts`) ?? [] }))
			.filter((f) => f.errors.length > 0);
		expect(failures).toEqual([]);
	}, 240_000);

	test("each fence that builds something runs, registers what it exports, and gives what it states", async () => {
		const problems: string[] = [];
		const exportedByPage = new Map<string, { name: string }[]>();
		for (const fence of fences) {
			const key = keys.get(fence)!;
			const treatment = MANIFEST[key] ?? {};
			if (treatment.noRun !== undefined || treatment.wrap !== undefined) continue;
			const run = await runFence(sourceOf(fence), load);
			if (run.error !== undefined) {
				problems.push(`${key}: threw ${run.error instanceof Error ? run.error.message : String(run.error)}`);
				continue;
			}
			for (const { statement, expected, actual } of run.outcomes) {
				if (!matchesStated(actual, expected)) problems.push(`${key}: \`${statement}\` is stated as ${expected}, and gives ${asStated(actual)[0]}`);
			}
			const packages = Object.values(run.exports).filter(isPackageLike);
			for (const refusal of refusals(packages)) problems.push(`${key}: the engine refuses ${refusal}`);
			exportedByPage.set(fence.page, [...(exportedByPage.get(fence.page) ?? []), ...packages]);
		}
		for (const page of pages) {
			for (const drift of driftedOutcomes(texts.get(page)!, exportedByPage.get(page) ?? [])) problems.push(`${page}: ${drift}`);
		}
		expect(problems).toEqual([]);
	}, 120_000);

	test("the outcomes the guides state are found, so a sentence reworded out of the shape is noticed", () => {
		const stated = pages.flatMap((page) => statedOutcomes(texts.get(page)!).map((o) => `${page}: ${o.expression}`));
		expect(stated).toEqual(
			expect.arrayContaining([
				"as-converters.md: 7 as tally",
				"functions-and-operators.md: double(21)",
				"functions-and-operators.md: :double = 4",
				"units-and-keywords.md: shout: it's 5 o'clock (really)",
			]),
		);
	});
});

// ── The harness's parts ──────────────────────────────────────────────────

describe("extractFences", () => {
	test("reads ts and typescript fences in order, with their first line", () => {
		const page = "text\n```ts\na;\n```\n```solve\n1\n```\n```typescript\nb;\nc;\n```\n";
		const out = extractFences("p.md", page);
		expect(out.map((f) => [f.index, f.code, f.line])).toEqual([[1, "a;", 3], [2, "b;\nc;", 9]]);
	});

	test("a page with none, an empty fence, CRLF, and an unclosed fence", () => {
		expect(extractFences("p.md", "")).toEqual([]);
		expect(extractFences("p.md", "```ts\n```").map((f) => f.code)).toEqual([""]);
		expect(extractFences("p.md", "```ts\r\nx;\r\n```\r\n").map((f) => f.code)).toEqual(["x;"]);
		expect(extractFences("p.md", "```ts\nx;\ny;").map((f) => f.code)).toEqual(["x;\ny;"]);
	});
});

describe("statedOutcomes", () => {
	test("reads the sentence shape in prose, and not inside a fence", () => {
		const page = "`1 + 1` now reads `2`.\n```ts\n// `3` now reads `3`\n```\n`a` now\nreads `b`";
		expect(statedOutcomes(page)).toEqual([{ expression: "1 + 1", expected: "2" }, { expression: "a", expected: "b" }]);
	});

	test("an empty page and prototype-named text", () => {
		expect(statedOutcomes("")).toEqual([]);
		for (const word of PROTOTYPE_WORDS) {
			expect(statedOutcomes(`\`${word}\` now reads \`x\``)).toEqual([{ expression: word, expected: "x" }]);
		}
	});
});

describe("annotatedStatement", () => {
	test("a statement with its result on the line, or on the next", () => {
		expect(annotatedStatement('engine.evaluateExpression("vat(100)"); // 120', undefined)).toEqual({ statement: 'engine.evaluateExpression("vat(100)")', expected: "120" });
		expect(annotatedStatement("x.steps.map((s) => s.d);", '// ["a"]')).toEqual({ statement: "x.steps.map((s) => s.d)", expected: '["a"]' });
	});

	test("a declaration, an indented line, a comment and a bare statement state nothing", () => {
		expect(annotatedStatement("const x = 1; // one", undefined)).toBeNull();
		expect(annotatedStatement("  builder.emit(1); // 1 = argument count", undefined)).toBeNull();
		expect(annotatedStatement("// a comment", undefined)).toBeNull();
		expect(annotatedStatement("run();", "run();")).toBeNull();
		expect(annotatedStatement("", undefined)).toBeNull();
	});
});

describe("fenceSource", () => {
	const fence: GuideFence = { page: "p.md", index: 1, code: "tokenCategories: { A: \"keyword\" }", line: 1 };

	test("a package member is wrapped in a package literal, an interface member in an interface", () => {
		expect(fenceSource(fence, { wrap: "package-member" })).toContain("const __fragment: __Package = {");
		expect(fenceSource({ ...fence, code: "x?: number;" }, { wrap: "interface-member" })).toContain("interface __Fragment {\nx?: number;\n}");
	});

	test("prelude and continued code come first, and the result is always a module", () => {
		const out = fenceSource({ ...fence, code: "b;" }, { prelude: "p;" }, "a;");
		expect(out).toBe("p;\na;\nb;\nexport {};");
	});
});

describe("runFence", () => {
	test("records a stated statement's value and the exports", async () => {
		const run = await runFence('export const k = 2;\nMath.max(1, 3); // 3\n', load);
		expect(run.error).toBeUndefined();
		expect(run.exports.k).toBe(2);
		expect(run.outcomes).toEqual([{ statement: "Math.max(1, 3)", expected: "3", actual: 3 }]);
	});

	test("a statement that throws records the error, and a fence that throws is caught", async () => {
		const stated = await runFence('JSON.parse("{"); // never\n', load);
		expect(stated.outcomes[0].actual).toBeInstanceOf(Error);
		const thrown = await runFence('throw new Error("boom");\n', load);
		expect((thrown.error as Error).message).toBe("boom");
	});

	test("a top-level await runs", async () => {
		const run = await runFence("export const v = await Promise.resolve(7);\n", load);
		expect(run.exports.v).toBe(7);
	});

	test("an import of a path that is not a public subpath is refused by name", async () => {
		const run = await runFence('import { x } from "left-pad";\nexport { x };\n', load);
		expect(String((run.error as Error).message)).toContain("not a public subpath");
	});

	test("a fence cannot reach Object.prototype through its exports", async () => {
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		await runFence('export const __proto__x = { constructor: 1, toString: 2 };\n', load);
		expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
	});
});

describe("isPackageLike", () => {
	test("an object with a string name, and nothing else", () => {
		expect(isPackageLike({ name: "p" })).toBe(true);
		for (const v of [null, undefined, 1, "p", { name: 1 }, [], () => 1]) expect(isPackageLike(v)).toBe(false);
	});
});

// ── Adversarial: the harness fails what it should ────────────────────────

describe("adversarial: the harness", () => {
	test("a fence that compiles but registers a package the engine refuses fails", async () => {
		const d = diagnostics();
		expect(d.get("hostile-refusedVersion.ts")).toEqual([]);
		const run = await runFence(HOSTILE.refusedVersion, load);
		const found = refusals(Object.values(run.exports).filter(isPackageLike));
		expect(found).toEqual([expect.stringContaining('declares engineVersion "^1.0.0"')]);
	}, 240_000);

	test("a package whose keyword collides with a built-in is refused", () => {
		expect(refusals([{ name: "guide-collider", lexerVocabulary: { keywords: { sqrt: "MY_SQRT" } } } as IEnginePackage])).toEqual([
			expect.stringContaining('Plugin keyword "sqrt" conflicts with built-in keyword'),
		]);
	});

	test("a stated outcome that drifts is reported", () => {
		expect(driftedOutcomes("`1 + 1` now reads `3`.", [])).toEqual(["`1 + 1` is stated to read `3`, and reads `2`"]);
		expect(driftedOutcomes("`1 +` now reads `1`.", [])[0]).toContain("threw");
		expect(driftedOutcomes("`1 + 1` now reads `2`.", [])).toEqual([]);
	});

	test("a type error in a fence is reported", () => {
		expect(diagnostics().get("hostile-typeError.ts")?.join("\n")).toContain("TS2322");
	}, 240_000);

	test("a deep import past the public entry points does not resolve", () => {
		expect(diagnostics().get("hostile-deepImport.ts")?.join("\n")).toMatch(/TS2307|TS2305|Cannot find module/);
	}, 240_000);

	test("a stated statement whose value drifts is reported", async () => {
		const run = await runFence('import { createEngine } from "solve-engine";\nconst engine = createEngine();\nengine.evaluateExpression("2 + 2"); // 5\n', load);
		expect(asStated(run.outcomes[0].actual)).not.toContain("5");
		expect(asStated(run.outcomes[0].actual)).toContain("4");
	});
});
