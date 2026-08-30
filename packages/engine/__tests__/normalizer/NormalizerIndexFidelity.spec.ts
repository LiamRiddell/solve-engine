/**
 * Proves the shape index is a pure filter.
 *
 * The hazard the index introduces runs one way. A rule whose declared
 * {@link RuleSlot} shape admits more than it can match pays a `match()` call
 * that returns null, which is what happened before the index existed. A rule
 * whose shape admits LESS becomes unreachable at the positions left out, and
 * nothing about that is loud: no error, no failing type, just a feature that
 * quietly stops working for one spelling.
 *
 * So the declarations are not reviewed, they are checked, two ways:
 *
 * 1. Per rule, over a corpus: run every rule unfiltered at every position and
 *    record where it really matches, then assert the index admits each of those
 *    positions. This localises a bad declaration to the rule that made it.
 * 2. Whole normalizer, over the same corpus: the indexed walk and the
 *    unindexed one must agree token for token, which also covers rules a
 *    package registers that this file has never heard of.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { TokenNormalizer } from "@solve-js/normalizer/TokenNormalizer";
import { RuleIndex, effectiveShape, isEmptyMask } from "@solve-js/normalizer/RuleIndex";
import type { NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import type { Token } from "@solve-js/lexer/Token";

/**
 * Expressions exercising every rule family the built-in packages register.
 *
 * Breadth matters more than depth here: a shape is only proven at the spellings
 * something actually reaches, so a family absent from this list is a family
 * whose declaration is unproven. Kept beside the rules rather than harvested
 * from the docs so that a spelling with no documentation page is still covered.
 */
const CORPUS: string[] = [
  // Plain arithmetic and grouping, where nothing should fire.
  "12 + 34 * (56 - 7) / 8",
  "The quarterly report covers revenue and cost",
  ":v42 = 43",
  "sqrt(144) + 5",

  // Implicit multiplication.
  "2(x + 1) + 3y",
  "5(3 + 2)",
  "2 power of 3",
  "99 per week",

  // Phrases.
  "10 increase by 5%",
  "half of 250",
  "2 to the power of 8",

  // Clock times, laptimes, timecodes, frames.
  "9:00am + 30 minutes",
  "16:00",
  "4pm",
  "01:02:03",
  "01:02:03:04 @ 30fps",
  "10 frames at 24fps",
  "9:30 to 17:00",

  // Ranges, which the time rules must NOT claim.
  "map(10*x, 0:3)",
  "[1, 2, 3]",

  // Units, compounds, rates, conversions.
  "120 km/h to m/s",
  "3 kg + 2 kg",
  "5 m/s^2",
  "100 miles per gallon",
  "1 hour 30 minutes",
  "20 degrees celsius in fahrenheit",
  "8 L/100km",
  "$50 at 5% per year",

  // Dates.
  "25/12/2026",
  "March 9, 2024",
  "next friday",
  "3rd monday of January",
  "days until christmas",
  "now + 5 days",

  // Call-fusion families.
  'sha256("hi")',
  'md5("x")',
  'base64("hello")',
  'upper("text")',
  "mean(1, 2, 3)",
  "median(4, 5, 6)",
  "pick(1, 2, 3)",
  "ratio(3, 4)",
  "bmi(70, 1.8)",
  "rgb(255, 0, 0)",
  "plot(x^2)",
  "solve(x + 2 = 10)",
  "derivative(x^2)",

  // Percentages.
  "200 + 10%",
  "50% of 200",
  "20% off 80",
  "increase 100 by 10%",

  // Numerics and literals.
  "1.5M + 2k",
  "3 + 4i",
  "192.168.0.1/24",
  "0xFF + 0b1010",
  "1/2 + 1/3",

  // Uncertainty, bigint, misc.
  "10 +/- 2",
  "2^100",
  "45°",

  // Variables and line references.
  ":total = 100",
  "line 1 + 2",
  "sum(line1: line2)",
];

/** Lex a line the way `prepareExpression` does. */
function lexAll(engine: ExpressionEngine, text: string): Token[] {
  const lexer = engine.getLexer();
  lexer.resetExpression(text);
  const out: Token[] = [];
  for (const t of lexer) if (t.type !== "COMMENT") out.push(t);
  return out;
}

/** Whether `mask` has the bit for rule index `i` set. */
function admits(mask: Uint32Array, i: number): boolean {
  return (mask[(i / 32) | 0] & (1 << (i % 32))) !== 0;
}

