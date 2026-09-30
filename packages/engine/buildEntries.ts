import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The build's entry points, for `tsup.config.ts`, kept in a module of their
 * own so the ordinary suite can check them
 * (`__tests__/bugs/Issue716_perPackageChunks.spec.ts`).
 */

/** The published entries, each a subpath in package.json's exports, by output name. */
export const PUBLIC_ENTRIES: Readonly<Record<string, string>> = {
	index: "src/api/index.ts",
	engine: "src/engine/index.ts",
	vm: "src/vm/index.ts",
	format: "src/format/index.ts",
	language: "src/language/index.ts",
	packages: "src/packages/index.ts",
	constants: "src/constants/index.ts",
	lexer: "src/lexer/index.ts",
	parser: "src/parser/index.ts",
	normalizer: "src/normalizer/index.ts",
	resolvers: "src/resolvers/index.ts",
	errors: "src/errors/index.ts",
	utilities: "src/utilities/index.ts",
	uom: "src/uom/index.ts",
	services: "src/services/index.ts",
	worker: "src/worker/index.ts",
	testing: "src/testing/index.ts",
	// The Temporal calendar backend. Its own entry so that nothing under
	// src/temporal is reachable from the root entry or any other subpath:
	// a host that never imports it ships none of it.
	temporal: "src/temporal/index.ts",
	// The worker entry. Its own bundle for the same reason as temporal, and
	// a stronger one: it registers the full package vocabulary, which no
	// consumer's main bundle should carry. Nothing else imports it, so it
	// is reachable only by a host that starts a worker from it.
	"engine.worker": "src/workers/engine.worker.ts",
};

/** A package directory name that makes a sane output file name. */
const PACKAGE_DIR = /^[A-Za-z0-9_-]+$/;

/**
 * One build entry per built-in package, `split/<name>` for the package
 * directory `src/packages/<name>` that has an `index.ts`, so each package
 * lands in chunks of its own.
 *
 * esbuild splits by which entries reach a module, and every built-in package
 * is reached by the same ones (the root entry through `createEngine`, the
 * `packages` subpath, the worker), so without these they all shared one chunk
 * of about 330 KB. A bundler that drops files by `sideEffects: false`, as
 * esbuild does, then kept nearly all of it for a host that imported one
 * package: a slim engine was under 1 KB smaller than the full one (#716). An
 * entry of its own gives each package a different set of entries reaching it,
 * and so chunks of its own that a bundler can drop whole.
 *
 * These are not published subpaths: package.json exports none of them, and
 * no declarations are written for them. A host still imports every package
 * from `solve-engine/packages`.
 *
 * @param engineRoot - The engine package's directory, the one holding `src`.
 * @returns Output name to source path, relative to `engineRoot`; a directory
 *   with no `index.ts`, a file, and a name that would not make a plain file
 *   name are left out.
 */
export function packageEntries(engineRoot: string): Record<string, string> {
	const dir = join(engineRoot, "src", "packages");
	const entries: Record<string, string> = {};
	for (const d of readdirSync(dir, { withFileTypes: true })) {
		if (!d.isDirectory() || !PACKAGE_DIR.test(d.name)) continue;
		if (!existsSync(join(dir, d.name, "index.ts"))) continue;
		// Defined, not assigned, so a directory named for an inherited property
		// is an ordinary key.
		Object.defineProperty(entries, `split/${d.name}`, { value: `src/packages/${d.name}/index.ts`, enumerable: true, writable: true, configurable: true });
	}
	return entries;
}
