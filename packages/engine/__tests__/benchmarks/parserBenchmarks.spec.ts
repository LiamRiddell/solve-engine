/**
 * Parser & Bytecode Benchmarks - Jest compatible
 * Measures parsing + bytecode compilation performance.
 *
 * Uses a fully configured ParseletRegistry (same as ExpressionEngine).
 */

import { benchmarkFn, registerPackageForTesting } from "@tools/testUtils";
import { ARITHMETIC_PACKAGE, BIGINT_PACKAGE, CURRENCY_PACKAGE, DATETIME_PACKAGE, DICE_PACKAGE, FUNCTION_PACKAGE, PERCENTAGE_PACKAGE, UOM_PACKAGE, VARIABLES_PACKAGE, VECTOR_PACKAGE } from "@solve-js/packages";
import { describe, expect, test, afterAll } from "@jest/globals";
import { Parser } from "@solve-js/parser/Parser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { Lexer } from "@solve-js/lexer/Lexer";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { recordSample, writeBenchmarkResults, BenchmarkResults } from "@tools/benchmarkIO";

// Import all provider registration functions











function createConfiguredParser(): Parser {
  const registry = new ParseletRegistry();
  registerPackageForTesting(ARITHMETIC_PACKAGE, registry);
  registerPackageForTesting(PERCENTAGE_PACKAGE, registry);
  registerPackageForTesting(FUNCTION_PACKAGE, registry);
  registerPackageForTesting(DATETIME_PACKAGE, registry);
  registerPackageForTesting(DICE_PACKAGE, registry);
  registerPackageForTesting(VARIABLES_PACKAGE, registry);
  registerPackageForTesting(UOM_PACKAGE, registry);
  registerPackageForTesting(CURRENCY_PACKAGE, registry);
  registerPackageForTesting(VECTOR_PACKAGE, registry);
  registerPackageForTesting(BIGINT_PACKAGE, registry);
  return new Parser(registry);
}

function tokenize(input: string) {
  const lexer = new Lexer("en");
  lexer.reset(input);
  return Array.from(lexer).filter(
    (t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_")
  );
}

describe("Parser Benchmarks", () => {
  const results: BenchmarkResults = {};

  afterAll(() => {
    writeBenchmarkResults("parser", results, "ms");
  });

  const cases = [
    { name: "simple_arithmetic", input: "1 + 2 * 3", batches: 10, perBatch: 2500 },
    { name: "complex_expression", input: "(1 + 2 * 3 ^ 2) / 4", batches: 10, perBatch: 2500 },
    { name: "function_call", input: "sqrt(144)", batches: 10, perBatch: 2500 },
    { name: "percentage", input: "50% of 200", batches: 10, perBatch: 2500 },
    { name: "unit_conversion", input: "100 cm to m", batches: 10, perBatch: 2500 },
    { name: "datetime", input: "now + 5 days", batches: 10, perBatch: 2500 },
    { name: "dice", input: "roll(1, 20)", batches: 10, perBatch: 2500 },
    { name: "vector", input: "vec3(1, 2, 3)", batches: 10, perBatch: 2500 },
    { name: "variable", input: ":x = 42", batches: 10, perBatch: 2500 },
    { name: "mixed", input: "$10 + 50% of 200 - 3 kg", batches: 3, perBatch: 1000 },
  ];

  for (const c of cases) {
    test(`parses "${c.name}" efficiently`, async () => {
      const tokens = tokenize(c.input);
      // One parser and one builder for the whole run, the way the engine
      // holds them. With a fresh registry per iteration the figure was
      // registry construction, and a parser change could not move it.
      // Parselets read `this.builder` internally, so it must be set before
      // parseExpression() runs (mirrors ExpressionEngine's own private
      // parseExpression() helper). Measured through benchmarkFn so the suite
      // records a median like the others, rather than a mean of
      // performance.now() deltas that the clock's resolution dominated.
      const p = createConfiguredParser();
      const builder = new BytecodeBuilder();
      const r = await benchmarkFn(() => {
        builder.reset();
        p.setBuilder(builder);
        p.load(tokens);
        p.parseExpression(0);
      }, c.batches * c.perBatch, 100);
      recordSample(results, c.name, r);
      expect(r.medianMs).toBeLessThan(5);
    });
  }
});