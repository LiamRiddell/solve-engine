import { describe, expect, test } from "@jest/globals";
import { lineCarriesTag, escapeTag } from "@solve-js/packages/tags/TagScanner";

/**
 * Pure `#tag` detection, the same isolation-testable design as TableReader.
 */
describe("lineCarriesTag", () => {
  test("matches a mid-line tag", () => {
    expect(lineCarriesTag("40 + 15 #grocery", "grocery")).toBe(true);
  });

  test("is case-insensitive both ways", () => {
    expect(lineCarriesTag("40 #Grocery", "grocery")).toBe(true);
    expect(lineCarriesTag("40 #grocery", "GROCERY")).toBe(true);
  });

  test("does not match a longer tag (prefix collision)", () => {
    expect(lineCarriesTag("40 #housingcost", "housing")).toBe(false);
    expect(lineCarriesTag("40 #housing-extra", "housing")).toBe(false);
  });

  test("does not match a tag that is the line's first token (a heading)", () => {
    expect(lineCarriesTag("#grocery list", "grocery")).toBe(false);
    expect(lineCarriesTag("   #grocery indented", "grocery")).toBe(false);
  });

  test("does not match a tag embedded in a word", () => {
    expect(lineCarriesTag("email a#grocery", "grocery")).toBe(false);
  });

  test("an empty tag never matches", () => {
    expect(lineCarriesTag("40 #grocery", "")).toBe(false);
  });

  test("escapeTag leaves an ordinary tag name intact", () => {
    expect(escapeTag("housing")).toBe("housing");
  });
});
