import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { build } from "esbuild";
import { PUBLIC_ENTRIES, packageEntries } from "../../buildEntries";
import * as builtins from "@solve-js/packages/builtins";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #716: every built-in package sat in one chunk of the ESM build, about
 * 330 KB, because every one of them is reached by the same entries (the root
 * through `createEngine`, `solve-engine/packages`, the worker), and esbuild
 * splits by which entries reach a module. esbuild drops a file whose bindings
 * nothing uses and keeps a file it keeps whole, so an arithmetic-only engine
 * bundled with it came to 907,514 bytes minified against 908,192 for
 * `createEngine()`: 678 bytes saved, measured from the built dist on this
 * spec's machine.
 *
 * Each built-in package is now a build entry of its own (`buildEntries.ts`),
 * which gives it a set of entries of its own and so chunks of its own. The
 * same slim consumer then bundles to 576,069 bytes under esbuild. The entries
 * are not published subpaths.
 *
 * The end-to-end case below builds the engine from source the way tsup does
 * (esbuild, ESM, splitting), with and without the per-package entries, and
 * bundles the two consumers against each, so the property is proven on every
 * run rather than read off a committed figure.
 */

const ENGINE_ROOT = path.resolve(__dirname, "../..");

// ── packageEntries (unit) ────────────────────────────────────────────────

describe("packageEntries", () => {
	let scratch: string;
	beforeAll(() => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), "solve-716-"));
		const mk = (rel: string, withIndex: boolean) => {
			fs.mkdirSync(path.join(scratch, "src", "packages", rel), { recursive: true });
			if (withIndex) fs.writeFileSync(path.join(scratch, "src", "packages", rel, "index.ts"), "export {};\n");
		};
		mk("arithmetic", true);
		mk("fuel", true);
		mk("helpers", false);
		mk("__proto__", true);
		mk("constructor", true);
		mk("bad name", true);
		mk("..dots", true);
		fs.writeFileSync(path.join(scratch, "src", "packages", "builtins.ts"), "export {};\n");
	});
	afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

	test("ordinary: one entry per package directory with an index.ts", () => {
		const entries = packageEntries(scratch);
		expect(entries["split/arithmetic"]).toBe("src/packages/arithmetic/index.ts");
		expect(entries["split/fuel"]).toBe("src/packages/fuel/index.ts");
	});

	test("boundary: a directory with no index.ts, and a file, are left out", () => {
		const keys = Object.keys(packageEntries(scratch));
		expect(keys).not.toContain("split/helpers");
		expect(keys.some((k) => k.includes("builtins"))).toBe(false);
	});

	test("hostile: a name that is not a plain file name is left out, and a prototype word is an ordinary key", () => {
		expectPrototypeUntouched(() => {
			const entries = packageEntries(scratch);
			const keys = Object.keys(entries).sort();
			expect(keys).toEqual(["split/__proto__", "split/arithmetic", "split/constructor", "split/fuel"]);
			expect(Object.getPrototypeOf(entries)).toBe(Object.prototype);
			for (const word of PROTOTYPE_WORDS) expect(Object.prototype.hasOwnProperty.call(entries, word)).toBe(false);
		});
	});

	test("hostile: a missing directory throws the file system's own error, not a wrong entry list", () => {
		expect(() => packageEntries(path.join(scratch, "nowhere"))).toThrow(/ENOENT/);
	});

	test("the real tree: every built-in package is an entry, and no entry is a published subpath", () => {
		const entries = packageEntries(ENGINE_ROOT);
		const names = Object.keys(entries).map((k) => k.slice("split/".length));
		// Each package directory the builtins list imports from has its entry.
		const source = fs.readFileSync(path.join(ENGINE_ROOT, "src", "packages", "builtins.ts"), "utf8");
		const imported = [...source.matchAll(/from "\.\/([a-z0-9]+)"/g)].map((m) => m[1]);
		expect(imported.length).toBeGreaterThan(40);
		for (const dir of imported) expect({ dir, entry: names.includes(dir) }).toEqual({ dir, entry: true });
		const exported = Object.keys(JSON.parse(fs.readFileSync(path.join(ENGINE_ROOT, "package.json"), "utf8")).exports);
		for (const key of Object.keys(entries)) expect(exported).not.toContain(`./${key}`);
		for (const key of Object.keys(PUBLIC_ENTRIES)) expect(key.startsWith("split/")).toBe(false);
		// The builtins module still lists every package a host can register.
		expect(Array.isArray(builtins.BUILTIN_PACKAGES)).toBe(true);
	});
});

// ── the split, end to end ────────────────────────────────────────────────

/** Build the engine from source as tsup does, into `outDir`, marked side-effect free as the published package is. */
async function buildEngine(outDir: string, withPackageEntries: boolean): Promise<void> {
	const entryPoints: Record<string, string> = {};
	const entries = { ...PUBLIC_ENTRIES, ...(withPackageEntries ? packageEntries(ENGINE_ROOT) : {}) };
	for (const [out, src] of Object.entries(entries)) entryPoints[out] = path.join(ENGINE_ROOT, src);
	await build({
		entryPoints,
		outdir: outDir,
		bundle: true,
		format: "esm",
		splitting: true,
		platform: "node",
		target: "es2020",
		minify: true,
		external: ["@tanstack/query-core"],
		tsconfig: path.join(ENGINE_ROOT, "tsconfig.json"),
		logLevel: "silent",
	});
	fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module", sideEffects: false }));
}

/** Minified bytes of a consumer bundled with esbuild against a build in `outDir`. */
async function consumerBytes(outDir: string, source: string): Promise<number> {
	const result = await build({
		stdin: { contents: source, resolveDir: outDir, loader: "js" },
		bundle: true,
		format: "esm",
		platform: "neutral",
		minify: true,
		write: false,
		external: ["@tanstack/query-core"],
		logLevel: "silent",
	});
	return result.outputFiles[0].contents.length;
}

const FULL = 'import { createEngine } from "./index.js";\nconsole.log(createEngine().evaluateExpression("2 + 2").toNumber());\n';
const SLIM =
	'import { ExpressionEngine } from "./index.js";\nimport { ARITHMETIC_PACKAGE } from "./packages.js";\n' +
	'console.log(new ExpressionEngine({ packages: [ARITHMETIC_PACKAGE] }).evaluateExpression("2 + 2").toNumber());\n';

describe("a slim engine is a size saving under esbuild", () => {
	let root: string;
	beforeAll(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "solve-716-build-"));
	});
	afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

	test("with a build entry per package, an arithmetic-only engine bundles to well under createEngine()", async () => {
		const out = path.join(root, "split");
		await buildEngine(out, true);
		const full = await consumerBytes(out, FULL);
		const slim = await consumerBytes(out, SLIM);
		// Measured at about 0.63; the shared core (lexer, parser, VM, unit table)
		// is in every engine, so it can never approach zero.
		expect(slim / full).toBeLessThan(0.8);
		// No chunk carries every package: the largest is a fraction of the old one.
		const largest = Math.max(...fs.readdirSync(out).filter((f) => f.startsWith("chunk-")).map((f) => fs.statSync(path.join(out, f)).size));
		expect(largest).toBeLessThan(200_000);
	}, 120_000);

	test("without them the packages share a chunk, and the slim engine saves almost nothing (the cause)", async () => {
		const out = path.join(root, "shared");
		await buildEngine(out, false);
		const full = await consumerBytes(out, FULL);
		const slim = await consumerBytes(out, SLIM);
		expect(slim / full).toBeGreaterThan(0.95);
	}, 120_000);
});
