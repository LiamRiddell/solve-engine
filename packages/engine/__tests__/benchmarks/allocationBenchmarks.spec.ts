/**
 * Allocation Tracking Benchmarks
 *
 * Measures heap cost with process.memoryUsage().heapUsed. Every "fresh engine"
 * case measures engine bootstrap plus the operation and attributes the whole
 * figure to the operation, so the budgets are larger than the operation alone
 * would suggest. Bootstrap on its own measures about 182KB: the built-in
 * package set is 19 packages, each registering vocabulary, parselets and
 * normaliser rules at construction.
 *
 * These cases used to take a plain end-minus-start heapUsed delta, and that is
 * what made them flaky. Such a delta counts garbage that has not been collected
 * yet, so it reports what the collector happened to be doing rather than what
 * the code cost. V8 sizes the young generation from the history of the process
 * rather than from the measurement: across a bench run of twelve suites in one
 * process new space here reaches 64MB, roomy enough that a short operation
 * triggers no scavenge at all and every byte it touched stays in the reading.
 *
 * Repeating identical code, the 50-line document case read anywhere from 1.42MB
 * to 2.29MB as a plain delta. Its budget was 2MB, inside that range, so it
 * failed at random in full bench runs while passing alone. A bound that sits
 * inside the spread of its own metric is not a bound, and which side it lands
 * on is decided by what ran earlier in the process.
 *
 * Every footprint case now uses trackRetained: the heap is settled on both
 * sides and the engine is still reachable across the closing settle. That reads
 * the same 50-line case at 337KB in a full bench run and 340KB standalone, a
 * spread of about one percent where the old metric moved by a megabyte. The
 * budgets below sit at roughly twice the largest reading observed, which leaves
 * them able to catch a doubling in retained cost while staying well clear of
 * the metric's own noise.
 *
 * The warm cases are different in kind. They measure churn on an already-built
 * engine, where a retained figure is near zero by construction, so they keep
 * the plain delta and stay correspondingly coarse. Their budgets keep a lot of
 * headroom deliberately: the plain delta is history-sensitive, and the 200-eval
 * case still swings between 2.0MB and 2.8MB run to run to prove it.
 *
 * Nothing here is written to packages/engine/benchmarks, so
 * scripts/compare-benchmarks.mjs does not see allocation numbers at all — it
 * compares recorded timings and expresses its noise floor in milliseconds. The
 * assertions below are the only guard these figures have, which is the reason
 * they are worth keeping honest.
 *
 * Set SOLVE_ALLOC_LOG to a file path to record every measurement when
 * retuning a budget. It writes to a file rather than the console because jest's
 * reporter discards per-suite console output once more than one suite runs,
 * which is exactly the multi-suite case worth measuring.
 *
 * Observed in a full 12-suite bench run on the development machine:
 * - Fresh engine plus one operation: 166KB simple, 430KB mixed  (budget 1MB)
 * - Parser cold, 3 expressions: 249KB                           (budget 1MB)
 * - Normalizer fresh pipeline: 136KB                            (budget 1MB)
 * - Document 50-line: 337KB                                     (budget 768KB)
 * - Document 200-line: 728KB                                    (budget 1.5MB)
 * - Parser warm, delta: 61KB                                    (budget 768KB)
 * - Orchestrator warm fast path, delta: 9.7KB                   (budget 768KB)
 * - VM warm, 200 evals, delta: 2.0MB to 2.8MB                   (budget 4MB)
 */

import { appendFileSync } from "fs";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { describe, expect, test, beforeAll } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

// ── Global setup: force GC if available ──────────────────────────────────
const gc = (global as unknown as { gc?: () => void }).gc;

/** Record a measurement when SOLVE_ALLOC_LOG names a file. Off by default. */
function note(label: string, bytes: number): void {
  const target = process.env.SOLVE_ALLOC_LOG;
  if (target) appendFileSync(target, `ALLOC ${label} = ${bytes}\n`);
}

