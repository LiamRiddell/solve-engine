/**
 * The pure half of the section aggregates: which lines are headings, how a
 * name is compared, and which lines are summaries a section total leaves out.
 *
 * Kept apart from the engine so each rule is pinned on its own. The engine
 * tests in `SectionAggregates.spec.ts` prove the same rules end to end.
 */
import { describe, expect, test } from "@jest/globals";
import { headingOf, isSummaryLine, sectionKey } from "@solve-js/packages/lines/SectionReader";

describe("headingOf reads a heading the way the line classifier does", () => {
  test("the level is the number of leading #", () => {
    expect(headingOf("# Travel")).toEqual({ level: 1, name: "Travel" });
    expect(headingOf("## Flights")).toEqual({ level: 2, name: "Flights" });
    expect(headingOf("### Day one")).toEqual({ level: 3, name: "Day one" });
  });

  test("leading whitespace and a missing space after the # are both still a heading", () => {
    expect(headingOf("   # Travel")).toEqual({ level: 1, name: "Travel" });
    expect(headingOf("#Travel")).toEqual({ level: 1, name: "Travel" });
  });

  test("a closing run of # is decoration, a # glued to a word is part of the name", () => {
    expect(headingOf("## Travel ##")).toEqual({ level: 2, name: "Travel" });
    expect(headingOf("# C#")).toEqual({ level: 1, name: "C#" });
  });

  test("a heading with no words has an empty name", () => {
    expect(headingOf("#")).toEqual({ level: 1, name: "" });
    expect(headingOf("## ##")).toEqual({ level: 2, name: "" });
  });

  test("a colour literal is an expression, not a heading", () => {
    expect(headingOf("#fff")).toBeNull();
    expect(headingOf("#c0ffee")).toBeNull();
    expect(headingOf("#deadbeef")).toBeNull();
    // Hex digits then more word characters are not a colour, so it is a heading.
    expect(headingOf("#ffx")).toEqual({ level: 1, name: "ffx" });
  });

  test("any other line is not a heading", () => {
    expect(headingOf("$450")).toBeNull();
    expect(headingOf("40 #food")).toBeNull();
    expect(headingOf("")).toBeNull();
  });
});

describe("sectionKey compares names without regard to case or spacing", () => {
  test("case and runs of whitespace fold", () => {
    expect(sectionKey("Travel")).toBe(sectionKey("travel"));
    expect(sectionKey("  Day   one ")).toBe(sectionKey("day one"));
  });

  test("a different name stays different", () => {
    expect(sectionKey("Travel costs")).not.toBe(sectionKey("Travel"));
  });
});

describe("isSummaryLine finds the lines that total other lines", () => {
  test("the above aggregates, alone, labelled or assigned", () => {
    expect(isSummaryLine("total above")).toBe(true);
    expect(isSummaryLine("average above")).toBe(true);
    expect(isSummaryLine("Subtotal: total above")).toBe(true);
    expect(isSummaryLine(":travel = sum above")).toBe(true);
    expect(isSummaryLine("total above * 1.2")).toBe(true);
  });

  test("section, tag and breakdown aggregates", () => {
    expect(isSummaryLine('total of section "Travel"')).toBe(true);
    expect(isSummaryLine('count of section "Travel"')).toBe(true);
    expect(isSummaryLine("total of #food")).toBe(true);
    expect(isSummaryLine("total by tag")).toBe(true);
    expect(isSummaryLine("sum by tag")).toBe(true);
  });

  test("an explicit span, whatever the spacing around its colon", () => {
    expect(isSummaryLine("sum(line 2 : line 3)")).toBe(true);
    expect(isSummaryLine("average(line 2: line 3)")).toBe(true);
  });

  test("a label that happens to say total above is still a figure", () => {
    expect(isSummaryLine("Total above budget: $50")).toBe(false);
  });

  test("a comment that says total above does not make the line a summary", () => {
    expect(isSummaryLine("$50 // not the total above")).toBe(false);
  });

  test("a colon inside a quoted name is not a label", () => {
    expect(isSummaryLine('total of section "Travel: Italy"')).toBe(true);
  });

  test("a reference to one other line is a figure of its own", () => {
    expect(isSummaryLine("prev")).toBe(false);
    expect(isSummaryLine("line 3 * 2")).toBe(false);
    expect(isSummaryLine("Flights: $450")).toBe(false);
    expect(isSummaryLine("totally above average")).toBe(false);
  });
});
