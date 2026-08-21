/**
 * Imports the built package the way a consumer would and evaluates something.
 *
 * The test suite runs entirely against `src` through jest path aliases, so it
 * cannot see anything that only goes wrong once tsup has bundled the code. That
 * gap is not hypothetical: the root entry point once inlined a web worker
 * module whose top-level `self.onmessage` ran on import, which meant
 * `import { ExpressionEngine } from "solve-engine"` threw `self is not defined`
 * on Node before a single expression could be evaluated. Every test was green
 * at the time.
 *
 * Runs after `build` in `npm run verify`.
 */

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "packages", "engine", "dist");
const require = createRequire(import.meta.url);

const failures = [];

function check(label, fn) {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (err) {
    console.log(`  FAIL  ${label}`);
    console.log(`        ${err.message}`);
    failures.push(label);
  }
}

console.log("Smoke testing the built package.\n");

// ESM, the documented import in the README and on npm.
const esm = await import(pathToFileURL(path.join(dist, "index.js")).href);

check("ESM: root entry exports ExpressionEngine", () => {
  if (typeof esm.ExpressionEngine !== "function") {
    throw new Error(`ExpressionEngine is ${typeof esm.ExpressionEngine}, expected function`);
  }
});

check("ESM: evaluates an expression", () => {
  const engine = new esm.ExpressionEngine();
  const [value] = engine.evaluateExpression("2 + 2 * 10");
  const actual = value.toNumber();
  if (actual !== 22) throw new Error(`2 + 2 * 10 gave ${actual}, expected 22`);
});

check("ESM: units survive the bundle", () => {
  const engine = new esm.ExpressionEngine();
  const [value] = engine.evaluateLine(1, "100 cm + 2 m");
  if (value === undefined) throw new Error("no value returned");
});

// CJS, for consumers that have not migrated. A require() of an ESM-only bundle
// is one of the ways a package looks fine locally and breaks on install.
check("CJS: root entry requires and evaluates", () => {
  const cjs = require(path.join(dist, "index.cjs"));
  if (typeof cjs.ExpressionEngine !== "function") {
    throw new Error(`ExpressionEngine is ${typeof cjs.ExpressionEngine}, expected function`);
  }
  const engine = new cjs.ExpressionEngine();
  const [value] = engine.evaluateExpression("6 * 7");
  const actual = value.toNumber();
  if (actual !== 42) throw new Error(`6 * 7 gave ${actual}, expected 42`);
});

// Subpaths are a documented part of the API, and each is its own bundle with
// its own chance of pulling in something environment-specific.
const subpaths = [
  "engine", "vm", "format", "language", "packages", "constants",
  "lexer", "parser", "normalizer", "variables", "resolvers",
  "errors", "utilities", "uom", "services", "worker",
];

for (const subpath of subpaths) {
  try {
    const mod = await import(pathToFileURL(path.join(dist, `${subpath}.js`)).href);
    if (Object.keys(mod).length === 0) {
      throw new Error("imported but exports nothing");
    }
    console.log(`  ok    ESM: subpath "${subpath}"`);
  } catch (err) {
    console.log(`  FAIL  ESM: subpath "${subpath}"`);
    console.log(`        ${err.message}`);
    failures.push(`subpath ${subpath}`);
  }
}

console.log("");
if (failures.length > 0) {
  console.error(`${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log("All smoke checks passed.");

// The engine registers timers and may hold an open handle from a resolver that
// was never used. Nothing here needs to keep the process alive.
process.exit(0);
