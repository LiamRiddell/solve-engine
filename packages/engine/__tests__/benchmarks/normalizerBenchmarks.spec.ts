/**
 * Normalizer Benchmarks - Jest compatible
 *
 * The normalizer is the one pipeline stage whose cost scales with the number
 * of registered rules: `TokenNormalizer.normalize` tries every rule eligible
 * at a position, at every position, over passes to a fixpoint. It was also the
 * one stage with no benchmark, and `fullPipelineThroughputBenchmarks` builds
 * its token stream without it, so the recorded lex/parse/execute split does
 * not account for it at all.
 *
 * The cases below are chosen to separate things that stage breakdown conflates:
 * a position where no rule can fire, one where many rules are tried and all
 * fail, and one where a rule fires and forces another pass. The rule set comes
 * from a real `ExpressionEngine`, never a hand-registered mirror, so it cannot
 * drift from what ships.
 */

import { describe, expect, test, afterAll } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { Token } from "@solve-js/lexer/Token";
import { benchmarkFn } from "@tools/testUtils";
import { recordSample, writeBenchmarkResults, BenchmarkResults } from "@tools/benchmarkIO";

describe("Normalizer Benchmarks", () => {
  const results: BenchmarkResults = {};

  afterAll(() => {
    writeBenchmarkResults("normalizer", results, "ms");
  });

  // One engine for the whole suite: the rule set is what is being measured,
  // and building it per case would time construction instead.
  const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  const normalizer = engine.getNormalizer();
  const lexer = engine.getLexer();

  /**
   * Lex one line the way `prepareExpression` does, so the token stream handed
   * to `normalize()` is the one production hands it. COMMENT is dropped there
   * (no parselet); nothing else is filtered.
   */
  function lex(text: string): Token[] {
    lexer.resetExpression(text);
    const tokens: Token[] = [];
    for (const t of lexer) {
      if (t.type !== "COMMENT") tokens.push(t);
    }
    return tokens;
  }

  const cases = [
    // No word tokens at all: the NON_WORD_TABLE guard should reject every
    // position before the trie, and the rule scan is the only cost left.
    { name: "noop_arithmetic", input: "12 + 34 * (56 - 7) / 8", iters: 20000 },

    // The pathology. Every one of these words is an IDENT that matches no
    // rule, and the IDENT bucket currently holds every registered rule.
    { name: "noop_prose", input: "The quarterly report covers revenue and cost", iters: 20000 },

    // The shape the throughput tiers are actually made of.
    { name: "assignment", input: ":v42 = 43", iters: 20000 },

    // Fires implicit:multiply, which forces a second full pass.
    { name: "implicit_multiply", input: "2(x + 1) + 3y", iters: 20000 },

    // Phrase trie hit plus a second pass.
    { name: "phrase_fusion", input: "10 increase by 5%", iters: 20000 },

    // The value-triggered call-fusion family.
    { name: "call_fusion", input: 'sha256("hi") + base64("x")', iters: 20000 },

    // The UOM cluster.
    { name: "unit_conversion", input: "120 km/h to m/s", iters: 20000 },

    // The datetime cluster, multi-pass.
    { name: "date_literal", input: "25/12/2026 until now", iters: 10000 },

    // Scaling in tokens per line, with no rule ever firing.
    { name: "long_prose_line", input: Array(200).fill("word").join(" "), iters: 2000 },
  ];

  for (const c of cases) {
    test(`normalizes "${c.name}" (${c.iters.toLocaleString()} iter)`, async () => {
      const tokens = lex(c.input);
      // normalize() does not mutate its input, so one array can be reused.
      const r = await benchmarkFn(() => {
        normalizer.normalize(tokens);
      }, c.iters, Math.min(100, Math.floor(c.iters / 10)));
      recordSample(results, c.name, r);
      expect(r.medianMs).toBeLessThan(5);
    });
  }

  /**
   * The "big document" number: normalising every line of a 500-line mixed
   * document as one timed unit. This is the case that should move when the
   * rule index lands, and the one that corresponds to the stated pain.
   *
   * Line shapes mirror `generateTierDocument` in
   * fullPipelineThroughputBenchmarks so the two suites describe the same
   * document.
   */
  test("normalizes a 500-line document (200 iter)", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      switch (i % 5) {
        case 0: lines.push(`:v${i} = ${(i % 100) + 1}`); break;
        case 1: lines.push(`:v${i} + ${(i % 50) + 10}`); break;
        case 2: lines.push(i % 2 === 0 ? `sqrt(${(i % 100) + 1})` : `abs(-${(i % 100) + 1})`); break;
        case 3: lines.push(`${(i % 50) + 1}% of ${(i % 200) + 100}`); break;
        default: lines.push(`:v${i % 100} + ${(i % 20) + 1}`); break;
      }
    }
    const perLine = lines.map(lex);

    const r = await benchmarkFn(() => {
      for (const tokens of perLine) {
        normalizer.normalize(tokens);
      }
    }, 200, 20);
    recordSample(results, "document_500_lines", r);
    expect(r.medianMs).toBeLessThan(500);
  });
});
