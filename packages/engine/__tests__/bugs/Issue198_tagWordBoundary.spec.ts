import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { lineCarriesTag } from "@solve-js/packages/tags/TagScanner";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #198: the lexer and the tag scanner disagreed on what counts as a `#tag`
 * before a word character.
 *
 * The lexer emitted a `TAG` for any `#` followed by a letter, ignoring the
 * character before it, so `100#food` was stripped from the line's own result as
 * if tagged. The scanner the aggregates use (`packages/tags/TagScanner.ts`)
 * requires the `#` to sit at a non-word boundary (`(?:^|[^0-9A-Za-z_])#...`), so
 * it never recognised the same tag. The result was a line that looked tagged but
 * was silently left out of the totals.
 *
 * The fix requires the boundary in both: a `#` glued to the end of a word or
 * number is not a tag. That keeps `#` inside a word (`a#b`) out of the feature
 * and makes the two halves agree.
 */
describe("Issue #198: lexer and scanner agree on the boundary before #", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  const resultAt = (lines: string[], lineNo: number): string => {
    const parsed = engine.parseDocument(lines.join("\n")).lines;
    const line = parsed[lineNo - 1];
    return line.result ? formatValue(line.result) : (line.error ?? "(no result)");
  };

  /** The tag name the lexer recognises in `s`, or undefined if it emits none. */
  const lexerTag = (s: string): string | undefined => {
    const lexer = new ExpressionLexer();
    lexer.reset(s);
    return lexer.tokenizeAll().find((t) => t.type === "TAG")?.value;
  };
  const lexerTypes = (s: string): string[] => {
    const lexer = new ExpressionLexer();
    lexer.reset(s);
    return lexer.tokenizeAll().map((t) => t.type);
  };

  test("a # glued to a number or word is not a tag in the lexer", () => {
    expect(lexerTag("100#food")).toBeUndefined();
    expect(lexerTag("$100#food")).toBeUndefined();
    expect(lexerTag("a#food")).toBeUndefined();
    // it falls through to a comment, exactly as any other mid-line bare `#` does
    expect(lexerTypes("100#food")).toContain("COMMENT");
    expect(lexerTypes("100#food")).not.toContain("TAG");
  });

  test("a # at a boundary is still a tag", () => {
    expect(lexerTag("100 #food")).toBe("food");
    expect(lexerTag("40 + 15 #grocery")).toBe("grocery");
    // a non-word, non-space separator is a boundary too
    expect(lexerTag("note: #food")).toBe("food");
  });

  test("the lexer now agrees with the scanner on every boundary case", () => {
    // The invariant the fix restores: the lexer recognises a `#food` tag iff the
    // scanner counts one, for the same mid-line text.
    const cases = ["100#food", "$100#food", "a#food", "100 #food", "x #food", "note: #food", "5 + 3#food"];
    for (const s of cases) {
      const lexerHasIt = lexerTag(s) === "food";
      const scannerHasIt = lineCarriesTag(s, "food");
      expect(lexerHasIt).toBe(scannerHasIt);
    }
  });

  test("a glued tag is neither shown as tagged nor counted (consistent)", () => {
    // Before the fix this line was stripped as tagged but excluded from the
    // total; now it is consistently not a tag, so it is left whole and uncounted.
    expect(resultAt(["100#food", "count of #food"], 2)).toBe("= 0");
    expect(resultAt(["100#food", "total of #food"], 2)).toMatch(/no lines are tagged/i);
  });

  test("a properly separated tag still aggregates", () => {
    expect(resultAt(["100 #food", "50 #food", "total of #food"], 3)).toBe("= 150");
    expect(resultAt(["100 #food", "50 #food", "count of #food"], 3)).toBe("= 2");
  });
});
