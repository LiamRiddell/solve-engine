/**
 * LanguageService Benchmarks - Jest compatible
 *
 * Measures the two per-keystroke costs the real editor can opt into:
 * highlighting (getSemanticTokens, lexer-backed) and completions
 * (getCompletions, prefix-matched against a candidate pool). Both are
 * gated behind independent settings toggles in MarkdownEditorViewPlugin
 * (syntaxHighlight.enabled / completions.enabled, both fully short-
 * circuited before any engine call when off — see
 * MarkdownEditorViewPlugin.spec.ts's "zero cost when off" tests), so
 * these numbers are specifically what a user opting IN is paying —
 * not baseline editor overhead.
 */

import { describe, expect, test, afterAll } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { LanguageService } from "@solve-js/language/LanguageService";
import { benchmarkFn } from "@tools/testUtils";
import { recordSample, writeBenchmarkResults, BenchmarkResults } from "@tools/benchmarkIO";

describe("LanguageService Benchmarks", () => {
  const results: BenchmarkResults = {};

  afterAll(() => {
    writeBenchmarkResults("language-service", results, "ms");
  });

  // ─── getSemanticTokens: cold (cache miss every call) ───

  const highlightCases = [
    { name: "highlight_simple_arithmetic", input: "1 + 2 * 3", iters: 20000 },
    { name: "highlight_mixed_expression", input: "$10 + 50% of 200 - 3 kg", iters: 10000 },
    { name: "highlight_long_expression", input: Array(50).fill("1+1").join(" + "), iters: 2000 },
    { name: "highlight_inline_solve_in_text", input: "some text s`1 + 2` and more text", iters: 10000 },
    { name: "highlight_unrecognized_prose", input: "My name is dave and I like turtles", iters: 10000 },
  ];

  for (const c of highlightCases) {
    test(`getSemanticTokens cold: "${c.name}" (${c.iters.toLocaleString()} iter)`, async () => {
      const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
      const service = new LanguageService(engine);
      let line = 1;
      const r = await benchmarkFn(() => {
        // A fresh line number on every call defeats the cache — this is
        // the true per-keystroke cost (every edit invalidates its line).
        service.getSemanticTokens(c.input, line++);
      }, c.iters, Math.min(100, Math.floor(c.iters / 10)));
      recordSample(results, c.name, r);
      expect(r.medianMs).toBeLessThan(2);
    });
  }

  // ─── getSemanticTokens with normalization folded in ───
  //
  // `normalizeForHighlighting` is what makes a phrase-fused type reachable
  // from the highlighting path: a date literal, a timecode, a package's own
  // fused token. It also means running the normalizer per keystroke, which is
  // the reason it is off by default rather than simply switched on. These
  // record both sides on the same inputs so the price is a number rather than
  // a feeling.

  for (const c of highlightCases) {
    test(`getSemanticTokens cold, normalized: "${c.name}" (${c.iters.toLocaleString()} iter)`, async () => {
      const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
      const service = new LanguageService(engine, { normalizeForHighlighting: true });
      let line = 1;
      const r = await benchmarkFn(() => {
        service.getSemanticTokens(c.input, line++);
      }, c.iters, Math.min(100, Math.floor(c.iters / 10)));
      recordSample(results, `${c.name}_normalized`, r);
      expect(r.medianMs).toBeLessThan(2);
    });
  }

  test("getSemanticTokens cold, normalized: a line that actually fuses", async () => {
    // Every case above is one the normalizer finds nothing to do on, which
    // measures the overhead of asking. This one measures the work itself.
    const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
    const service = new LanguageService(engine, { normalizeForHighlighting: true });
    let line = 1;
    const r = await benchmarkFn(() => {
      service.getSemanticTokens("12/09/2026 + 10 frames", line++);
    }, 10000, 100);
    recordSample(results, "highlight_fusing_line_normalized", r);
    expect(r.medianMs).toBeLessThan(2);
  });

  test("getSemanticTokens warm (cache hit — same line, same text, repeated)", async () => {
    const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
    const service = new LanguageService(engine);
    const input = "$10 + 50% of 200 - 3 kg";
    service.getSemanticTokens(input, 1); // prime the cache
    const r = await benchmarkFn(() => {
      service.getSemanticTokens(input, 1);
    }, 50000, 500);
    recordSample(results, "highlight_warm_cache_hit", r);
    expect(r.medianMs).toBeLessThan(0.01);
  });

  // ─── getCompletions: cold (first call — builds the static candidate cache) ───

  test("getCompletions cold (first call — builds keyword/unit/package candidate list)", async () => {
    const r = await benchmarkFn(() => {
      const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
      const service = new LanguageService(engine);
      service.getCompletions("sq", 2);
    }, 500, 20);
    recordSample(results, "completions_cold_first_call", r);
  });

  // ─── getCompletions: warm (static candidates cached, only prefix-filter cost remains) ───

  const completionCases = [
    { name: "completions_warm_short_prefix", prefix: "s", iters: 20000 },
    { name: "completions_warm_specific_prefix", prefix: "sqrt", iters: 20000 },
    { name: "completions_warm_no_match", prefix: "zzzznomatch", iters: 20000 },
  ];

  for (const c of completionCases) {
    test(`getCompletions warm: "${c.name}" (${c.iters.toLocaleString()} iter)`, async () => {
      const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
      const service = new LanguageService(engine);
      service.getCompletions(c.prefix, c.prefix.length); // prime the static cache
      const r = await benchmarkFn(() => {
        service.getCompletions(c.prefix, c.prefix.length);
      }, c.iters, Math.min(200, Math.floor(c.iters / 10)));
      recordSample(results, c.name, r);
      expect(r.medianMs).toBeLessThan(1);
    });
  }

  test("getCompletions warm with a large document-variable pool (500 variables)", async () => {
    const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
    const varNames = Array.from({ length: 500 }, (_, i) => `variable${i}`);
    const service = new LanguageService(engine, { variableNameSource: () => varNames });
    service.getCompletions("var", 3);
    const r = await benchmarkFn(() => {
      service.getCompletions("var", 3);
    }, 5000, 100);
    recordSample(results, "completions_warm_500_variables", r);
    expect(r.medianMs).toBeLessThan(2);
  });

  // ─── Realistic per-keystroke simulation: viewport-sized document rebuild ───
  //
  // Mirrors buildDecorations()'s actual access pattern: one getSemanticTokens
  // call per visible line, for a viewport-sized slice of a document, on
  // every keystroke (each line re-lexed since it's a fresh cache in this
  // "cold viewport" case — the worst-case cost a rebuild pays before any
  // caching kicks in, e.g. right after a document switch).

  const viewportSizes = [50, 100, 200];
  for (const size of viewportSizes) {
    test(`highlighting a ${size}-line viewport (cold, one getSemanticTokens call per line)`, async () => {
      const engine = new ExpressionEngine("en", false, undefined, undefined, BUILTIN_PACKAGES);
      const service = new LanguageService(engine);
      const lines = Array.from({ length: size }, (_, i) => `${i} + ${i + 1} * 2`);
      let generation = 0;
      const r = await benchmarkFn(() => {
        generation++;
        for (let i = 0; i < lines.length; i++) {
          // Vary line number per generation so every pass is a cache miss —
          // measures the cold rebuild cost, not steady-state cache hits.
          service.getSemanticTokens(lines[i], i + 1 + generation * size);
        }
      }, 200, 10);
      recordSample(results, `highlight_viewport_${size}_lines_cold`, r);
    });
  }
});
