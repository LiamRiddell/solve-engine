import { describe, expect, test } from "@jest/globals";
import { LanguageService } from "@solve-js/language/LanguageService";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Highlighting with the normalizer folded in.
 *
 * `LanguageService` classifies at the lexer stage by default, which means a
 * token type that only exists after phrase fusion is never reachable. Four
 * token types map to the `datetime` category and every one of them is produced
 * by a normalizer rule, so a date typed into an editor came back as number,
 * operator, number and a category the engine declares was unreachable in
 * practice.
 *
 * `normalizeForHighlighting` closes that. These tests are mostly about the part
 * that is genuinely hard: putting the resulting tokens back in the right place.
 * A fused token's text is the replacement rather than the source, and an
 * inserted token has no source at all.
 */

function tokens(line: string, normalize: boolean) {
  const engine = newTrackedEngine();
  const language = new LanguageService(engine, { normalizeForHighlighting: normalize });
  return language.getSemanticTokens(line, 1).map((token) => ({
    text: line.slice(token.from, token.to),
    category: token.category,
    from: token.from,
    to: token.to,
  }));
}

describe("normalizeForHighlighting is off by default", () => {
  test("a date is still classified at the lexer level", () => {
    const engine = newTrackedEngine();
    const language = new LanguageService(engine);
    const categories = language.getSemanticTokens("12/09/2026", 1).map((t) => t.category);
    expect(categories).toEqual(["number", "operator", "number", "operator", "number"]);
  });

  test("turning it off explicitly is the same as leaving it out", () => {
    expect(tokens("12/09/2026", false)).toEqual(tokens("12/09/2026", false));
    expect(tokens("12/09/2026", false).map((t) => t.category)).toEqual([
      "number",
      "operator",
      "number",
      "operator",
      "number",
    ]);
  });
});

describe("phrase fusion reaches the highlighter", () => {
  test("a date literal is one datetime span covering the whole date", () => {
    expect(tokens("12/09/2026", true)).toEqual([
      { text: "12/09/2026", category: "datetime", from: 0, to: 10 },
    ]);
  });

  test("a fused phrase spans its source, not its replacement text", () => {
    // `half of` fuses into HALF_OF, whose value happens to match its source.
    const [first] = tokens("half of 250", true);
    expect(first).toEqual({ text: "half of", category: "keyword", from: 0, to: 7 });
  });

  test("a fusion whose replacement text differs still covers the source", () => {
    // FRAME_COUNT's value is the number alone, so `offset + value.length`
    // would stop two characters in. This is the case `sourceEnd` exists for.
    const found = tokens("10 frames", true);
    const frames = found.find((t) => t.text.includes("frames"));
    expect(frames).toBeDefined();
    expect(frames?.text).toBe("10 frames");
  });
});

describe("inserted tokens are not painted", () => {
  test("implicit multiplication does not colour the parenthesis as an operator", () => {
    const found = tokens("5(3 + 2)", true);

    // The normalizer inserts a STAR at the `(`'s offset. If it were painted,
    // there would be an operator span starting at offset 1, which is where the
    // parenthesis is.
    const atParen = found.filter((t) => t.from === 1);
    expect(atParen.map((t) => t.category)).toEqual(["punctuation"]);
    expect(found.map((t) => t.text).join("")).toBe("5(3+2)");
  });

  test("no two spans overlap", () => {
    for (const line of ["5(3 + 2)", "2x + 1", "12/09/2026", "10 frames", "half of 250"]) {
      const found = tokens(line, true);
      for (let i = 1; i < found.length; i++) {
        expect(found[i].from).toBeGreaterThanOrEqual(found[i - 1].to);
      }
    }
  });

  test("every span lies inside the line", () => {
    for (const line of ["5(3 + 2)", "12 km in miles", "3 hours 20 minutes", "half of 250"]) {
      for (const token of tokens(line, true)) {
        expect(token.from).toBeGreaterThanOrEqual(0);
        expect(token.to).toBeLessThanOrEqual(line.length);
        expect(token.to).toBeGreaterThan(token.from);
      }
    }
  });
});

describe("ordinary lines are unchanged by it", () => {
  // The point of the flag is that it adds fused categories, not that it
  // rewrites what was already right.
  for (const line of ["1 + 2", "12 km", 'total = "gbp"', "sqrt(9)", "5 & 3", "1 >= 2"]) {
    test(`${line} classifies the same either way`, () => {
      expect(tokens(line, true)).toEqual(tokens(line, false));
    });
  }
});

describe("it degrades rather than failing", () => {
  test("a half-typed line still returns something or nothing, never throws", () => {
    for (const line of ["12/", "half of", "10 fra", "((((", "5 +"]) {
      expect(() => tokens(line, true)).not.toThrow();
    }
  });
});
