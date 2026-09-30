/**
 * Proving the TypeScript in the package-author guides the way the syntax pages'
 * examples are proven: every ` ```ts ` fence under `docs/src/content/docs/packages/`
 * is compiled under `strict` against the engine's public entry points, and the
 * fences that build something are run, so a package a guide shows that the
 * engine refuses, or an outcome a guide states that the engine no longer gives,
 * fails the build.
 *
 * Three steps, each a function here so it can be tested on its own:
 *
 * - {@link extractFences} reads a page's fences.
 * - {@link compileFences} type-checks them in one program. `solve-engine` and
 *   each `solve-engine/<name>` subpath resolve to the source file tsup builds
 *   that subpath's published types from (`src/<name>/index.ts`), so a fence
 *   compiles against exactly the surface a package author installs.
 * - {@link runFence} transpiles a fence and runs it with those subpaths bound
 *   to the engine's modules, collecting the packages it exports and the values
 *   of the statements it annotates with an expected result (`...; // 120`).
 *
 * A fence that is a fragment (one member of a package object, one member of an
 * interface) or that continues an earlier fence on the page is described in a
 * manifest the spec keeps, never guessed at here.
 */

import * as path from "node:path";
import * as ts from "typescript";

/** One ` ```ts ` fence, with where it came from. */
export interface GuideFence {
	/** The page's file name, `as-converters.md`. */
	readonly page: string;
	/** Its 1-based position among the page's ts fences. */
	readonly index: number;
	/** The fence's text, without the fence lines. */
	readonly code: string;
	/** The 1-based line of the page the code starts on. */
	readonly line: number;
}

/** How a fence is to be compiled and run, from the spec's manifest. */
export interface FenceTreatment {
	/**
	 * What the fence is when it is not a whole module: one member of an
	 * `IEnginePackage` literal (`tokenCategories: { ... }`), or one member of
	 * an interface (`asConverters?: Record<...>;`). Absent for a module.
	 */
	readonly wrap?: "package-member" | "interface-member";
	/** Code the page leaves to the reader, put before the fence: an import it assumes, or a declared name. */
	readonly prelude?: string;
	/** The key of an earlier fence this one continues, whose code is put before it. */
	readonly continues?: string;
	/** Why the fence is compiled but not run, when it is not (a declared name has no value at run time). */
	readonly noRun?: string;
}

/** The key a fence is known by in a manifest: `as-converters.md#2`. */
export function fenceKey(fence: Pick<GuideFence, "page" | "index">): string {
	return `${fence.page}#${fence.index}`;
}

/**
 * Every ` ```ts ` (or ` ```typescript `) fence on a page, in order. A fence
 * whose closing line is missing runs to the end of the page, as a Markdown
 * renderer would show it.
 */
export function extractFences(page: string, text: string): GuideFence[] {
	const lines = text.split(/\r?\n/);
	const fences: GuideFence[] = [];
	let open: { start: number; body: string[] } | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (open === null) {
			if (/^```(ts|typescript)\b/.test(line)) open = { start: i + 2, body: [] };
			continue;
		}
		if (/^```\s*$/.test(line)) {
			fences.push({ page, index: fences.length + 1, code: open.body.join("\n"), line: open.start });
			open = null;
			continue;
		}
		open.body.push(line);
	}
	if (open !== null) fences.push({ page, index: fences.length + 1, code: open.body.join("\n"), line: open.start });
	return fences;
}

/**
 * The statements in prose a guide makes about an outcome, in its one fixed
 * shape: `` `EXPRESSION` now reads `RESULT` ``. Code inside fences is not
 * read, so an example of the sentence inside a fence is not an assertion.
 */
export function statedOutcomes(text: string): Array<{ expression: string; expected: string }> {
	const prose = text.replace(/^```[\s\S]*?^```\s*$/gm, "");
	const out: Array<{ expression: string; expected: string }> = [];
	for (const m of prose.matchAll(/`([^`\n]+)`\s+now\s+reads\s+`([^`\n]+)`/g)) {
		out.push({ expression: m[1], expected: m[2] });
	}
	return out;
}

/** A fence's full source as compiled: prelude, continued code, the fence (wrapped when a fragment), and a module marker. */
export function fenceSource(fence: GuideFence, treatment: FenceTreatment = {}, continued = ""): string {
	let body = fence.code;
	if (treatment.wrap === "package-member") {
		body = `import type { IEnginePackage as __Package } from "solve-engine";\nconst __fragment: __Package = {\n  name: "fragment",\n${fence.code}\n};\nvoid __fragment;`;
	} else if (treatment.wrap === "interface-member") {
		body = `interface __Fragment {\n${fence.code}\n}\nexport type { __Fragment };`;
	}
	return [treatment.prelude ?? "", continued, body, "export {};"].filter((part) => part !== "").join("\n");
}

/** The engine's public subpaths, each mapped to the source file its published types are built from. */
function publicPaths(engineRoot: string): Record<string, string[]> {
	return {
		"solve-engine": [path.join(engineRoot, "src/api/index.ts")],
		"solve-engine/engine-worker": [path.join(engineRoot, "src/workers/engine.worker.ts")],
		"solve-engine/*": [path.join(engineRoot, "src/*/index.ts")],
		"@solve-js/*": [path.join(engineRoot, "src/*")],
	};
}

/**
 * Type-check `sources` (a file name to its text) in one program under
 * `strict`, and return each file's diagnostics. The files live in a virtual
 * directory beside the engine, so a relative import between two of them
 * (`./my-package`) resolves to the other.
 */
