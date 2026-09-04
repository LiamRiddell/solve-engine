import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { RuleIndex, effectiveShape } from "@solve-js/normalizer/RuleIndex";
import type { NormalizerRule } from "@solve-js/normalizer/NormalizerRule";
import type { Token } from "@solve-js/lexer/Token";

const SAMPLES = [
  "12 + 34 * (56 - 7) / 8",
  "The quarterly report covers revenue and cost",
  ":v42 = 43",
  "9:00am + 30 minutes",
  "3 kg + 2 kg",
  'sha256("hi") + base64("x")',
  "120 km/h to m/s",
  "2(x + 1) + 3y",
];

function popcount(mask: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    let v = mask[i];
    while (v !== 0) { v &= v - 1; n++; }
  }
  return n;
}

/**
 * Guards that the index actually filters.
 *
 * Behaviour parity alone cannot tell a working index from one that admits
 * every rule at every position: both produce identical output, and only one is
 * fast. That is exactly how the `startTokenTypes` hint came to filter nothing
 * in the case that mattered, since all thirteen rules carrying it declared the
 * same, commonest type. So the candidate count is asserted, not just the
 * result.
 */
describe("normalizer shape index selectivity", () => {
  test("the index cuts candidates per position by several times", () => {
    const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    const normalizer = engine.getNormalizer();
    const rules: NormalizerRule[] = [...(normalizer as unknown as { rules: NormalizerRule[] }).rules]
      .sort((a, b) => b.priority - a.priority);
    const index = new RuleIndex(rules);
    const lexer = engine.getLexer();

    const shaped = rules.filter(r => effectiveShape(r).length > 0).length;
    console.log(`RULES=${rules.length} SHAPED=${shaped} UNSHAPED=${rules.length - shaped}`);

    let grandOld = 0, grandNew = 0, grandPos = 0, zeroPos = 0;

    for (const text of SAMPLES) {
      lexer.resetExpression(text);
      const tokens: Token[] = [];
      for (const t of lexer) if (t.type !== "COMMENT") tokens.push(t);

      let oldTotal = 0, newTotal = 0;
      for (let pos = 0; pos < tokens.length; pos++) {
        // Unindexed: every rule with no startTokenTypes, plus those listing this type.
        const before = rules.filter(
          r => r.startTokenTypes === undefined || r.startTokenTypes.includes(tokens[pos].type),
        ).length;
        const after = popcount(index.candidates(tokens, pos));
        oldTotal += before;
        newTotal += after;
        if (after === 0) zeroPos++;
      }
      grandOld += oldTotal; grandNew += newTotal; grandPos += tokens.length;
      const avgB = (oldTotal / tokens.length).toFixed(1);
      const avgA = (newTotal / tokens.length).toFixed(1);
      console.log(`${avgB.padStart(5)} -> ${avgA.padStart(5)}  (${tokens.length} tok)  ${text}`);
    }

    const ratio = grandOld / Math.max(1, grandNew);
    console.log(`TOTAL per-position: ${(grandOld / grandPos).toFixed(1)} -> ${(grandNew / grandPos).toFixed(1)}`);
    console.log(`TOTAL match() calls: ${grandOld} -> ${grandNew}  (${ratio.toFixed(1)}x fewer)`);
    console.log(`positions with ZERO candidates: ${zeroPos}/${grandPos}`);

    // Measured at 3.4x when the shapes below were first declared. The floor is
    // set well under that so ordinary rule churn does not trip it, while a
    // change that quietly stops the index filtering still does.
    expect(ratio).toBeGreaterThan(2.5);

    // Every rule that declares no shape is admitted everywhere, so the
    // unshaped count is the floor on candidates per position. Pinning it keeps
    // that floor visible: a new rule landing without a shape raises the cost of
    // every position in every document, which is the regression this catches.
    expect(rules.length - shaped).toBeLessThanOrEqual(0);
  });
});
