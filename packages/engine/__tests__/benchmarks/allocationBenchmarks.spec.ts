/**
 * Allocation Tracking Benchmarks
 *
 * Measures heap allocation with process.memoryUsage().heapUsed, which includes
 * V8 internals and engine bootstrap as well as the work being measured.
 *
 * Every "fresh engine" case below measures bootstrap plus the operation and
 * attributes the whole delta to the operation. That is why the budgets are so
 * much larger than the work being measured would suggest.
 *
 * The fresh-engine budgets moved from 256KB to 2MB. The first move followed
 * measuring bootstrap alone at roughly 442KB, which put 256KB out of reach no
 * matter how cheap the operation was. The cause is growth rather than a leak:
 * the built-in package set is now 19 packages, each registering vocabulary,
 * parselets and normaliser rules at construction. Per-evaluation cost on an
 * already-warm engine was measured at 9KB for one, then 5.4KB and 1.8KB
 * amortised over 100 and 1000, so it falls as caches fill rather than growing.
 *
 * The second move was for a different reason, and it is the one worth reading.
 * Across four consecutive runs of identical code, the same case measured
 * anywhere from 665KB to 1.38MB. These assertions do not control for when
 * garbage collection lands inside the measured span, so run-to-run variation of
 * roughly two times is normal. A bound tight enough to be interesting is
 * therefore a bound that fails at random.
 *
 * Read them accordingly. They catch an order-of-magnitude change, nothing
 * finer. The per-case ratio against the merge base in scripts/compare-benchmarks.mjs
 * is what actually guards allocation cost, because it compares two runs on one
 * machine minutes apart and cancels most of this noise.
 *
 * The real fix is a measurement that separates bootstrap from the operation and
 * counts objects rather than sampling a heap total. That is worth more than any
 * further adjustment to the numbers below.
 *
 * Current budgets (heap bytes):
 * - Fresh engine plus one operation: < 2MB (bootstrap dominates, and it is noisy)
 * - Parser warm: < 768KB (bytecode cached, V8 noise dominates)
 * - VM warm total: < 4MB for 200 evals
 * - Document 50-line: < 2MB
 * - Document 200-line: < 4MB
 */

import { describe, expect, test, beforeAll } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

// ── Global setup: force GC if available ──────────────────────────────────
const gc = (global as unknown as { gc?: () => void }).gc;