/**
 * Settle the heap. Two passes rather than one, because the first leaves behind
 * objects that only become collectable once the weak references and
 * finalisation it triggered have cleared, and that residue is large enough to
 * read at this scale. Measured on the warm fast-path case, the second pass is
 * the difference between reading 455KB of float and reading its actual 9.7KB.
 */
function settle(): void {
  if (gc) {
    gc();
    gc();
  }
}

/**
 * Bytes still reachable after `fn`, with the heap settled on both sides.
 *
 * Whatever `fn` returns is read after the closing settle, so it stays live
 * across that collection and its cost lands in the figure. Return the engine,
 * or the case measures nothing and passes for the wrong reason.
 *
 * Residual float means this does not read zero for work that retains nothing:
 * a created-and-discarded engine measures up to 150KB, and a case that follows
 * a heavy one can read negative when the opening settle left more behind than
 * the case itself retains. That is the noise floor the budgets have to clear,
 * and it is why they are not set anywhere near the observed values.
 */
function trackRetained<T>(fn: () => T): { result: T; bytes: number } {
  settle();
  const start = process.memoryUsage().heapUsed;
  const result = fn();
  settle();
  const end = process.memoryUsage().heapUsed;
  return { result, bytes: end - start };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Create a fresh engine (cold — no caches). */
function createEngine(): ExpressionEngine {
  return new ExpressionEngine({ packages: BUILTIN_PACKAGES });
}

/** Build a document of `n` assignment lines. */
function buildDocument(n: number): string {
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(`:v${i} = ${i + 1}`);
  }
  return lines.join("\n");
}

