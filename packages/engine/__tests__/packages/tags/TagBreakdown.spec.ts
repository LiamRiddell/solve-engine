/**
 * `total by tag`: every category tag in the note, each with its total and its
 * share of the whole, on one line (issue #508).
 *
 * `total of #food` answers for one tag at a time, and a share had to be worked
 * out by hand. The breakdown answers the question a tagged list is kept for.
 * What is pinned here:
 *
 * - the shape: `label amount (share)`, joined by ` · `, in the order each tag
 *   first appears, with each amount the one `total of #tag` gives;
 * - the whole: every tagged line counted once, so a line carrying two tags
 *   counts toward both and overlapping shares can add up to more than 100%;
 * - the refusals: no tags, a tagged line that is not a number, tags in different
 *   measures, and a whole of zero are each a named error, not a string of zeros;
 * - that the answer is text: it holds several labelled figures, not one number.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";

/** A value as a reader sees it, with an error marked and its code kept. */
function shownValue(value: Value | null | undefined): string {
  if (!value) return "";
  const formatted = formatValue(value).replace(/^=\s*/, "");
  return value.type === ValueType.Error ? `ERROR ${String(value.value)}: ${formatted}` : formatted;
}

/** Every line's answer from a document result. */
function readLines(result: ParsingResult): string[] {
  return result.lines.map((line) => (line.error ? `ERROR: ${line.error}` : shownValue(line.result)));
}

/** The last line's answer through both document passes, which must agree. */
function answer(lines: string[]): string {
  const batch = readLines(newTrackedEngine().parseDocument(lines.join("\n"), { inputType: "markdown" }));
  const incremental = readLines(evaluateDocument(newTrackedEngine(), lines.join("\n")));
  expect(incremental).toEqual(batch);
  return batch[batch.length - 1];
}

describe("every tag with its total and its share", () => {
  test("the shape the issue asked for", () => {
    expect(answer(["$40 #food", "$25 #food", "$30 #transport", "total by tag"])).toBe(
      "food $65.00 (68%) · transport $30.00 (32%)",
    );
  });

  test("sum by tag is a synonym", () => {
    expect(answer(["$40 #food", "$25 #food", "$30 #transport", "sum by tag"])).toBe(
      "food $65.00 (68%) · transport $30.00 (32%)",
    );
  });

  test("each amount is the one the tag's own total gives", () => {
    const doc = ["$40 #food", "$25 #food", "$30 #transport"];
    expect(answer([...doc, "total of #food"])).toBe("$65.00");
    expect(answer([...doc, "total of #transport"])).toBe("$30.00");
  });

  test("tags appear in the order they are first written, as first written, grouped without regard to case", () => {
    expect(answer(["$30 #Transport", "$40 #food", "$25 #Food", "total by tag"])).toBe(
      "Transport $30.00 (32%) · food $65.00 (68%)",
    );
  });

  test("labels, blank lines and untagged lines are passed over", () => {
    expect(answer(["# Budget", "Rent: $1200 #home", "", "Power: $80 #home", "Note: $5", "Train: $60 #transport", "total by tag"])).toBe(
      "home $1,280.00 (96%) · transport $60.00 (4%)",
    );
  });

  test("a share too small to round to 1% says so rather than 0%", () => {
    expect(answer(["$1000 #rent", "$1 #snack", "total by tag"])).toBe("rent $1,000.00 (100%) · snack $1.00 (<1%)");
  });

  test("plain numbers break down too", () => {
    expect(answer(["1200 #assuming", "800 #other", "total by tag"])).toBe("assuming 1,200 (60%) · other 800 (40%)");
  });

  test("a tag being asked about is not a member, so another aggregate is not counted", () => {
    expect(answer(["$40 #food", "$20 #fun", "total of #food", "total by tag"])).toBe("food $40.00 (67%) · fun $20.00 (33%)");
  });
});

describe("a line with two tags counts toward both", () => {
  test("so overlapping shares can add up to more than 100%", () => {
    // The whole is 61.50, each tagged line once. #grocery is 52.50 of it and
    // #reviewed is 49, because line 1 is both.
    expect(answer(["40 #grocery #reviewed", "12.50 #grocery", "9 #reviewed", "total by tag"])).toBe(
      "grocery 52.50 (85%) · reviewed 49 (80%)",
    );
  });

  test("the same tag twice on one line is one membership", () => {
    expect(answer(["$40 #food #Food", "$10 #fun", "total by tag"])).toBe("food $40.00 (80%) · fun $10.00 (20%)");
  });
});

describe("every refusal is a named error", () => {
  test("a note with no tags", () => {
    expect(answer(["10", "20", "total by tag"])).toBe(
      "ERROR TAG_EMPTY: No lines carry a tag, so there is nothing to break down.",
    );
  });

  test("a tagged line that is not a number", () => {
    expect(answer(['"x" #food', "total by tag"])).toBe(
      "ERROR TAG_NON_NUMERIC: Line 1, tagged #food, is not a plain number or unit value.",
    );
  });

  test("tags in different measures have no whole to share", () => {
    expect(answer(["$40 #food", "5 km #run", "total by tag"])).toBe(
      "ERROR INCOMPATIBLE_UNITS: money and length cannot be added. A breakdown needs every tagged line in one measure, so the tags share one whole.",
    );
  });

  test("a whole of zero has no shares", () => {
    expect(answer(["$40 #food", "-$40 #refund", "total by tag"])).toBe(
      "ERROR TAG_BREAKDOWN_NO_WHOLE: The tagged lines add up to zero, so no tag has a share of them.",
    );
  });

  test("a breakdown above its tagged lines reads lines not yet worked out", () => {
    const doc = ["total by tag", "$40 #food"];
    const batch = readLines(newTrackedEngine().parseDocument(doc.join("\n")));
    const incremental = readLines(evaluateDocument(newTrackedEngine(), doc.join("\n")));
    expect(incremental).toEqual(batch);
    expect(batch[0]).toBe("ERROR LINE_NOT_YET_EVALUATED: Line 2 has not been evaluated yet");
  });
});

describe("the answer is text", () => {
  test("it is a String value, not a number to calculate with", () => {
    const result = newTrackedEngine().parseDocument(["$40 #food", "total by tag"].join("\n"));
    expect(result.lines[1].result?.type).toBe(ValueType.String);
  });

  test("the words stay ordinary outside the whole phrase", () => {
    const out = readLines(newTrackedEngine().parseDocument([":total = 5", "total + 1", "increase 100 by 10%"].join("\n")));
    expect(out).toEqual(["5", "6", "110.00"]);
  });
});

describe("a live editor follows an edit to the tags", () => {
  test("a tagged line inserted, and a tag renamed in place, both reach the breakdown", () => {
    const doc = new DocumentModel();
    doc.setDocument(["$40 #food", "$30 #transport", "total by tag"].join("\n"));
    const evaluator = new ThreeTierEvaluator(doc, createEngine() as unknown as ExpressionEngine);
    const settle = () => {
      for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
    };
    settle();
    expect(shownValue(doc.getLineAt(3)?.result)).toBe("food $40.00 (57%) · transport $30.00 (43%)");

    evaluator.applyTransaction([{ startLine: 2, deleteCount: 0, insertLines: ["$30 #food"] }]);
    settle();
    expect(shownValue(doc.getLineAt(4)?.result)).toBe("food $70.00 (70%) · transport $30.00 (30%)");

    doc.editLine(3, "$30 #fun");
    settle();
    expect(shownValue(doc.getLineAt(4)?.result)).toBe("food $70.00 (70%) · fun $30.00 (30%)");
    evaluator.terminateWorker();
  });
});
