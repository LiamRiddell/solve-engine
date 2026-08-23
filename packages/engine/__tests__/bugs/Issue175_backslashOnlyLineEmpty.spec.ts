import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * Issue #175: a line of only skipped characters must not evaluate to 0.
 *
 * The lexer discards any unknown ASCII character (a backslash falls through to
 * `CharClass.SKIP`), the same path whitespace takes, so a line built only from
 * them tokenises to an empty token stream. It was still classified as an
 * `expression` and evaluated, and the engine reports an empty token stream as
 * the number 0, so `\`, `\\` and `\\\\` showed a result of 0 in the notepad and
 * the playground where a blank line, a heading and prose all show nothing.
 *
 * The classifier now treats a line whose every character is discarded (ASCII
 * whitespace or a skip character) as empty, the same as a blank line, so every
 * surface skips it. A backslash next to real content is unaffected: `\1` is
 * still 1 (the backslash is skipped), and `1 \ 2` still errors on the trailing 2.
 */
describe("Issue #175: a line of only skipped characters is empty, not 0", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  describe("classifyLine marks an all-skippable line as empty", () => {
    test.each([["\\"], ["\\\\"], ["\\\\\\\\"], ["  \\\\  "]])(
      "%j classifies as empty and skipped",
      (line) => {
        const c = engine.getLexer().classifyLine(line);
        expect(c.type).toBe("empty");
        expect(c.skip).toBe(true);
      },
    );
  });

  describe("parseDocument reports no result and no error for such a line", () => {
    test.each([["\\"], ["\\\\"], ["\\\\\\\\"]])("%j has no result", (line) => {
      const { lines } = engine.parseDocument(line);
      expect(lines).toHaveLength(1);
      expect(lines[0].result).toBeNull();
      expect(lines[0].error).toBeNull();
      expect(lines[0].isEmpty).toBe(true);
    });

    test("a backslash line between real ones does not show 0", () => {
      const { lines } = engine.parseDocument("42\n\\\\\\\\\n1 + 1");
      expect(lines[0].result?.toNumber()).toBe(42);
      expect(lines[1].result).toBeNull();
      expect(lines[1].error).toBeNull();
      expect(lines[2].result?.toNumber()).toBe(2);
    });
  });

  describe("a backslash next to real content is unchanged", () => {
    test("`\\1` still evaluates to 1 (the backslash is skipped)", () => {
      expect(engine.evaluateExpression("\\1")[0].toNumber()).toBe(1);
    });

    test("`1 \\ 2` still errors on the trailing token", () => {
      expect(() => engine.evaluateExpression("1 \\ 2")).toThrow();
    });

    test("a genuine expression and a blank line are unchanged", () => {
      const { lines } = engine.parseDocument("2 + 2\n\n3 * 3");
      expect(lines[0].result?.toNumber()).toBe(4);
      expect(lines[1].result).toBeNull();
      expect(lines[2].result?.toNumber()).toBe(9);
    });
  });
});