/** Track heap delta around a function call. Returns { result, deltaBytes }. */
function trackHeapDelta<T>(fn: () => T): { result: T; deltaBytes: number } {
  if (gc) gc();
  const start = process.memoryUsage().heapUsed;
  const result = fn();
  const end = process.memoryUsage().heapUsed;
  return { result, deltaBytes: end - start };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Create a fresh engine (cold — no caches). */
function createEngine(): ExpressionEngine {
  return new ExpressionEngine("en", false);
}

describe("Allocation Benchmarks", () => {
  let engine: ExpressionEngine;

  beforeAll(() => {
    engine = createEngine();
    // Warm up JIT and caches
    engine.evaluateLine(1, "1 + 2");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Lexer allocation budgets
  // ═══════════════════════════════════════════════════════════════════════

  test("lexer: simple arithmetic (fresh engine) allocates < 2MB", () => {
    const { deltaBytes } = trackHeapDelta(() => {
      const e = createEngine();
      e.evaluateLine(1, "1 + 2");
    });
    expect(deltaBytes).toBeLessThan(2 * 1024 * 1024);
  });

  test("lexer: mixed expression (fresh engine) allocates < 2MB", () => {
    const { deltaBytes } = trackHeapDelta(() => {
      const e = createEngine();
      e.evaluateLine(1, "$10 + 50% of 200 - 3 kg");
    });
    expect(deltaBytes).toBeLessThan(2 * 1024 * 1024);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Parser allocation budgets
  // ═══════════════════════════════════════════════════════════════════════

  test("parser: cold compile (3 expressions) allocates < 2MB", () => {
    if (gc) gc();
    const start = process.memoryUsage().heapUsed;
    const e = createEngine();
    e.evaluateLine(1, "1 + 2 * 3");
    e.evaluateLine(2, "sqrt(144) + 5");
    e.evaluateLine(3, "10% of 200");
    const end = process.memoryUsage().heapUsed;
    expect(end - start).toBeLessThan(2 * 1024 * 1024);
  });

  test("parser: warm compile allocates < 768KB (bytecode cached)", () => {
    // Warm the cache first
    engine.evaluateLine(100, "1 + 2 * 3");
    engine.evaluateLine(101, "sqrt(144) + 5");
    engine.evaluateLine(102, "10% of 200");

    if (gc) gc();
    const start = process.memoryUsage().heapUsed;
    engine.evaluateLine(100, "1 + 2 * 3");
    engine.evaluateLine(101, "sqrt(144) + 5");
    engine.evaluateLine(102, "10% of 200");
    const end = process.memoryUsage().heapUsed;
    // ~20KB observed; V8 internal noise prevents sub-1KB
    expect(end - start).toBeLessThan(768 * 1024);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // VM allocation budgets
  // ═══════════════════════════════════════════════════════════════════════

  test("vm: simple add (fresh engine) allocates < 2MB", () => {
    const { deltaBytes } = trackHeapDelta(() => {
      createEngine().evaluateLine(1, "1 + 2");
    });
    expect(deltaBytes).toBeLessThan(2 * 1024 * 1024);
  });

  test("vm: repeated evaluation allocates < 4MB total for 200 warm evals", () => {
    // Warm
    engine.evaluateLine(200, "1 + 2");
    engine.evaluateLine(201, "3 * 4");

    if (gc) gc();
    const start = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100; i++) {
      engine.evaluateLine(200, "1 + 2");
      engine.evaluateLine(201, "3 * 4");
    }
    const end = process.memoryUsage().heapUsed;
    // Raised from 2MB after this passed one run and failed the next at 2.98MB.
    // The previous bound left five percent of headroom on a heap delta the
    // comment beside it already described as noise-dominated, which is not a
    // threshold so much as a coin toss. Whether a garbage collection lands
    // inside the measured span moves this more than the code does.
    //
    // Per-evaluation cost was measured separately at 9KB for one evaluation and
    // 1.8KB amortised over a thousand, so it falls as caches fill. 200 warm
    // evaluations do not account for megabytes; V8 bookkeeping does.
    expect(end - start).toBeLessThan(4 * 1024 * 1024);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Normalizer bypass (no vocabs registered → zero overhead)
  // ═══════════════════════════════════════════════════════════════════════

  test("normalizer: fresh pipeline allocates < 2MB", () => {
    const { deltaBytes } = trackHeapDelta(() => {
      createEngine().evaluateLine(1, "1 + 2 * 3 - 4 / 2");
    });
    expect(deltaBytes).toBeLessThan(2 * 1024 * 1024);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Orchestrator fast-path (no plugin → direct delegate)
  // ═══════════════════════════════════════════════════════════════════════

  test("orchestrator: warm fast path allocates < 768KB", () => {
    const e = createEngine();
    // Warm to establish baseline
    e.evaluateLine(1, "1 + 2");

    if (gc) gc();
    const start = process.memoryUsage().heapUsed;
    const [result] = e.evaluateLine(1, "1 + 2");
    const end = process.memoryUsage().heapUsed;

    expect(result?.value).toBe(3);
    // ~455KB observed; V8 internal noise varies by platform
    expect(end - start).toBeLessThan(768 * 1024);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Document-scale allocation
  // ═══════════════════════════════════════════════════════════════════════

  test("document: 50-line doc (fresh engine) allocates < 2MB", () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
      lines.push(`:v${i} = ${i + 1}`);
    }

    if (gc) gc();
    const start = process.memoryUsage().heapUsed;
    const e = createEngine();
    e.parseDocument(lines.join("\n"));
    const end = process.memoryUsage().heapUsed;

    // ~556KB observed
    expect(end - start).toBeLessThan(2 * 1024 * 1024);
  });

  test("document: 200-line doc (fresh engine) allocates < 4MB", () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(`:v${i} = ${i + 1}`);
    }

    if (gc) gc();
    const start = process.memoryUsage().heapUsed;
    const e = createEngine();
    e.parseDocument(lines.join("\n"));
    const end = process.memoryUsage().heapUsed;

    // ~2.2MB observed
    expect(end - start).toBeLessThan(4 * 1024 * 1024);
  });
});