export function compileFences(engineRoot: string, sources: ReadonlyMap<string, string>): Map<string, string[]> {
	const dir = path.join(engineRoot, "__guide_fences__");
	const files = new Map<string, string>();
	for (const [name, text] of sources) files.set(path.join(dir, name), text);
	const options: ts.CompilerOptions = {
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
		types: ["node"],
		typeRoots: [path.join(engineRoot, "../../node_modules/@types")],
		baseUrl: engineRoot,
		paths: publicPaths(engineRoot),
		esModuleInterop: true,
		resolveJsonModule: true,
	};
	const host = ts.createCompilerHost(options);
	const getSourceFile = host.getSourceFile.bind(host);
	const fileExists = host.fileExists.bind(host);
	const readFile = host.readFile.bind(host);
	host.getSourceFile = (name, language, ...rest) => {
		const text = files.get(path.resolve(name));
		return text !== undefined ? ts.createSourceFile(name, text, language) : getSourceFile(name, language, ...rest);
	};
	host.fileExists = (name) => files.has(path.resolve(name)) || fileExists(name);
	// The fences live in a directory that is not on disk; resolving a relative
	// import between two of them asks whether it exists before looking inside.
	const directoryExists = host.directoryExists?.bind(host);
	const underDir = (name: string): boolean => {
		const resolved = path.resolve(name);
		return resolved === dir || resolved.startsWith(dir + path.sep);
	};
	host.directoryExists = (name) => underDir(name) || (directoryExists?.(name) ?? true);
	host.readFile = (name) => files.get(path.resolve(name)) ?? readFile(name);
	const program = ts.createProgram([...files.keys()], options, host);
	const out = new Map<string, string[]>();
	for (const [name] of sources) {
		const file = program.getSourceFile(path.join(dir, name));
		const diagnostics = file === undefined ? [] : [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)];
		out.set(
			name,
			diagnostics.map((d) => {
				const where = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
				const at = where ? `(${where.line + 1},${where.character + 1}) ` : "";
				return `${at}TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
			}),
		);
	}
	return out;
}

/** What running a fence produced: what it exported, and each annotated statement's value beside the result the guide states. */
export interface FenceRun {
	readonly exports: Record<string, unknown>;
	readonly outcomes: Array<{ statement: string; expected: string; actual: unknown }>;
	/** What the fence threw, when it threw. */
	readonly error?: unknown;
}

/**
 * A line that states its result: an unindented expression statement (not a
 * declaration, not a comment) ending `; // RESULT`, or followed by a line that
 * is only `// RESULT`. Returns the statement and the result, or null.
 */
export function annotatedStatement(line: string, next: string | undefined): { statement: string; expected: string } | null {
	const trimmed = line.trim();
	// Only a statement at the top of the fence runs when the fence does; one
	// indented inside a function or a class runs later, if at all, and its
	// comment explains the line rather than stating a result.
	if (/^\s/.test(line)) return null;
	if (trimmed === "" || trimmed.startsWith("//") || /^(import|export|const|let|var|function|class|interface|type|return|if|for|while|\}|\{)\b/.test(trimmed)) return null;
	const same = /^(.*?;)\s*\/\/\s*(.+)$/.exec(trimmed);
	if (same && !same[1].includes("//")) return { statement: same[1].slice(0, -1), expected: same[2].trim() };
	if (trimmed.endsWith(";") && next !== undefined) {
		const comment = /^\s*\/\/\s*(.+)$/.exec(next);
		if (comment) return { statement: trimmed.slice(0, -1), expected: comment[1].trim() };
	}
	return null;
}

/**
 * The constructor of `async function` bodies, for running a fence that awaits
 * at its top level. Read from source text rather than from an arrow function
 * here, since a compiler targeting an older language turns this file's own
 * `async` into a generator, whose constructor is plain `Function`.
 */
const AsyncFunction = new Function("return (async function () {}).constructor")() as new (...args: string[]) => (...values: unknown[]) => Promise<void>;

/**
 * Transpile `source` to CommonJS and run it as the body of an async
 * function, so a fence may `await` at its top level, with each
 * `solve-engine` subpath bound through `load` and the annotated statements'
 * values recorded. A throw or a rejection is caught and returned, never passed
 * on.
 */
export async function runFence(source: string, load: (specifier: string) => unknown): Promise<FenceRun> {
	const lines = source.split("\n");
	const outcomes: Array<{ statement: string; expected: string; actual: unknown }> = [];
	const expectedByIndex: Array<{ statement: string; expected: string }> = [];
	const rewritten = lines.map((line, i) => {
		const found = annotatedStatement(line, lines[i + 1]);
		if (found === null) return line;
		expectedByIndex.push(found);
		const k = expectedByIndex.length - 1;
		return `__record(${k}, () => (${found.statement}));`;
	});
	const js = ts.transpileModule(rewritten.join("\n"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
	}).outputText;
	const exports: Record<string, unknown> = {};
	const record = (k: number, compute: () => unknown): void => {
		let actual: unknown;
		try {
			actual = compute();
		} catch (error) {
			actual = error;
		}
		outcomes.push({ ...expectedByIndex[k], actual });
	};
	try {
		const run = new AsyncFunction("require", "exports", "__record", js);
		await run(load, exports, record);
	} catch (error) {
		return { exports, outcomes, error };
	}
	return { exports, outcomes };
}

/** Whether `value` looks like a package a fence exports: an object with a string `name`. */
export function isPackageLike(value: unknown): value is { name: string } {
	return typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string";
}
