/**
 * Checks that `"sideEffects": false` in packages/engine/package.json is true.
 *
 * That field is a promise to bundlers: every file in this package can be
 * deleted if nothing imports a binding from it. Rollup, webpack and Vite all
 * act on it. Node does not, which is the whole problem: `npm test` runs against
 * `src`, and `npm run smoke`, `scripts/assert-publishable.mjs` and
 * `npm run test:consumer` all reach the built package through Node's ESM
 * loader, which evaluates every module it is told to load, side effects and
 * all. Every one of them passes whether the promise holds or not, and the only
 * person who finds out otherwise is a consumer bundling for the browser.
 *
 * The claim is not free. tsup's code splitting emits around a dozen bare
 * imports at the top of dist/index.js:
 *
 *     import './chunk-2RWAXT6O.js';
 *
 * A bare import exists only for its side effects, so `"sideEffects": false`
 * tells the bundler to delete every one of them. esbuild says so out loud when
 * `npm run size` runs, once per import:
 *
 *     Ignoring this import because "..." was marked as having no side effects
 *     [ignored-bare-import]
 *
 * and the engine does have load-time work for those imports to lose. The lexer
 * chunk calls `registerAllTokenTypes()` at module scope, the parser chunk fills
 * `_PrecedenceParser.BP_TABLE` and a couple of dozen cached token ids, and
 * several chunks construct process-wide registries.
 *
 * Two checks, because they fail in different ways:
 *
 *  1. A bundled consumer. scripts/fixtures/bundled-consumer.mjs is run twice,
 *     once directly under Node and once through a Rollup production bundle
 *     built with the package's own sideEffects field applied the way Vite
 *     applies it. The two reports have to be identical. This is the check that
 *     would actually have caught a broken build, but it only covers the API
 *     surface the fixture touches.
 *
 *  2. A load-time-effect audit of every chunk in dist. Whether check 1 passes
 *     currently depends on how tsup happened to split the code: the chunks that
 *     do load-time work are all also imported for their bindings somewhere, so
 *     they get pulled in regardless of the bare imports being dropped. That is
 *     a property of today's chunk graph, not a design decision, and a re-split
 *     could put load-time work in a chunk nothing imports bindings from without
 *     the fixture noticing. This check reads the invariant directly.
 *
 * Runs after `build` and `smoke` in `npm run verify`, which is also what
 * publish.yml runs before it is allowed to publish anything.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import { parseAst } from "rollup/parseAst";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const enginePkgDir = path.join(repo, "packages", "engine");
const dist = path.join(enginePkgDir, "dist");
const fixture = path.join(here, "fixtures", "bundled-consumer.mjs");

// Inside node_modules so it is ignored by git and by the published `files`
// list, and so the bundle can still resolve the two runtime dependencies left
// external below.
const outDir = path.join(repo, "node_modules", ".cache", "tree-shaking");

const failures = [];

function fail(label, detail) {
	console.log(`  FAIL  ${label}`);
	for (const line of String(detail).split("\n")) console.log(`        ${line}`);
	failures.push(label);
}

function pass(label) {
	console.log(`  ok    ${label}`);
}

if (!fs.existsSync(dist)) {
	console.error("packages/engine/dist does not exist. Run `npm run build` first.");
	process.exit(1);
}

console.log("Checking the tree-shaking contract.\n");

// ── The sideEffects field, read the way a bundler reads it ──────────────────

const enginePkg = JSON.parse(
	fs.readFileSync(path.join(enginePkgDir, "package.json"), "utf8"),
);
const sideEffects = enginePkg.sideEffects;

/**
 * npm's `sideEffects` semantics, matching what Vite's resolve plugin does with
 * the field. Deliberately derived from package.json rather than hardcoded to
 * false: narrowing the field to a list of entry files is one of the two fixes
 * if this check ever starts failing, and the check has to follow the claim
 * being made rather than keep testing the old one.
 */
function moduleHasSideEffects(id) {
	const file = path.resolve(id);
	if (!file.startsWith(path.resolve(enginePkgDir) + path.sep)) return true;
	if (sideEffects === undefined || sideEffects === true) return true;
	if (sideEffects === false) return false;
	if (Array.isArray(sideEffects)) {
		const rel = "./" + path.relative(enginePkgDir, file).split(path.sep).join("/");
		return sideEffects.some((pattern) => matchesGlob(rel, pattern));
	}
	return true;
}

