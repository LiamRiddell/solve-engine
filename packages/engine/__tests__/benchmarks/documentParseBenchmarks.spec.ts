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
 * The documents below are written to be representative rather than uniform:
 * prose that must survive untouched sits beside dense arithmetic, unit maths,
 * dates, percentages and cross-line references, in the proportions a person
 * actually types.
 */

import { describe, expect, test, afterAll } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { benchmarkFn } from "@tools/testUtils";
import { recordSample, writeBenchmarkResults, BenchmarkResults } from "@tools/benchmarkIO";

/** A line of ordinary prose, which must normalise and parse to nothing at all. */
const PROSE = [
  "Notes from the quarterly planning session",
  "The team agreed the following budget for next year",
  "Remember to check these figures against the finance sheet",
  "Anything below is a working estimate and not final",
  "## Costs",
];

/** Everyday arithmetic and money, the commonest real content. */
const SIMPLE = [
  ":budget = 48000",
  ":headcount = 6",
  ":budget / :headcount",
  "1200 + 340 + 89",
  "15% of 48000",
  "48000 - 12%",
  ":rent = 2400 * 12",
];

/** Units, rates, conversions, times: the phrase-heavy end. */
const UNITS = [
  "120 km/h to m/s",
  "3.5 kg + 400 g",
  "8 L/100km in mpg",
  "20 degrees celsius in fahrenheit",
  "1 hour 30 minutes + 45 minutes",
  "9:00am to 17:30",
  "250 GB / 8",
];

/** Dates and durations. */
const DATES = [
  "25/12/2026 - now",
  "now + 90 days",
  "days until 01/01/2027",
  "3 weeks in hours",
];

/** Longer expressions with nesting, functions and mixed types. */
const COMPLEX = [
  "sqrt(144) + 50% of 200 - 3 * (10 + 5)",
  "(1200 + 340) * 1.2 / (4 - 1)",
  "round((48000 / 6) * 0.85, 2)",
  "max(120, 340, 89) - min(12, 45, 7)",
  "((2 + 3) * (4 + 5)) ^ 2 / 15",
  "12% of (48000 / 6) + 250 GB / 8",
];

/** Cross-line references, which force the document machinery. */
const CROSS = [
  ":subtotal = 1200 + 340",
  ":subtotal * 1.2",
  "line 1 + 100",
  "total above",
];

/**
 * Build a document of `lines` lines by cycling the pools in a fixed ratio,
 * roughly: 30% prose, 25% simple, 15% units, 10% dates, 15% complex, 5% cross.
 */
function buildDocument(lines: number): string {
  const out: string[] = [];
  const pools: Array<{ pool: string[]; weight: number }> = [
    { pool: PROSE, weight: 30 },
    { pool: SIMPLE, weight: 25 },
    { pool: UNITS, weight: 15 },
    { pool: DATES, weight: 10 },
    { pool: COMPLEX, weight: 15 },
    { pool: CROSS, weight: 5 },
  ];
  let i = 0;
  while (out.length < lines) {
    for (const { pool, weight } of pools) {
      for (let k = 0; k < weight && out.length < lines; k++) {
        out.push(pool[(i + k) % pool.length]);
      }
    }
    i++;
  }
  return out.join("\n");
}

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
  const SIZES = [
    { name: "doc_50_lines", lines: 50, iters: 200 },
    { name: "doc_250_lines", lines: 250, iters: FULL_BUDGET },
    { name: "doc_1000_lines", lines: 1000, iters: FULL_BUDGET },
    { name: "doc_10000_lines", lines: 10000, iters: FULL_BUDGET },
  ];

  for (const size of SIZES) {
    test(`parses a realistic ${size.lines}-line document (cold engine)`, async () => {
      const doc = buildDocument(size.lines);
      const r = await benchmarkFn(() => {
        const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
        engine.parseDocument(doc);
      }, size.iters, 5);
      recordSample(results, `${size.name}_cold`, r);
      expect(r.medianMs).toBeGreaterThan(0);
    });

    test(`re-parses a realistic ${size.lines}-line document (warm engine)`, async () => {
      const doc = buildDocument(size.lines);
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
