import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { compileFences, runFence } from "@tools/guideSnippets";
import { expectPrototypeUntouched } from "@tools/adversarial";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";

/**
 * Issue #773: no example compiled against the published package. The two
 * example packages import the engine through its internal `@solve-js/*`
 * aliases and are not in the tarball, and the upgrade guide sent readers to
 * one of them.
 *
 * `examples/package-starter` is a third-party starter that imports public
 * subpaths only: a function, a phrase, an `as` converter and a live lookup,
 * tested with `solve-engine/testing` under Node's test runner. The bundled-
 * consumer contract (`scripts/consumer-e2e.mjs`) builds it against the packed
 * tarball and runs its tests. This spec keeps it honest inside the fast suite:
 * it compiles the starter under `strict` against the public entry points,
 * refuses any import that is not one, and runs the starter's own tests
 * against the engine's source.
 */

const ENGINE_ROOT = path.resolve(__dirname, "../..");
const STARTER = path.resolve(ENGINE_ROOT, "../../examples/package-starter");
const SOURCE = fs.readFileSync(path.join(STARTER, "src/index.ts"), "utf8");
const TESTS = fs.readFileSync(path.join(STARTER, "test/starter.test.ts"), "utf8");

/** The public subpaths, as package.json `exports` names them. */
const PUBLIC = new Set(
	Object.keys(JSON.parse(fs.readFileSync(path.join(ENGINE_ROOT, "package.json"), "utf8")).exports as Record<string, unknown>).map((key) =>
		key === "." ? "solve-engine" : `solve-engine/${key.slice(2)}`,
	),
);

/** Every module a file imports, by specifier. */
function importsOf(text: string): string[] {
	return [...text.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
}

/** Bind the starter's imports: public subpaths to the engine's modules, node:test to a collector. */
function loader(collected: Array<[string, () => unknown]>, starterExports?: Record<string, unknown>) {
	return (specifier: string): unknown => {
		if (specifier === "node:test") return { test: (name: string, fn: () => unknown) => collected.push([name, fn]) };
		if (specifier === "../src/index.js" && starterExports) return starterExports;
		if (specifier === "solve-engine") return require("@solve-js/api");
		if (specifier.startsWith("solve-engine/") && PUBLIC.has(specifier)) return require(`@solve-js/${specifier.slice("solve-engine/".length)}`);
		throw new Error(`the starter imports "${specifier}", which is not a public subpath`);
	};
}

/** The starter's module, run against the engine's source. */
async function starterModule(): Promise<Record<string, unknown>> {
	const run = await runFence(SOURCE, loader([]));
	if (run.error !== undefined) throw run.error;
	return run.exports;
}

describe("the starter imports the published surface only", () => {
	test("every engine import is a public subpath, and there is no @solve-js alias", () => {
		const imports = [...importsOf(SOURCE), ...importsOf(TESTS)];
		expect(imports.length).toBeGreaterThan(4);
		for (const specifier of imports) {
			if (specifier.startsWith("node:") || specifier.startsWith(".")) continue;
			expect({ specifier, public: PUBLIC.has(specifier) }).toEqual({ specifier, public: true });
		}
		expect(SOURCE + TESTS).not.toMatch(/@solve-js/);
	});

	test("it compiles under strict against the public entry points", () => {
		const sources = new Map([
			["starter/src/index.ts", SOURCE],
			["starter/test/starter.test.ts", TESTS],
		]);
		const diagnostics = compileFences(ENGINE_ROOT, sources);
		expect(Object.fromEntries(diagnostics)).toEqual({ "starter/src/index.ts": [], "starter/test/starter.test.ts": [] });
	}, 240_000);

	test("its package.json depends on solve-engine by name, within the current major", () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(STARTER, "package.json"), "utf8"));
		expect(manifest.peerDependencies["solve-engine"]).toBe("^2.0.0");
		const engineVersion = JSON.parse(fs.readFileSync(path.join(ENGINE_ROOT, "package.json"), "utf8")).version as string;
		expect(engineVersion.split(".")[0]).toBe("2");
	});
});