/** The subset of glob that package.json sideEffects arrays use in practice. */
function matchesGlob(value, pattern) {
	const normalised = pattern.startsWith("./") || pattern.startsWith("*")
		? pattern
		: "./" + pattern;
	const source = normalised
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join("[^/]*");
	return new RegExp(`^${source}$`).test(value);
}

console.log(`  packages/engine sideEffects: ${JSON.stringify(sideEffects)}\n`);

// ── Check 1: the bundled consumer ───────────────────────────────────────────

function runNode(file) {
	return execFileSync(process.execPath, [file], {
		encoding: "utf8",
		cwd: repo,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/**
 * Resolves `solve-engine` and its subpaths through the real exports map, which
 * is what a consumer's bundler resolves. The workspace symlink in node_modules
 * points at packages/engine, so this reaches the build that just happened.
 */
const resolveEngine = {
	name: "resolve-engine",
	resolveId(source) {
		if (source !== "solve-engine" && !source.startsWith("solve-engine/")) return null;
		return fileURLToPath(import.meta.resolve(source));
	},
};

let bundledOutput;
let directOutput;

try {
	directOutput = runNode(fixture);
	pass("fixture runs under Node");
} catch (error) {
	fail("fixture runs under Node", error.stderr || error.message);
}

if (directOutput !== undefined) {
	try {
		const bundle = await rollup({
			input: fixture,
			// Whatever the engine still declares as a runtime dependency. Read
			// from the manifest rather than listed here, because that list moves:
			// tslib was dropped and semver became `noExternal` in tsup, so a
			// hardcoded copy would have gone stale within one release. Left
			// external because a dependency is not what this check is about, and
			// bundling one in would only add noise.
			external: (id) =>
				id.startsWith("node:") ||
				Object.keys(enginePkg.dependencies ?? {}).some(
					(dep) => id === dep || id.startsWith(`${dep}/`),
				),
			plugins: [resolveEngine],
			treeshake: {
				// The one setting under test. Everything else is left at Rollup's
				// defaults on purpose, so a failure here is attributable to the
				// sideEffects field rather than to an aggressive tree-shaking
				// option this project does not control.
				moduleSideEffects: (id) => moduleHasSideEffects(id),
			},
			onwarn(warning, warn) {
				// Circular imports between chunks are how tsup's splitting comes
				// out and are not what this checks.
				if (warning.code === "CIRCULAR_DEPENDENCY") return;
				warn(warning);
			},
		});

		fs.mkdirSync(outDir, { recursive: true });
		const outFile = path.join(outDir, "bundled-consumer.mjs");
		await bundle.write({ file: outFile, format: "es", exports: "none" });
		await bundle.close();
		pass("consumer bundles with Rollup");

		bundledOutput = runNode(outFile);
		pass("bundled consumer runs");
	} catch (error) {
		fail("bundled consumer runs", error.stderr || error.stack || error.message);
	}
}

if (directOutput !== undefined && bundledOutput !== undefined) {
	if (directOutput === bundledOutput) {
		pass("bundled output matches the Node baseline");
	} else {
		const a = directOutput.split("\n");
		const b = bundledOutput.split("\n");
		const diff = [];
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			if (a[i] !== b[i]) diff.push(`  node    : ${a[i] ?? "(end)"}\n  bundled : ${b[i] ?? "(end)"}`);
		}
		fail(
			"bundled output matches the Node baseline",
			"A bundler dropped module-level work the engine needs.\n" +
				"Either narrow packages/engine's sideEffects field to the entry\n" +
				"files, or move the load-time work out of a bare-imported chunk.\n\n" +
				diff.slice(0, 20).join("\n") +
				(diff.length > 20 ? `\n  ... ${diff.length - 20} more differing lines` : ""),
		);
	}
}

// ── Check 2: which chunks do load-time work, and how they are reached ───────

/**
 * Statement types that cannot run anything when a module is evaluated.
 * Everything else at the top level of a module does.
 */
const INERT_STATEMENTS = new Set([
	"FunctionDeclaration",
	"ClassDeclaration",
	"EmptyStatement",
]);

/**
 * Whether a `const`/`let`/`var` initialiser can reach outside its own binding.
 * A literal, a function, or an object of literals cannot; a call, a `new`, or a
 * member expression might.
 */
function initialiserIsInert(node) {
	if (!node) return true;
	switch (node.type) {
		case "Literal":
		case "Identifier":
		case "FunctionExpression":
		case "ArrowFunctionExpression":
		case "ClassExpression":
		case "TemplateLiteral":
			return true;
		case "ArrayExpression":
			return node.elements.every((element) => initialiserIsInert(element));
		case "ObjectExpression":
			return node.properties.every(
				(property) => property.type === "Property" && initialiserIsInert(property.value),
			);
		case "UnaryExpression":
			return initialiserIsInert(node.argument);
		case "BinaryExpression":
			return initialiserIsInert(node.left) && initialiserIsInert(node.right);
		default:
			return false;
	}
}

const bareImporters = new Map();
const bindingImporters = new Map();
const loadTimeWork = new Map();

for (const file of fs.readdirSync(dist).filter((name) => name.endsWith(".js"))) {
	const source = fs.readFileSync(path.join(dist, file), "utf8");
	const ast = parseAst(source);
	const work = [];

	for (const statement of ast.body) {
		if (statement.type === "ImportDeclaration") {
			const target = statement.source.value.replace(/^\.\//, "");
			const map = statement.specifiers.length === 0 ? bareImporters : bindingImporters;
			if (!map.has(target)) map.set(target, new Set());
			map.get(target).add(file);
			continue;
		}

		// `export { x } from "./y.js"` and `export * from "./y.js"` are binding
		// imports too, and are how the subpath entries reach their chunks.
		let node = statement;
		if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
			if (node.source) {
				const target = node.source.value.replace(/^\.\//, "");
				if (!bindingImporters.has(target)) bindingImporters.set(target, new Set());
				bindingImporters.get(target).add(file);
				continue;
			}
			if (!node.declaration) continue;
			node = node.declaration;
		}
		if (node.type === "ExportDefaultDeclaration") continue;
		if (INERT_STATEMENTS.has(node.type)) continue;

		if (node.type === "VariableDeclaration") {
			const live = node.declarations.filter((d) => !initialiserIsInert(d.init));
			if (live.length === 0) continue;
			work.push(`${node.kind} ${live.map((d) => d.id.name ?? "(pattern)").join(", ")} = <computed>`);
			continue;
		}
		work.push(source.slice(node.start, node.start + 100).split("\n")[0].trim());
	}

	if (work.length > 0) loadTimeWork.set(file, work);
}

const droppable = [];
for (const [file, work] of loadTimeWork) {
	const bare = bareImporters.get(file);
	const bindings = bindingImporters.get(file);
	// Reached only through bare imports means `"sideEffects": false` licenses a
	// bundler to delete the file outright, work and all.
	if (bare && bare.size > 0 && (!bindings || bindings.size === 0)) {
		droppable.push([file, work, [...bare]]);
	}
}

if (droppable.length === 0) {
	pass(
		`no droppable load-time work (${loadTimeWork.size} of ` +
			`${fs.readdirSync(dist).filter((n) => n.endsWith(".js")).length} chunks do work at load, ` +
			"all anchored by binding imports)",
	);
} else {
	for (const [file, work, bare] of droppable) {
		fail(
			`chunk reachable only via bare imports: ${file}`,
			`It runs this at load time:\n` +
				work.slice(0, 6).map((line) => `  ${line}`).join("\n") +
				(work.length > 6 ? `\n  ... ${work.length - 6} more` : "") +
				`\nBare-imported by: ${bare.join(", ")}\n` +
				"Nothing imports a binding from it, so a bundler acting on\n" +
				'"sideEffects": false will delete it.',
		);
	}
}

console.log("");
if (failures.length > 0) {
	console.error(`${failures.length} tree-shaking check(s) failed.`);
	process.exit(1);
}
console.log("The sideEffects claim holds.");
process.exit(0);
