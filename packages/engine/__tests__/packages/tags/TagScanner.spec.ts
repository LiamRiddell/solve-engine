import { describe, expect, test } from "@jest/globals";
import { lineCarriesTag, escapeTag, tagEdgesOf } from "@solve-js/packages/tags/TagScanner";

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

/**
 * `tagEdgesOf` runs on every line the engine registers, so it takes a fast
 * exit when the line holds no `#` at all. These pin that the exit returns
 * exactly what the full scan would, and that a line which does carry a tag is
 * unaffected by it.
 */
describe("tagEdgesOf", () => {
  test("a line with no hash has no tag edges", () => {
    expect(tagEdgesOf("40 + 15 * 2")).toEqual({ members: [], queries: [] });
    expect(tagEdgesOf("")).toEqual({ members: [], queries: [] });
    expect(tagEdgesOf(":rent = 1200")).toEqual({ members: [], queries: [] });
  });

  test("a member tag is still read", () => {
    expect(tagEdgesOf("40 + 15 #grocery")).toEqual({ members: ["grocery"], queries: [] });
  });

  test("an aggregate opener is read as a query, not a member", () => {
    expect(tagEdgesOf("total of #grocery")).toEqual({ members: [], queries: ["grocery"] });
  });

  test("a leading tag (the line's own tag) is neither", () => {
    expect(tagEdgesOf("#grocery")).toEqual({ members: [], queries: [] });
  });
});
