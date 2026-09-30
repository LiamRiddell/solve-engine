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

	test("running the starter leaves Object.prototype alone", async () => {
		const exports = await starterModule();
		expectPrototypeUntouched(() => {
			(exports.placeProblem as (p: unknown) => unknown)("__proto__");
			(exports.placeProblem as (p: unknown) => unknown)("constructor");
		});
	});
});