/** Shared by every case that builds an engine and performs one small operation. */
const FRESH_ENGINE_BUDGET = 1024 * 1024;

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

  test("lexer: simple arithmetic (fresh engine) retains < 1MB", () => {
    const { bytes } = trackRetained(() => {
      const e = createEngine();
      e.evaluateLine(1, "1 + 2");
      return e;
    });
    note("lexer simple", bytes);
    // 166KB observed, of which about 182KB is bootstrap — the operation itself
    // is inside the noise, which is the honest reading of this case.
    expect(bytes).toBeLessThan(FRESH_ENGINE_BUDGET);
  });

  test("lexer: mixed expression (fresh engine) retains < 1MB", () => {
    const { bytes } = trackRetained(() => {
      const e = createEngine();
      e.evaluateLine(1, "$10 + 50% of 200 - 3 kg");
      return e;
    });
    note("lexer mixed", bytes);
    // 430KB observed, the largest of the fresh-engine cases: currency and unit
    // handling populate caches that the simple arithmetic case never touches.
    expect(bytes).toBeLessThan(FRESH_ENGINE_BUDGET);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Parser allocation budgets
  // ═══════════════════════════════════════════════════════════════════════

  test("parser: cold compile (3 expressions) retains < 1MB", () => {
    const { bytes } = trackRetained(() => {
      const e = createEngine();
      e.evaluateLine(1, "1 + 2 * 3");
      e.evaluateLine(2, "sqrt(144) + 5");
      e.evaluateLine(3, "10% of 200");
      return e;
    });
    note("parser cold", bytes);
    // 249KB observed.
    expect(bytes).toBeLessThan(FRESH_ENGINE_BUDGET);
  });

  test("parser: warm compile allocates < 768KB (bytecode cached)", () => {
    // Warm the cache first
    engine.evaluateLine(100, "1 + 2 * 3");
    engine.evaluateLine(101, "sqrt(144) + 5");
    engine.evaluateLine(102, "10% of 200");

    settle();
    const start = process.memoryUsage().heapUsed;
    engine.evaluateLine(100, "1 + 2 * 3");
    engine.evaluateLine(101, "sqrt(144) + 5");
    engine.evaluateLine(102, "10% of 200");
    const end = process.memoryUsage().heapUsed;
    note("parser warm", end - start);
    // 61KB observed, not the 20KB an older comment here claimed. Churn rather
    // than footprint, so this stays a plain delta and keeps the wide budget
    // that a history-sensitive metric needs.
    expect(end - start).toBeLessThan(768 * 1024);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // VM allocation budgets
  // ═══════════════════════════════════════════════════════════════════════

  test("vm: simple add (fresh engine) retains < 1MB", () => {
    const { bytes } = trackRetained(() => {
      const e = createEngine();
      e.evaluateLine(1, "1 + 2");
      return e;
    });
    note("vm simple", bytes);
    // 177KB observed.
    expect(bytes).toBeLessThan(FRESH_ENGINE_BUDGET);
  });

  test("vm: repeated evaluation allocates < 4MB total for 200 warm evals", () => {
    // Warm
    engine.evaluateLine(200, "1 + 2");
    engine.evaluateLine(201, "3 * 4");

    settle();
    const start = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100; i++) {
      engine.evaluateLine(200, "1 + 2");
      engine.evaluateLine(201, "3 * 4");
    }
    const end = process.memoryUsage().heapUsed;
    note("vm repeated", end - start);
    // 2.0MB to 2.8MB observed across runs — the widest spread left in the file,
    // and the reason the churn cases keep generous budgets. Raised from 2MB
    // after this passed one run and failed the next at 2.98MB.
    //
    // Per-evaluation cost was measured separately at 9KB for one evaluation and
    // 1.8KB amortised over a thousand, so it falls as caches fill. 200 warm
    // evaluations do not account for megabytes; V8 bookkeeping does.
    expect(end - start).toBeLessThan(4 * 1024 * 1024);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Normalizer bypass (no vocabs registered → zero overhead)
  // ═══════════════════════════════════════════════════════════════════════

  test("normalizer: fresh pipeline retains < 1MB", () => {
    const { bytes } = trackRetained(() => {
      const e = createEngine();
      e.evaluateLine(1, "1 + 2 * 3 - 4 / 2");
      return e;
    });
    note("normalizer fresh", bytes);
    // 136KB observed. This case follows the 200-eval churn case, so it is the
    // one that occasionally reads negative when the opening settle inherits a
    // dirtier heap than it leaves.
    expect(bytes).toBeLessThan(FRESH_ENGINE_BUDGET);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Orchestrator fast-path (no plugin → direct delegate)
  // ═══════════════════════════════════════════════════════════════════════

  test("orchestrator: warm fast path allocates < 768KB", () => {
    const e = createEngine();
    // Warm to establish baseline
    e.evaluateLine(1, "1 + 2");

    settle();
    const start = process.memoryUsage().heapUsed;
    const [result] = e.evaluateLine(1, "1 + 2");
    const end = process.memoryUsage().heapUsed;

    expect(result?.value).toBe(3);
    note("orchestrator warm", end - start);
    // 9.7KB observed. An older comment here claimed 455KB, which was float left
    // by a single-pass gc rather than anything this line allocates; the second
    // settle pass removed it. The budget stays wide because the metric is a
    // plain delta, not because a single warm evaluation costs anything close.
    expect(end - start).toBeLessThan(768 * 1024);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Document-scale allocation
  // ═══════════════════════════════════════════════════════════════════════

  test("document: 50-line doc (fresh engine) retains < 768KB", () => {
    const source = buildDocument(50);

    const { bytes } = trackRetained(() => {
      const e = createEngine();
      e.parseDocument(source);
      return e;
    });

    note("doc 50", bytes);
    // 337KB observed in a full bench run, 340KB standalone, of which about
    // 182KB is engine bootstrap. The old comment on this line read "~556KB
    // observed" against a 2MB budget while the case actually measured 2.19MB;
    // both numbers described a metric this case no longer uses.
    expect(bytes).toBeLessThan(768 * 1024);
  });

  test("document: 200-line doc (fresh engine) retains < 1.5MB", () => {
    const source = buildDocument(200);

    const { bytes } = trackRetained(() => {
      const e = createEngine();
      e.parseDocument(source);
      return e;
    });

    note("doc 200", bytes);
    // 728KB observed in a full bench run, 751KB standalone, of which about
    // 182KB is engine bootstrap. Four times the lines of the case above for
    // roughly four times its document cost, which is the shape to expect.
    expect(bytes).toBeLessThan(1536 * 1024);
  });
});
