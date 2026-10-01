/**
 * Document Parse Benchmarks - Jest compatible
 *
 * Measures `parseDocument` on whole documents rather than single expressions.
 *
 * The existing suites bracket this from both sides and neither answers it: the
 * per-stage breakdown times one representative expression, and the throughput
 * tiers use a synthetic document of `:v0 = 1` assignments whose lines are all
 * one shape. Neither says what a real notepad costs, and a real notepad is what
 * the engine is for.
 *
 * The documents are written to be representative rather than uniform: prose
 * that must survive untouched sits beside dense arithmetic, unit maths, dates,
 * percentages and cross-line references, in the proportions a person actually
 * types, and no line repeats, so the 10,000-line document is 10,000
 * compilations when cold (#715).
 */

import { describe, expect, test, afterAll } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { benchmarkFn } from "@tools/testUtils";
import { recordSample, writeBenchmarkResults, BenchmarkResults } from "@tools/benchmarkIO";
import { realisticDocument } from "@tools/benchmarkCorpora";

/** Longer expressions with nesting, functions and mixed types, for the complex-only case. */
const COMPLEX = [
  "sqrt(144) + 50% of 200 - 3 * (10 + 5)",
  "(1200 + 340) * 1.2 / (4 - 1)",
  "round((48000 / 6) * 0.85, 2)",
  "max(120, 340, 89) - min(12, 45, 7)",
  "((2 + 3) * (4 + 5)) ^ 2 / 15",
  "12% of (48000 / 6) + 250 GB / 8",
];

/** Lines of ordinary prose, which take the failed-parse path, for the prose-only case. */
const PROSE = [
  "Notes from the quarterly planning session",
  "The team agreed the following budget for next year",
  "Remember to check these figures against the finance sheet",
  "Anything below is a working estimate and not final",
  "## Costs",
];

describe("Document Parse Benchmarks", () => {
  const results: BenchmarkResults = {};

  afterAll(() => {
    writeBenchmarkResults("document-parse", results, "ms");
  });

  /**
   * `iters` is the sampling budget, not a loop count.
   *
   * `benchmarkFn` turns it into mitata's `min_cpu_time` as
   * `min(max(iters * 4, 100e6), 600e6)` nanoseconds, so anything small lands on
   * the 100ms floor. A 40ms document then yields two or three samples and a
   * median that swings 13% run to run, which is wider than any change worth
   * measuring. These values ask for the full 600ms instead, so even the
   * thousand-line case is a median over enough samples to mean something.
   */
  const FULL_BUDGET = 150_000_000;
  // The 10,000-line tier exists because the 1,000-line one could not see a
  // quadratic term: the whole-document scan used to cost each line the length
  // of the document after it, which at 1,000 lines is still a small number
  // and at 10,000 was two thirds of the parse. A document of that size is
  // within maxDocumentLines and is what a long-running notepad becomes.
  //
  // The names say `distinct` because the corpus changed under them (#715):
  // every line is now its own text, so a cold pass compiles all of them where
  // the old corpus repeated a few dozen. The comparison pairs cases by name,
  // and pairing these with the old corpus's timings reported a threefold
  // regression that the engine did not have (run on the old corpus, this tree
  // and its merge base agreed within noise). New names start a new series.
  const SIZES = [
    { name: "doc_50_distinct_lines", lines: 50, iters: 200 },
    { name: "doc_250_distinct_lines", lines: 250, iters: FULL_BUDGET },
    { name: "doc_1000_distinct_lines", lines: 1000, iters: FULL_BUDGET },
    { name: "doc_10000_distinct_lines", lines: 10000, iters: FULL_BUDGET },
  ];

  for (const size of SIZES) {
    test(`parses a realistic ${size.lines}-line document (cold engine)`, async () => {
      const doc = realisticDocument(size.lines);
      const r = await benchmarkFn(() => {
        const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
        engine.parseDocument(doc);
      }, size.iters, 5);
      recordSample(results, `${size.name}_cold`, r);
      expect(r.medianMs).toBeGreaterThan(0);
    });

    test(`re-parses a realistic ${size.lines}-line document (warm engine)`, async () => {
      const doc = realisticDocument(size.lines);
      const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
      engine.parseDocument(doc);
      const r = await benchmarkFn(() => {
        engine.parseDocument(doc);
      }, size.iters, 5);
      recordSample(results, `${size.name}_warm`, r);
      expect(r.medianMs).toBeGreaterThan(0);
    });
  }

  test("parses a document of only complex expressions", async () => {
    const doc = Array.from({ length: 200 }, (_, i) => COMPLEX[i % COMPLEX.length]).join("\n");
    const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    engine.parseDocument(doc);
    const r = await benchmarkFn(() => { engine.parseDocument(doc); }, FULL_BUDGET, 10);
    recordSample(results, "doc_200_complex_warm", r);
    expect(r.medianMs).toBeGreaterThan(0);
  });

  test("parses a document of only prose", async () => {
    const doc = Array.from({ length: 200 }, (_, i) => PROSE[i % PROSE.length]).join("\n");
    const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    engine.parseDocument(doc);
    const r = await benchmarkFn(() => { engine.parseDocument(doc); }, FULL_BUDGET, 10);
    recordSample(results, "doc_200_prose_warm", r);
    expect(r.medianMs).toBeGreaterThan(0);
  });
});
