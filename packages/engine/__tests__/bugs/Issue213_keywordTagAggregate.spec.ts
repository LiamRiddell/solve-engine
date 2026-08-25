import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #213: an aggregate of a tag whose name is a package keyword failed to
 * parse.
 *
 * `total of #tag` fuses to a `TAG_SUM` token whose value is the tag name. When
 * that name was also a lexer keyword (`assuming`, a finance keyword), the phrase
 * trie re-read the fused token's value on the next normalizer pass and turned it
 * back into the keyword token, so `total of #assuming` collapsed to a bare
 * `ASSUMING` and errored ("no prefix parselet for ASSUMING"). A non-keyword tag
 * (`total of #column`) and a plain data-line tag (`1200 #assuming`) were fine;
 * only the aggregate of a keyword-named tag broke.
 *
 * The fix extends the phrase trie's tag guard to the fused `TAG_SUM` /
 * `TAG_COUNT` / `TAG_AVERAGE` tokens, so a tag name is never re-interpreted as a
 * keyword after the aggregate has claimed it.
 */
describe("Issue #213: aggregate of a keyword-named tag", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  const resultAt = (lines: string[], lineNo: number): string => {
    const parsed = engine.parseDocument(lines.join("\n")).lines;
    const line = parsed[lineNo - 1];
    return line.result ? formatValue(line.result) : (line.error ?? "(no result)");
  };

  test("total of a keyword-named tag sums, not errors", () => {
    expect(resultAt(["1200 #assuming", "800 #assuming", "total of #assuming"], 3)).toBe("= 2,000");
  });

  test("sum / count / average of a keyword-named tag all work", () => {
    expect(resultAt(["5 #assuming", "7 #assuming", "sum of #assuming"], 3)).toBe("= 12");
    expect(resultAt(["1 #assuming", "2 #assuming", "count of #assuming"], 3)).toBe("= 2");
    expect(resultAt(["10 #assuming", "20 #assuming", "average of #assuming"], 3)).toBe("= 15");
  });

  test("the aggregate fuses to a TAG_SUM, never a bare keyword token", () => {
    // The precise fix: the fused aggregate token survives normalization instead
    // of the trie turning it back into the ASSUMING keyword.
    const debug = engine.evaluateLineWithDebug(1, "total of #assuming");
    const types = (debug.tokens ?? []).map((t) => t.type);
    expect(types).toContain("TAG_SUM");
    expect(types).not.toContain("ASSUMING");
  });

  test("a non-keyword tag and a data-line keyword tag are unaffected", () => {
    expect(resultAt(["40 #column", "55 #column", "total of #column"], 3)).toBe("= 95");
    expect(resultAt(["1200 #assuming"], 1)).toBe("= 1,200");
  });
});