describe("normalizer shape index fidelity", () => {
  const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  const normalizer = engine.getNormalizer();
  const rules: NormalizerRule[] = [...(normalizer as unknown as { rules: NormalizerRule[] }).rules]
    .sort((a, b) => b.priority - a.priority);
  const index = new RuleIndex(rules);

  const streams = CORPUS.map((text) => ({ text, tokens: lexAll(engine, text) }));

  test("the corpus lexes to something", () => {
    for (const { text, tokens } of streams) {
      expect({ text, count: tokens.length }).toEqual({ text, count: tokens.length });
      expect(tokens.length).toBeGreaterThan(0);
    }
  });

  test("every position a rule really matches is admitted by its declared shape", () => {
    const violations: string[] = [];

    for (const { text, tokens } of streams) {
      for (let pos = 0; pos < tokens.length; pos++) {
        const mask = index.candidates(tokens, pos);
        // Copy: candidates() reuses one scratch buffer.
        const snapshot = Uint32Array.from(mask);

        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          let matched = false;
          try {
            matched = rule.match(tokens, pos) !== null;
          } catch {
            // A rule throwing on a shape it cannot handle is not this test's
            // subject; it cannot match there either way.
            matched = false;
          }
          if (matched && !admits(snapshot, i)) {
            violations.push(
              `${rule.name} matches "${text}" at ${pos} (${tokens[pos].type} "${tokens[pos].value}") ` +
              `but its shape ${JSON.stringify(effectiveShape(rule))} excludes that position`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("the indexed and unindexed walks agree token for token", () => {
    const indexed = new TokenNormalizer();
    const plain = new TokenNormalizer({ ignoreRuleIndex: true });
    for (const rule of rules) {
      indexed.register(rule);
      plain.register(rule);
    }
    for (const [phrase, type] of Object.entries(normalizer.getPhrases())) {
      indexed.addPhrase(phrase, type);
      plain.addPhrase(phrase, type);
    }

    for (const { text, tokens } of streams) {
      const a = indexed.normalize(tokens);
      const b = plain.normalize(tokens);
      const shape = (ts: Token[]) => ts.map((t) => `${t.type}:${t.value}@${t.offset}`);
      expect({ text, tokens: shape(a) }).toEqual({ text, tokens: shape(b) });
    }
  });

  test("a rule declaring no shape is admitted everywhere", () => {
    const anywhere: NormalizerRule = {
      name: "test:anywhere",
      priority: 1,
      match: () => null,
    };
    const only = new RuleIndex([anywhere]);
    for (const { tokens } of streams) {
      for (let pos = 0; pos < tokens.length; pos++) {
        expect(isEmptyMask(only.candidates(tokens, pos))).toBe(false);
      }
    }
  });

  test("a wildcard slot constrains nothing at all, existence included", () => {
    // The IDA-signature shape: NUMBER ?? UNIT, where the middle token is
    // unconstrained. An empty slot narrows nothing at its own position while
    // still holding the positions on either side of it in place.
    const numberAnyUnit: NormalizerRule = {
      name: "test:number-any-unit",
      priority: 1,
      shape: [{ types: ["NUMBER"] }, {}, { types: ["UNIT"] }],
      match: () => null,
    };
    const only = new RuleIndex([numberAnyUnit]);

    const admitted = (text: string): string[] => {
      const tokens = lexAll(engine, text);
      const out: string[] = [];
      for (let pos = 0; pos < tokens.length; pos++) {
        if (!isEmptyMask(only.candidates(tokens, pos))) out.push(`${tokens[pos].type}:${tokens[pos].value}`);
      }
      return out;
    };

    // Both numbers survive. The third slot is past MAX_PLANES so it is never
    // consulted, and the wildcard second slot rejects nothing, which is the
    // documented safe direction: a shallower filter admits more candidates and
    // each still runs its own match().
    expect(admitted("3 + 2 kg")).toEqual(["NUMBER:3", "NUMBER:2"]);

    // Deliberately UNLIKE an IDA `??`, which asserts a byte is present because
    // its patterns are fixed length. An empty slot here constrains nothing,
    // and "nothing" includes existence, so a lone NUMBER at the end of the
    // stream is still admitted. The stricter reading would be more selective
    // and is the unsafe direction: a rule that can legitimately match on fewer
    // tokens than it declared slots would become unreachable.
    expect(admitted("5")).toEqual(["NUMBER:5"]);
  });

  test("a declared shape excludes the positions it does not name", () => {
    const numberThenColon: NormalizerRule = {
      name: "test:number-colon",
      priority: 1,
      shape: [{ types: ["NUMBER"] }, { types: ["COLON"] }],
      match: () => null,
    };
    const only = new RuleIndex([numberThenColon]);
    const tokens = lexAll(engine, "9:30 + 4");

    const admitted: number[] = [];
    for (let pos = 0; pos < tokens.length; pos++) {
      if (!isEmptyMask(only.candidates(tokens, pos))) admitted.push(pos);
    }

    // Only the "9" is a NUMBER followed by a COLON.
    expect(admitted.map((p) => `${tokens[p].type}:${tokens[p].value}`)).toEqual(["NUMBER:9"]);
  });
});
