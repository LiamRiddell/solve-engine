import { describe, expect, test } from "@jest/globals";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";

/** Tokenize and return the token types. */
function types(input: string): string[] {
  const lexer = new ExpressionLexer();
  lexer.reset(input);
  return lexer.tokenizeAll().map((t) => t.type);
}

/**
 * `+=` and `-=` are the compound-assignment operators (running totals, see the
 * variables package). They are the first two-character operators whose first
 * character is `+` or `-`, so this pins that the neighbouring shapes, `=+`,
 * `=-`, `++`, the negative-number `= -5`, and the ASCII uncertainty `+/-`, are
 * unchanged and never mis-lex into a compound-assignment token.
 */
describe("compound-assignment operators", () => {
  test("+= is one PLUS_EQUALS token", () => {
    expect(types("x += 5")).toEqual(["IDENT", "PLUS_EQUALS", "NUMBER"]);
  });

  test("-= is one MINUS_EQUALS token", () => {
    expect(types("x -= 5")).toEqual(["IDENT", "MINUS_EQUALS", "NUMBER"]);
  });

  describe("neighbouring shapes never become a compound assignment", () => {
    test.each([
      ["x = 5"],
      ["x =+ 5"],
      ["x =- 5"],
      ["x ++ y"],
      ["a = -5"],
      ["12.3 +/- 0.5"],
    ])("%s has neither PLUS_EQUALS nor MINUS_EQUALS", (input) => {
      const t = types(input);
      expect(t).not.toContain("PLUS_EQUALS");
      expect(t).not.toContain("MINUS_EQUALS");
    });

    test("a plain assignment stays a single EQUALS", () => {
      expect(types("x = 5")).toEqual(["IDENT", "EQUALS", "NUMBER"]);
    });
  });
});