describe("the starter's own tests, against the engine's source", () => {
	test("each passes", async () => {
		const exports = await starterModule();
		const collected: Array<[string, () => unknown]> = [];
		const run = await runFence(TESTS, loader(collected, exports));
		expect(run.error).toBeUndefined();
		expect(collected.length).toBeGreaterThanOrEqual(10);
		const failed: string[] = [];
		for (const [name, fn] of collected) {
			try {
				await fn();
			} catch (error) {
				failed.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		expect(failed).toEqual([]);
	}, 60_000);
});

describe("the starter's parts", () => {
	test("placeProblem: ordinary, boundary and hostile names", async () => {
		const { placeProblem, MAX_PLACE_LENGTH } = (await starterModule()) as { placeProblem: (p: unknown) => string | null; MAX_PLACE_LENGTH: number };
		expect(placeProblem("Oslo")).toBeNull();
		expect(placeProblem("  Oslo  ")).toBeNull();
		expect(placeProblem("x".repeat(MAX_PLACE_LENGTH))).toBeNull();
		expect(placeProblem("x".repeat(MAX_PLACE_LENGTH + 1))).toContain("at most");
		for (const hostile of ["../etc", "a\\b", "tab\there", "nul\u0000", "", " "]) expect(placeProblem(hostile)).not.toBeNull();
		for (const wrong of [42, null, undefined, {}, ["Oslo"]]) expect(placeProblem(wrong)).not.toBeNull();
	});

	test("the packages declare a range the running engine satisfies", async () => {
		const { tipFunction, createStarterPackage } = (await starterModule()) as { tipFunction: IEnginePackage; createStarterPackage: (o: unknown) => IEnginePackage };
		expect(tipFunction.engineVersion).toBe("^2.0.0");
		expect(createStarterPackage({ fetchRainfall: async () => 0 }).engineVersion).toBe("^2.0.0");
	});

	test("the live lookup is an async resolver made with createQueryResolver, not a promise from a plugin function", async () => {
		// The starter once returned a promise from its plugin function, because
		// createQueryResolver was not public. It is now, from solve-engine/resolvers,
		// and the starter shows the path an author should copy.
		expect(SOURCE).toMatch(/import \{ createQueryResolver \} from "solve-engine\/resolvers"/);
		expect(SOURCE).not.toMatch(/new Map<string, Promise<Value>>/);
		const { createStarterPackage } = (await starterModule()) as { createStarterPackage: (o: unknown) => IEnginePackage };
		const pkg = createStarterPackage({ fetchRainfall: async () => 0 });
		expect(pkg.asyncResolvers?.length).toBe(1);
		expect(pkg.asyncResolvers?.[0].namespace).toBe("starter");
		// The resolver declares the plugin-call opcodes, so a plain line skips its preflight.
		expect(pkg.asyncResolvers?.[0].watchedOpcodes?.length).toBe(2);
		// A plugin function handed a non-string answers at once, with no promise.
		const { numberValue } = require("@solve-js/vm") as typeof import("@solve-js/vm");
		const answer = pkg.pluginFunctions!.rainfall([numberValue(42)]);
		expect(answer).not.toBeInstanceOf(Promise);
		expect((answer as { value: unknown }).value).toBe("STARTER_BAD_PLACE");
	});

	test("two lines asking for one place share one fetch, and each engine keeps its own answer", async () => {
		const { createStarterPackages } = (await starterModule()) as { createStarterPackages: (o: unknown) => IEnginePackage[] };
		const { createTestEngine, expectDocument } = require("@solve-js/testing") as typeof import("@solve-js/testing");
		const calls: string[] = [];
		const makeEngine = (mm: number) =>
			createTestEngine(
				createStarterPackages({
					fetchRainfall: async (place: string) => {
						calls.push(place);
						return mm;
					},
				}),
			);
		const first = makeEngine(3);
		const second = makeEngine(7);
		const doc = 'rainfall("Oslo")\nrainfall("Oslo") * 2';
		const one = await expectDocument(first, doc);
		one.line(1).toEqual(3, "mm");
		one.line(2).toEqual(6, "mm");
		const two = await expectDocument(second, doc);
		two.line(1).toEqual(7, "mm");
		two.line(2).toEqual(14, "mm");
		// One fetch per engine: the second line read the first line's answer.
		expect(calls).toEqual(["Oslo", "Oslo"]);
		first.clear();
		second.clear();
	});

	test("running the starter leaves Object.prototype alone", async () => {
		const exports = await starterModule();
		expectPrototypeUntouched(() => {
			(exports.placeProblem as (p: unknown) => unknown)("__proto__");
			(exports.placeProblem as (p: unknown) => unknown)("constructor");
		});
	});
});
