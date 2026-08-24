/**
 * Shared Test Utilities for solve-js
 * 
 * Centralizes common test helpers to eliminate duplication across 30+ test files.
 * NOT a test file — this is a utility module imported by test specs.
 * 
 * Located outside __tests__/ to prevent Jest from treating it as a test suite.
 */

import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { Lexer } from "@solve-js/lexer/Lexer";
import { Token } from "@solve-js/lexer/Token";
import { Value } from "@solve-js/vm/Value";
import { ParsingResult } from "@solve-js/types/ParsingResult";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";

/**
 * Create a fresh ExpressionEngine instance for testing.
 */
export function createEngine({ locale: locale = "en", diagnostics: diagnostic = false }): ExpressionEngine {
  return new ExpressionEngine({ locale, diagnostics: diagnostic, packages: BUILTIN_PACKAGES });
}

/**
 * Evaluate a single expression and return the Value result.
 * Convenience wrapper around engine.evaluateLine().
 */
export function evalExpr(engine: ExpressionEngine, expr: string, lineNum = 1): Value {
  return engine.evaluateLine(lineNum, expr)[0];
}

/**
 * Evaluate a full document and return the ParsingResult.
 */
export function evalDoc(engine: ExpressionEngine, doc: string): ParsingResult {
  return engine.parseDocument(doc, { inputType: "markdown" });
}

/**
 * Tokenize an expression string and return filtered tokens.
 */
export function tokenize(input: string): Token[] {
  const lexer = new Lexer("en");
  lexer.reset(input);
  return Array.from(lexer).filter(
    (t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_")
  );
}

/**
 * Assert that a value is approximately equal to expected (for floating point).
 */
export function expectApproximately(actual: number, expected: number, epsilon = 0.0001): void {
  const diff = Math.abs(actual - expected);
  if (diff > epsilon) {
    throw new Error(`Expected ${expected} but got ${actual} (diff: ${diff})`);
  }
}

/**
 * Wait for a condition to be true, with timeout.
 * Replaces fragile setTimeout patterns in tests.
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 1000,
  intervalMs = 10
): Promise<void> {
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    const result = await condition();
    if (result) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
}

/**
 * Generate a multi-line document with expressions for testing.
 */
export function generateDoc(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    if (i === 0) {
      lines.push(`:base${i} = ${i + 1}`);
    } else {
      lines.push(`:v${i} = :base${i - 1} + ${i}`);
    }
  }
  return lines.join("\n");
}

/**
 * Generate a markdown document with inline solves for testing.
 */
export function generateInlineDoc(solveCount: number): string {
  const expressions: string[] = [];
  for (let i = 0; i < solveCount; i++) {
    expressions.push(`s\`${i} + ${i + 1}\``);
  }
  return expressions.join(" some text between ");
}

/** What a benchmark case reports. Milliseconds throughout, as the name says. */
export interface BenchmarkResult {
  meanMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  p99Ms: number;
  /** How many timed samples the statistics were computed from. */
  samples: number;
  /** Kept for callers that reported total wall time. Mean times sample count. */
  totalMs: number;
}

const NS_PER_MS = 1e6;

interface MitataStats {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p99: number;
  samples?: number[];
}

/**
 * Loads mitata through the real ESM loader rather than Jest's module registry.
 *
 * mitata is ESM only, and this file is imported by more than thirty ordinary
 * spec files. A static import would therefore fail every one of them under
 * ts-jest's CommonJS output, not just the benchmarks. Deferring it means the
 * package is touched only when a benchmark actually runs.
 *
 * The indirection through `Function` is what keeps the call out of TypeScript's
 * and Jest's hands: both rewrite a literal `import()` in a CommonJS module into
 * a `require`, which is exactly what cannot load this package. Built once and
 * cached, since resolving it per case would dominate the short ones.
 */
let mitataMeasure: ((fn: () => void, opts: object) => Promise<MitataStats>) | null = null;

async function loadMeasure(): Promise<(fn: () => void, opts: object) => Promise<MitataStats>> {
  if (mitataMeasure) return mitataMeasure;
  const importESM = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ measure: (fn: () => void, opts: object) => Promise<MitataStats> }>;
  mitataMeasure = (await importESM("mitata")).measure;
  return mitataMeasure;
}

/**
 * Time a function, using mitata for the measurement.
 *
 * The previous implementation called `performance.now()` on either side of
 * every iteration and took the arithmetic mean of the deltas. That cannot
 * measure most of what this suite measures: `performance.now()` resolves to
 * roughly a microsecond, and half these cases are operations costing a few
 * nanoseconds, so each sample was mostly clock resolution. Worse for CI, the
 * arithmetic mean of a noisy sample is dominated by its outliers, which on a
 * shared runner means whatever else the host was doing. That is what produced
 * a `cancellation-overhead` suite reading 1.17x slower than its own merge base
 * with no change to the code being measured.
 *
 * mitata batches iterations to get below clock resolution, calibrates the
 * batch size per case, and reports a distribution rather than one number.
 * Callers should record `medianMs`, which is what makes a comparison across
 * two CI runs mean something.
 *
 * `iterations` and `warmup` are retained so the call sites did not all have to
 * change, but mitata decides both for itself from the measured cost of the
 * function. `iterations` is used only as a hint for how long to sample.
 */
