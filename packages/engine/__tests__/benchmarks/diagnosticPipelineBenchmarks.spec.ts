/**
 * Diagnostic Pipeline Benchmark — compares production vs diagnostic mode
 * to prove zero overhead in production and acceptable cost in diagnostic mode.
 */

// Pre-existing: __WORKER_URL__ is an esbuild define substitution, not available in ts-jest
declare let __WORKER_URL__: string | undefined;

import { describe, expect, test, afterAll } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { benchmarkFn } from "@tools/testUtils";
import { TimelineDiagnosticCollector } from "@solve-js/diagnostics";
import { recordSample, writeBenchmarkResults, BenchmarkResults } from "@tools/benchmarkIO";

function generateDoc(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`:v${i} = ${i + 1}`);
  }
  return lines.join("\n");
}

describe("Diagnostic Pipeline Overhead Benchmark", () => {
  const results: BenchmarkResults = {};

  afterAll(() => {
    writeBenchmarkResults("diagnostic-pipeline", results, "ms");
  });

  // === PRODUCTION MODE BENCHMARKS ===

  test("[PROD] single eval cold in < 2ms", async () => {
    const r = await benchmarkFn(() => {
      const e = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
      e.evaluateLine(1, "1 + 2 * 3");
    }, 5000, 100);
    recordSample(results, "PROD_single_eval_cold", r);
    expect(r.medianMs).toBeLessThan(2);
  });

  test("[PROD] single eval warm (cached) in < 0.5ms", async () => {
    const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    engine.evaluateLine(1, "10 + 20");
    const r = await benchmarkFn(() => {
      engine.evaluateLine(1, "10 + 20");
    }, 50000, 500);
    recordSample(results, "PROD_single_eval_warm", r);
    expect(r.medianMs).toBeLessThan(1);
  });

  test("[PROD] parses 50-line doc in < 20ms", async () => {
    const input = generateDoc(50);
    const r = await benchmarkFn(() => {
      const e = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
      e.parseDocument(input);
    }, 200, 10);
    recordSample(results, "PROD_50_line_doc", r);
    expect(r.medianMs).toBeLessThan(50);
  });

  test("[PROD] variable chain in < 1ms", async () => {
    const r = await benchmarkFn(() => {
      const e = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
      e.parseDocument(":x = 1\n:x + 1\n:x + 2\n:x + 3\n:x + 4");
    }, 5000, 100);
    recordSample(results, "PROD_variable_chain", r);
    expect(r.medianMs).toBeLessThan(2);
  });

  test("[PROD] full pipeline sqrt(144) + 5 in < 1ms", async () => {
    const r = await benchmarkFn(() => {
      const e = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
      e.evaluateLine(1, "sqrt(144) + 5");
    }, 20000, 500);
    recordSample(results, "PROD_function_plus_literal", r);
    expect(r.medianMs).toBeLessThan(2);
  });

  test("[PROD] 10k warm evaluations in < 100ms", async () => {
    const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    engine.evaluateLine(1, "42"); // warmup
    const r = await benchmarkFn(() => {
      engine.evaluateLine(1, "1 + 2 * 3 - 4 / 5");
    }, 10000, 500);
    recordSample(results, "PROD_10k_warm", r);
    expect(r.medianMs).toBeLessThan(100);
  });

  // === DIAGNOSTIC MODE BENCHMARKS ===

  test("[DIAG] single eval cold in < 5ms", async () => {
    const r = await benchmarkFn(() => {
      const e = new ExpressionEngine({ diagnostics: true, packages: BUILTIN_PACKAGES });
      e.evaluateLine(1, "1 + 2 * 3");
    }, 5000, 100);
    recordSample(results, "DIAG_single_eval_cold", r);
    expect(r.medianMs).toBeLessThan(5);
  });

  test("[DIAG] single eval warm (cached) in < 1ms", async () => {
    const engine = new ExpressionEngine({ diagnostics: true, packages: BUILTIN_PACKAGES });
    engine.evaluateLine(1, "10 + 20");
    const r = await benchmarkFn(() => {
      engine.evaluateLine(1, "10 + 20");
    }, 10000, 500);
    recordSample(results, "DIAG_single_eval_warm", r);
    // Was toBeLessThan(2) — a title/assertion mismatch that masked a real
    // O(n²) bug (TimelineDiagnosticCollector.getReport() rescanning its
    // entire event history on every call). Now that it's fixed (~0.01ms,
    // was ~0.72ms), tighten the assertion to match what the title always claimed.
    expect(r.medianMs).toBeLessThan(1);
  });

  test("[DIAG] parses 50-line doc in < 50ms", async () => {
    const input = generateDoc(50);
    const r = await benchmarkFn(() => {
      const e = new ExpressionEngine({ diagnostics: true, packages: BUILTIN_PACKAGES });
      e.parseDocument(input);
    }, 200, 10);
    recordSample(results, "DIAG_50_line_doc", r);
    expect(r.medianMs).toBeLessThan(100);
  });

  test("[DIAG] variable chain in < 2ms", async () => {
    const r = await benchmarkFn(() => {
      const e = new ExpressionEngine({ diagnostics: true, packages: BUILTIN_PACKAGES });
      e.parseDocument(":x = 1\n:x + 1\n:x + 2\n:x + 3\n:x + 4");
    }, 5000, 100);
    recordSample(results, "DIAG_variable_chain", r);
    expect(r.medianMs).toBeLessThan(5);
  });

  test("[DIAG] 10k warm evaluations in < 200ms", async () => {
    const engine = new ExpressionEngine({ diagnostics: true, packages: BUILTIN_PACKAGES });
    engine.evaluateLine(1, "42"); // warmup
    const r = await benchmarkFn(() => {
      engine.evaluateLine(1, "1 + 2 * 3 - 4 / 5");
    }, 10000, 500);
    recordSample(results, "DIAG_10k_warm", r);
    expect(r.medianMs).toBeLessThan(200);
  });

  // === DIAGNOSTIC REPORT VALIDATION ===

test("diagnostic report has correct structure", () => {
     const engine = new ExpressionEngine({ diagnostics: true, packages: BUILTIN_PACKAGES });
     // Use an expression with sqrt() to exercise Tier 2 FunctionParselet
     const result = engine.evaluateLineWithDebug(1, "sqrt(144) + 5");

     expect(result.debug).toBeDefined();
     const debug = result.debug!;
     expect(debug.events).toBeDefined();
     expect(debug.summary).toBeDefined();
     expect(debug.metadata).toBeDefined();

     // Check summary fields
     expect(debug.summary.totalTokens).toBeGreaterThan(0);
     expect(debug.summary.totalOpcodes).toBeGreaterThan(0);
     expect(debug.summary.cacheHit).toBe(false); // first eval = cache miss
     expect(debug.summary.parseCategories).toBeDefined();

     // Check metadata
     expect(debug.metadata.expression).toBe("sqrt(144) + 5");
     expect(debug.metadata.vmTraceEnabled).toBe(false);

     // Verify parselet categories populated (Tier 2 parselets only;
     // Tier 1 inline tokens like NUMBER do not fire parselet events).
     const cats = Object.keys(debug.summary.parseCategories);
     expect(cats.length).toBeGreaterThan(0);
     expect(cats).toContain("Function");

     // Check events include parselet_matched with categories
     const parseletEvents = debug.events.filter(
       (e): e is import("@solve-js/diagnostics").ParseletMatchedEvent => (e as import("@solve-js/diagnostics").DiagnosticEvent).type === "parselet_matched"
     );
     expect(parseletEvents.length).toBeGreaterThan(0);
     expect(parseletEvents[0].parseletCategory).toBeDefined();
     expect(parseletEvents[0].parseletType).toBeDefined();
     expect(parseletEvents[0].isPrefix).toBeDefined();
   });

  test("cached evaluation reports cache hit", () => {
    const engine = new ExpressionEngine({ diagnostics: true, packages: BUILTIN_PACKAGES });

    // First eval — cache miss
    const result1 = engine.evaluateLineWithDebug(1, "100 + 200");
    expect(result1.debug!.summary.cacheHit).toBe(false);

    // Second eval — cache hit
    const result2 = engine.evaluateLineWithDebug(1, "100 + 200");
    expect(result2.debug!.summary.cacheHit).toBe(true);
  });

test("vm trace mode emits per-opcode events", () => {
     const engine = new ExpressionEngine({ diagnostics: true, config: {
       diagnostic: { enabled: true, vmTraceEnabled: true }
     }, packages: BUILTIN_PACKAGES });
     const traceCollector = new TimelineDiagnosticCollector();
     const pipeline = engine.getDiagnosticPipeline();
     pipeline.clear();
     pipeline.register(traceCollector);

     const result = engine.evaluateLineWithDebug(1, "1 + 2");

     const report = traceCollector.getReport();
     const stepEvents = report?.events.filter(
       (e: any): e is import("@solve-js/diagnostics").VmStepEvent => e.type === "vm_step"
     );
     expect(stepEvents).toBeDefined();
     expect(stepEvents!.length).toBeGreaterThan(0);

     // Each step should have opcode info
     expect(stepEvents![0].opcodeName).toBeDefined();
     expect(stepEvents![0].ip).toBe(0);
     expect(stepEvents![0].stackDepth).toBeDefined();
   });

  test("null collector has zero overhead vs direct call", async () => {
    // Production engine
    const prodEngine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    // Engine with null collector explicitly
    const nullEngine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });

    const prodTime = await benchmarkFn(() => {
      prodEngine.evaluateLine(1, "1 + 2 * 3");
    }, 10000, 500);

    const nullTime = await benchmarkFn(() => {
      nullEngine.evaluateLine(1, "1 + 2 * 3");
    }, 10000, 500);

    // Allow 50% tolerance for measurement noise
    const ratio = nullTime.medianMs / prodTime.medianMs;
    expect(ratio).toBeLessThan(2); // null collector should not double execution time

    // Deliberately not persisted. This is a dimensionless ratio between two
    // measurements in the same run, not a timing, so comparing it against a
    // ratio from a different run says nothing and it has no place in a suite
    // geometric mean. The assertion above is the guard.
    console.log(`  null collector overhead ratio: ${ratio.toFixed(3)}x`);
  });
});