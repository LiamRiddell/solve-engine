import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { TokenNormalizer, BUILTIN_PHRASES } from "@solve-js/normalizer";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #197: a tag named after a grammar phrase-word is swallowed before the
 * tag rules see it.
 *
 * The phrase trie (`normalizer/PhraseTrie.ts`) fuses multi-word phrases by their
 * written value, and it runs ahead of every priority rule. A `#tag` whose name
 * happened to equal a phrase or a phrase-continuation word (`1200 #assuming`,
 * `total of #column`) was therefore consumed as if it were the bare word, so the
 * tag was lost and the line reported a confusing error sourced from an unrelated
 * feature.
 *
 * The fix makes the trie skip a `TAG` token: it is a typed token, never a bare
 * word, so it can neither start nor complete a phrase.
 */
describe("Issue #197: a tag named after a phrase-word is not swallowed", () => {
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

  test("a tag that completes a package grammar phrase still aggregates", () => {
    // "column" completed an unrelated grammar phrase; before the fix
    // `total of #column` errored ("expected a column name") instead of summing.
    expect(resultAt(["40 #column", "55 #column", "total of #column"], 3)).toBe("= 95");
  });

  test("a tag whose name is a package keyword does not error on a data line", () => {
    // `#assuming` (a finance lexer keyword) fused into the ASSUMING token before
    // the fix, leaving an "unexpected token" error on an ordinary tagged line.
    // Aggregating a keyword-named tag (`total of #assuming`) was a separate bug
    // via a different mechanism, fixed alongside this one (see Issue213 spec).
    expect(resultAt(["1200 #assuming"], 1)).toBe("= 1,200");
    expect(resultAt(["500 #assuming"], 1)).toBe("= 500");
  });

  test("the tag is still stripped from its own line's calculation", () => {
    // The line carrying the tag still computes without it, exactly as an
    // ordinary tag does; the fix only stops the phrase trie stealing it.
    expect(resultAt(["40 + 15 #column"], 1)).toBe("= 55");
  });

  test("every built-in phrase word survives as a TAG rather than fusing", () => {
    // The general property the fix guarantees: because the trie skips TAG
    // tokens, no phrase word, wherever it sits in a phrase, can consume a tag of
    // the same name. Drive the real phrase trie over every built-in phrase.
    const normalizer = new TokenNormalizer();
    for (const [phrase, tokenType] of Object.entries(BUILTIN_PHRASES)) {
      normalizer.addPhrase(phrase, tokenType);
    }

    const words = new Set<string>();
    for (const phrase of Object.keys(BUILTIN_PHRASES)) {
      for (const word of phrase.split(/\s+/)) {
        // A tag name must start with a letter (the lexer rule), so only those
        // words can collide with a tag in the first place.
        if (/^[a-z]/i.test(word)) words.add(word.toLowerCase());
      }
    }
    expect(words.size).toBeGreaterThan(0);

    for (const word of words) {
      const lexer = new ExpressionLexer();
      lexer.reset(`10 #${word}`);
      const normalized = normalizer.normalize(lexer.tokenizeAll());
      const tag = normalized.find((t) => t.type === "TAG");
      // The tag keeps its own identity and its own name, un-fused.
      expect(tag?.value).toBe(word);
    }
  });
});