export async function benchmarkFn(
  fn: () => void,
  iterations = 10000,
  _warmup = 100,
): Promise<BenchmarkResult> {
  // Sample for longer when the caller asked for many iterations, which is how
  // the existing cases signal "this one is small and needs more evidence".
  // Bounded at both ends so no single case can dominate the run.
  const minCpuTimeNs = Math.min(Math.max(iterations * 4, 100e6), 600e6);

  const measure = await loadMeasure();
  const stats = await measure(fn, { min_cpu_time: minCpuTimeNs });
  const sampleCount = stats.samples?.length ?? 0;

  return {
    meanMs: stats.avg / NS_PER_MS,
    medianMs: stats.p50 / NS_PER_MS,
    minMs: stats.min / NS_PER_MS,
    maxMs: stats.max / NS_PER_MS,
    p99Ms: stats.p99 / NS_PER_MS,
    samples: sampleCount,
    totalMs: (stats.avg * sampleCount) / NS_PER_MS,
  };
}

/**
 * Register every prefix/infix parselet a real `IEnginePackage` declares
 * directly against a bare `ParseletRegistry` — the generic replacement for
 * the 15 hand-written `register{Domain}Parselets(registry)` functions that
 * used to live one per package (arithmetic, biginteger, conditionals,
 * converters, currency, datetime, dice, finance, function, mathphrases,
 * percentage, time, uom, variables, vector).
 *
 * Those 15 functions existed only so isolated parselet-spec test files
 * could build a lightweight tokenize+parse harness without constructing a
 * full `ExpressionEngine` — but each one was a second, hand-maintained
 * mirror of the SAME package's own `prefixParselets`/`infixParselets`
 * arrays, and nothing kept the two in sync. Three of them drifted for
 * real, silently, in already-shipped code (`finance` was missing 4 entries
 * for the inflation feature, `uom` was missing the cooking-conversion
 * entry, `variables` was missing the unit-collision `IdentifierParselet`
 * entry) — found only because a specific test happened to exercise the
 * real package instead of the stale isolated helper. Since none of the 15
 * functions ever did anything beyond this exact mechanical loop (confirmed
 * by reading all of them), replacing them with one generic function that
 * reads the package descriptor directly makes this whole class of drift
 * structurally impossible: there is only one source of truth left.
 *
 * NOTE: this does NOT register `phrases`, `normalizerRules`, or
 * `pluginFunctions` — those need a `TokenNormalizer`/`pluginFunctionRegistry`
 * a bare `ParseletRegistry` doesn't have. A spec that needs phrase fusion or
 * plugin-function evaluation (not just parsing) should construct a real
 * `ExpressionEngine` instead — matches how the old per-package functions
 * were already documented as parselet-registration-only.
 *
 * @example
 * ```ts
 * const registry = new ParseletRegistry();
 * registerPackageForTesting(CURRENCY_PACKAGE, registry);
 * ```
 */
export function registerPackageForTesting(pkg: IEnginePackage, registry: ParseletRegistry): void {
  if (pkg.prefixParselets) {
    for (const { tokenType, parselet } of pkg.prefixParselets) {
      registry.registerPrefix(tokenType, parselet);
    }
  }
  if (pkg.infixParselets) {
    for (const { tokenType, parselet } of pkg.infixParselets) {
      registry.registerInfix(tokenType, parselet);
    }
  }
}

/**
 * Assert that a Value is a number type with the expected value.
 */
export function expectNumberValue(value: Value, expected: number, epsilon = 0.0001): void {
  if (value.type !== 0) {
    // ValueType.Number = 0
    throw new Error(`Expected Number type but got ${value.type}`);
  }
  expectApproximately(value.toNumber(), expected, epsilon);
}
/**
 * Register a plugin function on one specific engine, for tests.
 *
 * Tests used to assign into the module-level `pluginFunctionRegistry` and rely
 * on an engine picking it up. That worked only because every engine shared one
 * registry, which is the coupling {@link EngineContext} exists to remove, so it
 * silently stops working once an engine owns its own. This goes through
 * `registerPackage`, the same path a real package uses.
 *
 * @param engine - The engine to register on.
 * @param index - Plugin function index the test's bytecode calls.
 * @param handler - The function to install.
 * @returns A disposer that unregisters it again.
 */
export function registerTestPluginFunction(
	engine: { registerPackage: (pkg: never) => unknown; unregisterPackage: (name: string) => boolean },
	index: number,
	handler: unknown,
): () => void {
	const name = `test-plugin-fn-${index}`;
	engine.registerPackage({ name, pluginFunctions: [{ index, handler }] } as never);
	return () => {
		engine.unregisterPackage(name);
	};
}
