/**
 * Incremental-evaluator benchmarks: what a live editor pays per pass and per
 * keystroke through a long-lived `ThreeTierEvaluator`.
 *
 * No benchmark constructed one before this suite, which is how a quadratic
 * repeat pass over bare assignments (#712) and a keystroke that cost eleven
 * times an in-place edit (#713) went unnoticed. The cases are the shapes those
 * issues measured: a second pass with no edit, a keystroke sent both ways, an
 * inserted line (the order-tree walk, #763), and an undefined name evaluated
 * from a timer callback (#714).
 *
 * Absolute bounds follow the rule set in #364: generous, to catch a collapse
 * without measuring the runner. The scaling assertions are what catch a
 * complexity regression: a ratio between two sizes, which the runner's speed
 * cancels out of.
 */
import { describe, expect, test, afterAll } from "@jest/globals";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { SegmentTree } from "@solve-js/engine/SegmentTree";
import { newTrackedEngine } from "@tools/trackedEngine";
import { recordSample, writeBenchmarkResults, BenchmarkResults } from "@tools/benchmarkIO";

/** Median, mean and minimum of `runs` timed calls, after one untimed warm-up. */
function sample(fn: () => void, runs: number): { meanMs: number; medianMs: number; minMs: number } {
  fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { meanMs: times.reduce((a, b) => a + b, 0) / runs, medianMs: times[runs >> 1], minMs: times[0] };
}

/** An evaluator over `lines`, evaluated once so every later pass is a repeat. */
function evaluated(lines: string[]): { doc: DocumentModel; evaluator: ThreeTierEvaluator } {
  const doc = new DocumentModel();
  doc.setDocument(lines.join("\n"));
  const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
  evaluator.evaluateAll();
  return { doc, evaluator };
}

const assignments = (count: number, colon: boolean) => Array.from({ length: count }, (_, i) => `${colon ? ":" : ""}v${i} = ${i + 1}`);

/** `:v0 = 1`, `v0 * 2`, `:v1 = 2`, ...: the #713 document. */
function alternating(count: number): string[] {
  const lines: string[] = [];
  for (let i = 0; lines.length < count; i++) {
    lines.push(`:v${i} = ${i + 1}`);
    lines.push(`v${i} * 2`);
  }
  return lines.slice(0, count);
}

describe("Incremental edit benchmarks", () => {
  const results: BenchmarkResults = {};
  const live: ThreeTierEvaluator[] = [];

  afterAll(() => {
    for (const evaluator of live) evaluator.terminateWorker();
    writeBenchmarkResults("incremental-edit", results, "ms");
  });

  test("a second pass over bare assignments scales linearly (#712)", () => {
    const small = evaluated(assignments(1_000, false));
    const large = evaluated(assignments(4_000, false));
    live.push(small.evaluator, large.evaluator);
    const r1 = sample(() => small.evaluator.evaluateAll(), 7);
    const r4 = sample(() => large.evaluator.evaluateAll(), 7);
    recordSample(results, "second_pass_bare_1k", r1);
    recordSample(results, "second_pass_bare_4k", r4);
    // Four times the lines: linear is about 4, the quadratic walk was over 20.
    expect(r4.medianMs / r1.medianMs).toBeLessThan(10);
    expect(r4.medianMs).toBeLessThan(2_000);
  });

  test("a second pass over colon assignments, for comparison", () => {
    const { evaluator } = evaluated(assignments(4_000, true));
    live.push(evaluator);
    const r = sample(() => evaluator.evaluateAll(), 7);
    recordSample(results, "second_pass_colon_4k", r);
    expect(r.medianMs).toBeLessThan(2_000);
  });

  for (const size of [1_000, 5_000, 20_000]) {
    for (const path of ["applyTransaction", "editLine"] as const) {
      test(`a keystroke through ${path} at ${size.toLocaleString("en-US")} lines (#713)`, () => {
        const { doc, evaluator } = evaluated(alternating(size));
        live.push(evaluator);
        let toggle = false;
        const r = sample(() => {
          toggle = !toggle;
          const text = toggle ? ":v1 = 8" : ":v1 = 7";
          if (path === "editLine") doc.editLine(3, text);
          else evaluator.applyTransaction([{ startLine: 3, deleteCount: 1, insertLines: [text] }]);
          evaluator.evaluate({ startLine: 1, endLine: 40 });
        }, 21);
        recordSample(results, `keystroke_${path}_${size / 1_000}k`, r);
        expect(r.medianMs).toBeLessThan(200);
      });
    }
  }

  test("inserting a line at 20,000 lines (#763)", () => {
    const { evaluator } = evaluated(alternating(20_000));
    live.push(evaluator);
    const r = sample(() => {
      evaluator.applyTransaction([{ startLine: 3, deleteCount: 0, insertLines: ["1 + 1"] }]);
      evaluator.evaluate({ startLine: 1, endLine: 40 });
    }, 21);
    recordSample(results, "insert_line_20k", r);
    expect(r.medianMs).toBeLessThan(500);
  });

  test("the order tree's in-order walk at 20,000 lines (#763)", () => {
    const tree = new SegmentTree();
    tree.replaceAll(Array.from({ length: 20_000 }, (_, i) => i + 1));
    for (let i = 0; i < 2_000; i++) tree.spliceAt((i * 7919) % tree.length, 1, [20_001 + i]);
    let sum = 0;
    const walk = sample(() => tree.forEach((id) => { sum += id; }), 21);
    const iterate = sample(() => { for (const id of tree) sum += id; }, 21);
    recordSample(results, "order_walk_foreach_20k", walk);
    recordSample(results, "order_walk_iterator_20k", iterate);
    expect(sum).toBeGreaterThan(0);
    expect(walk.medianMs).toBeLessThan(50);
    expect(iterate.medianMs).toBeLessThan(100);
  });

  test("an undefined name from a timer callback (#714)", async () => {
    // Jest calls a test body after an `await`, where V8 records no message for
    // a throw and the cost this case exists for does not appear, so the loop
    // runs from a timer callback, the context an editor's handler is in.
    const engine = newTrackedEngine();
    const perCall = (source: string): number => {
      const batches: number[] = [];
      for (let b = 0; b < 7; b++) {
        const start = performance.now();
        for (let i = 0; i < 2_000; i++) {
          try { engine.evaluateExpression(source); } catch { /* the undefined name */ }
        }
        batches.push((performance.now() - start) / 2_000);
      }
      batches.sort((a, b) => a - b);
      return batches[3];
    };
    const [undefinedName, sum] = await new Promise<[number, number]>((resolve) => {
      setTimeout(() => {
        perCall("zz + 1");
        perCall("2 + 5");
        resolve([perCall("zz + 1"), perCall("2 + 5")]);
      }, 0);
    });
    results.undefined_name_from_timer = { meanMs: undefinedName, medianMs: undefinedName };
    results.sum_from_timer = { meanMs: sum, medianMs: sum };
    // Compiled through ts-jest, about 24 times `2 + 5` with the throw inside
    // the loop and 6 to 13 times with it outside, on the machine #714's fix
    // was measured on; the bound sits between.
    expect(undefinedName / sum).toBeLessThan(18);
  });
});
