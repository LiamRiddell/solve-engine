import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

/**
 * Issue #180: category tag sums. A mid-line `#tag` annotates a data line and is
 * ignored when the line is calculated; `total of #tag` / `sum of #tag` /
 * `average of #tag` / `count of #tag` collect every line in the document
 * carrying that tag, across non-adjacent lines.
 *
 * Note: only one aggregate line per tag per document, since an aggregate line
 * also carries the tag, so two would try to include each other (a documented
 * boundary). Each case below uses its own small document.
 */
describe("Issue #180: category tag sums", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  /** Evaluate a document and read the display of a 1-based line. */
  const resultAt = (lines: string[], lineNo: number): string => {
    const parsed = engine.parseDocument(lines.join("\n")).lines;
    const line = parsed[lineNo - 1];
    return line.result ? formatValue(line.result) : (line.error ?? "(no result)");
  };

  describe("a mid-line #tag is stripped from the line's own calculation", () => {
    test("a tagged data line evaluates to its number", () => {
      expect(resultAt(["40 + 15 #grocery"], 1)).toBe("= 55");
    });
    test("a tag and a trailing // comment coexist", () => {
      expect(resultAt(["12 #housing // rent"], 1)).toBe("= 12");
    });
  });

  describe("the aggregates collect tagged lines across the note", () => {
    test("total sums non-adjacent tagged lines, through prose and blanks", () => {
      expect(resultAt(["40 + 15 #grocery", "some prose here", "30 #transport", "", "12.50 #grocery", "total of #grocery"], 6)).toBe("= 67.50");
    });
    test("sum is a synonym for total", () => {
      expect(resultAt(["40 + 15 #grocery", "12.50 #grocery", "sum of #grocery"], 3)).toBe("= 67.50");
    });
    test("count counts the tagged lines", () => {
      expect(resultAt(["40 #grocery", "12.50 #grocery", "count of #grocery"], 3)).toBe("= 2");
    });
    test("average averages the tagged set", () => {
      expect(resultAt(["30 #transport", "50 #transport", "average of #transport"], 3)).toBe("= 40");
    });
  });

  describe("money and units carry through", () => {
    test("a sum of tagged money displays as money", () => {
      expect(resultAt(["$40 #food", "$25 #food", "total of #food"], 3)).toBe("= $65.00");
    });
  });

  describe("boundaries", () => {
    test("a heading is not counted as a tagged line", () => {
      expect(resultAt(["# grocery list", "20 #grocery", "total of #grocery"], 3)).toBe("= 20");
    });
    test("a prefix does not collide: #housing is not #housingcost", () => {
      expect(resultAt(["100 #housing", "200 #housingcost", "total of #housing"], 3)).toBe("= 100");
    });
    test("no tagged lines is a clear error for sum, and zero for count", () => {
      expect(resultAt(["total of #none"], 1)).toMatch(/no lines are tagged/i);
      expect(resultAt(["count of #none"], 1)).toBe("= 0");
    });
    test("a tag aggregate outside a document errors cleanly", () => {
      const [value] = engine.evaluateExpression("total of #grocery");
      expect(value.type).toBe(ValueType.Error);
      expect(formatValue(value)).toMatch(/document/i);
    });
  });

  describe("the #tag lexer change is bounded", () => {
    const types = (s: string): string[] => {
      const lexer = new ExpressionLexer();
      lexer.reset(s);
      return lexer.tokenizeAll().map((t) => t.type);
    };
    const tagValue = (s: string): string | undefined => {
      const lexer = new ExpressionLexer();
      lexer.reset(s);
      return lexer.tokenizeAll().find((t) => t.type === "TAG")?.value;
    };

    test("a mid-line #tag lexes to a TAG token whose value drops the #", () => {
      expect(types("5 + 3 #housing")).toEqual(["NUMBER", "PLUS", "NUMBER", "TAG"]);
      expect(tagValue("5 #housing")).toBe("housing");
    });
    test("# with a space stays a comment", () => {
      expect(types("5 # a note")).toContain("COMMENT");
      expect(types("5 # a note")).not.toContain("TAG");
    });
    test("#ff0000 stays a colour, and a digit-led #12ab is a colour not a tag", () => {
      expect(types("#ff0000")).toContain("HEX_COLOUR");
      // A tag name must start with a letter, so `#12ab` is not a TAG. `#12a` is
      // a valid 3-digit hex colour; the colour lexer claims it first.
      expect(types("5 #12a")).not.toContain("TAG");
    });
    test("// stays a comment", () => {
      expect(types("10 / 2 // half")).toContain("COMMENT");
    });
  });

  describe("what must keep working", () => {
    test("total above is unaffected", () => {
      expect(resultAt(["10", "20", "total above"], 3)).toBe("= 30");
    });
    test("the variadic total of 1, 2, 3 is unaffected", () => {
      expect(resultAt(["total of 1, 2, 3"], 1)).toBe("= 6");
    });
    test(":total = 5 is untouched", () => {
      engine.evaluateExpression(":total = 5");
      expect(engine.evaluateExpression("total + 1")[0].toNumber()).toBe(6);
    });
  });

  describe("count is about presence, and a non-aggregate `of` is prose", () => {
    test("count of #tag counts a tagged line whose value is not a number", () => {
      // A count is "how many lines carry the tag", so a non-numeric tagged
      // line (here a date) still counts; only sum and average need a number.
      expect(resultAt(["25/12/2025 #trip", "40 #trip", "count of #trip"], 3)).toBe("= 2");
    });
    test("total of a non-numeric tagged line is still a clear error", () => {
      expect(resultAt(["25/12/2025 #trip", "40 #trip", "total of #trip"], 3)).toMatch(/not a plain number/i);
    });
    test("`cost of #living` is ordinary prose, not a stray-tag internals error", () => {
      // The tag is stripped as a data-line annotation; `word of #tag` only
      // holds the tag when the word opens an aggregate (total/sum/count/average).
      const out = resultAt(["cost of #living"], 1);
      expect(out).not.toMatch(/prefix parselet/i);
      expect(out).not.toMatch(/\bTAG\b/);
    });
  });
});
