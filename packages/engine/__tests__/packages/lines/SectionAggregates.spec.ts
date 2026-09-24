/**
 * `total of section "Travel"` and its siblings: the figures under a named
 * heading, read from anywhere in the note (issue #508).
 *
 * `total above` stops at the first blank line or heading, so it only works
 * directly under its block, and `sum(line 2 : line 4)` names line numbers that
 * go stale as the note grows. A section total names the block by its heading
 * instead. What is pinned here:
 *
 * - the block: everything under the heading down to the next heading at the
 *   same level or above, subsections included;
 * - what is left out: blank lines, headings and comments, the query line itself,
 *   and any line that is itself a summary, which would otherwise be counted
 *   twice;
 * - the refusals: a name no heading carries, a name two headings carry, an
 *   empty section, a line that is not a number, a mix of measures, each a named
 *   error rather than a number;
 * - that a live editor's answer follows an edit to the block, its heading or its
 *   extent, and agrees with a fresh pass over the edited text.
 *
 * The same forms through all three entry points are in
 * `integration/CrossPathDocumentFeatures.spec.ts`.
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

/**
 * The last line's answer, which is where every document here asks its
 * question, through both document passes; they must agree.
 *
 * Only the last line is compared. A line that does not parse is reported by
 * each pass in its own way (a thrown message in one, an error Value in the
 * other), which is theirs to settle, not the section total's; what the section
 * total says about such a line is the same through both.
 */
function answer(lines: string[]): string {
  const batch = readLines(newTrackedEngine().parseDocument(lines.join("\n"), { inputType: "markdown" }));
  const incremental = readLines(evaluateDocument(newTrackedEngine(), lines.join("\n")));
  expect(incremental[incremental.length - 1]).toBe(batch[batch.length - 1]);
  return batch[batch.length - 1];
}

const TRAVEL = [
  "# Travel",
  "Flights: $450",
  "Hotel: $220",
  "Taxi: $50",
  "",
  "# Food",
  "Groceries: $40",
  "Dinner: $25",
  "",
  "# Summary",
];

describe("a section is the block under its heading", () => {
  test("total, sum, average and count read the same block", () => {
    expect(answer([...TRAVEL, 'total of section "Travel"'])).toBe("$720.00");
    expect(answer([...TRAVEL, 'sum of section "Travel"'])).toBe("$720.00");
    expect(answer([...TRAVEL, 'average of section "Travel"'])).toBe("$240.00");
    expect(answer([...TRAVEL, 'count of section "Travel"'])).toBe("3");
    expect(answer([...TRAVEL, 'total of section "Food"'])).toBe("$65.00");
  });

  test("the name is matched without regard to case or spacing", () => {
    expect(answer([...TRAVEL, 'total of section "travel"'])).toBe("$720.00");
    expect(answer([...TRAVEL, 'total of section "  TRAVEL "'])).toBe("$720.00");
  });

  test("a heading's section includes its subsections, and each subsection stands alone", () => {
    const doc = [
      "# Travel",
      "## Flights",
      "Outbound: $300",
      "Return: $150",
      "## Hotels",
      "Rome: $220",
      "# Summary",
    ];
    expect(answer([...doc, 'total of section "Travel"'])).toBe("$670.00");
    expect(answer([...doc, 'total of section "Flights"'])).toBe("$450.00");
    expect(answer([...doc, 'total of section "Hotels"'])).toBe("$220.00");
  });

  test("the last section runs to the end of the note", () => {
    expect(answer(["# Summary", "# Travel", "$1", "", "$2", 'total of section "Travel"'])).toBe("$3.00");
  });

  test("the result is a value like any other", () => {
    const doc = ["# Travel", "Flights: $450", "Hotel: $220", "# Summary"];
    expect(answer([...doc, 'total of section "Travel" * 1.2'])).toBe("$804.00");
    expect(answer([...doc, ':budget = total of section "Travel"', "budget - $100"])).toBe("$570.00");
  });

  test("units carry through in the first unit written", () => {
    expect(answer(["# Walks", "1.2 km", "3 km", "800 m", "# Week", 'total of section "Walks"'])).toBe("5.00 km");
  });
});

describe("what a section leaves out", () => {
  test("blank lines, comments and subheadings are passed over", () => {
    expect(answer(["# Travel", "$450", "", "// booked in May", "## Extras", "$20", "# Summary", 'total of section "Travel"'])).toBe(
      "$470.00",
    );
  });

  test("a subtotal inside the section is not counted twice", () => {
    const doc = ["# Travel", "Flights: $450", "Hotel: $220", "Subtotal: total above", "", "# Summary"];
    expect(answer([...doc, 'total of section "Travel"'])).toBe("$670.00");
    expect(answer([...doc, 'count of section "Travel"'])).toBe("2");
  });

  test("an explicit span or a tag total inside the section is a summary too", () => {
    expect(answer(["# Travel", "$450", "$220", "sum(line 2 : line 3)", "# Summary", 'total of section "Travel"'])).toBe("$670.00");
    expect(answer(["# Travel", "$450 #fare", "total of #fare", "# Summary", 'total of section "Travel"'])).toBe("$450.00");
  });

  test("a line that reads one other line is a figure and is counted", () => {
    expect(answer(["# Travel", "Flights: $450", "Hotel: $220", "Second night: prev", "# Summary", 'total of section "Travel"'])).toBe(
      "$890.00",
    );
  });

  test("the query can sit inside its own section, at the foot, and leaves itself out", () => {
    expect(answer(["# Travel", "Flights: $450", "Hotel: $220", 'total of section "Travel"'])).toBe("$670.00");
  });

  test("one summary per section in a summary section, none counting another", () => {
    const doc = [
      "# Q1", "$100", "$200", "total above", "",
      "# Q2", "$150", "$250", "total above", "",
      "# Year",
      'Q1: total of section "Q1"',
      'Q2: total of section "Q2"',
      'total of section "Year"',
    ];
    // The Year section holds only summaries, so it has no figures of its own.
    expect(answer(doc)).toContain("SECTION_EMPTY");
    expect(answer(doc.slice(0, -1))).toBe("$400.00");
  });
});

describe("every refusal is a named error, never a number", () => {
  test("a name no heading carries lists the headings there are", () => {
    expect(answer([...TRAVEL, 'total of section "Travle"'])).toBe(
      'ERROR SECTION_NOT_FOUND: No heading is named "Travle". The headings in this note are "Travel", "Food" and "Summary".',
    );
  });

  test("a note with one other heading names it", () => {
    expect(answer(["# Travel", "$10", 'total of section "Food"'])).toBe(
      'ERROR SECTION_NOT_FOUND: No heading is named "Food". The only heading in this note is "Travel".',
    );
  });

  test("a note with no headings says so", () => {
    expect(answer(["$10", 'total of section "Travel"'])).toBe(
      'ERROR SECTION_NOT_FOUND: No heading is named "Travel": this note has no headings.',
    );
  });

  test("a long list of headings is cut short", () => {
    const doc = ["# A", "# B", "# C", "# D", "# E", "# F", "# G", "# H", 'total of section "Z"'];
    expect(answer(doc)).toBe(
      'ERROR SECTION_NOT_FOUND: No heading is named "Z". The headings in this note are "A", "B", "C", "D", "E", "F" and 2 more.',
    );
  });

  test("an empty name finds nothing, even under an empty heading", () => {
    expect(answer(["#", "$10", 'total of section ""'])).toContain("SECTION_NOT_FOUND");
  });

  test("a name two headings carry is ambiguous", () => {
    const doc = ["# March", "## Travel", "Train: $40", "# April", "## Travel", "Train: $55", "# Summary", 'total of section "Travel"'];
    expect(answer(doc)).toBe(
      'ERROR SECTION_AMBIGUOUS: 2 headings are named "Travel" (lines 2 and 5), so the section is unclear. Give each its own name.',
    );
  });

  test("an empty section refuses a total and an average, and counts zero", () => {
    expect(answer(["# Travel", "# Summary", 'total of section "Travel"'])).toBe(
      'ERROR SECTION_EMPTY: The section "Travel" has no figures to add up.',
    );
    expect(answer(["# Travel", "# Summary", 'average of section "Travel"'])).toBe(
      'ERROR SECTION_EMPTY: The section "Travel" has no figures to average.',
    );
    expect(answer(["# Travel", "# Summary", 'count of section "Travel"'])).toBe("0");
  });

  test("a line of text is refused by the inline aggregates' code, naming the line", () => {
    expect(answer(["# Travel", "Flights: $450", '"booked in May"', "# Summary", 'total of section "Travel"'])).toBe(
      'ERROR AGGREGATE_NON_NUMERIC: Line 3, under "Travel", is text, so it cannot be added: only numbers and quantities can.',
    );
  });

  test("a percentage is refused rather than added to money", () => {
    expect(answer(["# Travel", "$450", "20%", "# Summary", 'total of section "Travel"'])).toBe(
      'ERROR AGGREGATE_NON_NUMERIC: Line 3, under "Travel", is not a plain number or quantity, so it cannot be added.',
    );
  });

  test("count counts a line that is not a number", () => {
    expect(answer(["# Travel", "Flights: $450", '"booked in May"', "# Summary", 'count of section "Travel"'])).toBe("2");
  });

  test("a sentence of prose is an error on its own line, and the total says which", () => {
    expect(answer(["# Travel", "Flights are booked for May", "$450", "# Summary", 'total of section "Travel"'])).toBe(
      "ERROR LINE_RESULT_ERROR: Line 2 has an error",
    );
  });

  test("a mix of measures is refused by name", () => {
    expect(answer(["# Travel", "Flights: $450", "Luggage: 23 kg", "# Summary", 'total of section "Travel"'])).toBe(
      "ERROR INCOMPATIBLE_UNITS: money and mass cannot be added",
    );
  });

  test("a total above its section reads lines not yet worked out, and says so", () => {
    const doc = ['total of section "Travel"', "# Travel", "Flights: $450"];
    const batch = readLines(newTrackedEngine().parseDocument(doc.join("\n")));
    const incremental = readLines(evaluateDocument(newTrackedEngine(), doc.join("\n")));
    expect(incremental).toEqual(batch);
    expect(batch[0]).toBe("ERROR LINE_NOT_YET_EVALUATED: Line 3 has not been evaluated yet (forward reference, or out of range)");
  });
});

describe("the words stay ordinary outside the whole phrase", () => {
  test("a variable named section still reads", () => {
    const doc = [":section = 5", "total of section", "total of section + 1"];
    const out = readLines(newTrackedEngine().parseDocument(doc.join("\n")));
    expect(out.slice(1)).toEqual(["5", "6"]);
  });

  test("a quoted name with no section before it is still refused as text", () => {
    const out = readLines(newTrackedEngine().parseDocument('total of "Travel"'));
    expect(out[0]).toContain("AGGREGATE_NON_NUMERIC");
    expect(out[0]).toContain('total of section "Travel"');
  });
});

// ── A live editor ───────────────────────────────────────────────────────────

/** One line's answer in a live document. */
function shown(doc: DocumentModel, lineNumber: number): string {
  return shownValue(doc.getLineAt(lineNumber)?.result);
}

/** Every line's answer in a live document. */
const answersOf = (doc: DocumentModel): string[] => Array.from({ length: doc.lineCount }, (_, i) => shown(doc, i + 1));

/** A document held open by an evaluator, the way an editor holds one. */
function editorFor(lines: string[]) {
  const doc = new DocumentModel();
  doc.setDocument(lines.join("\n"));
  const engine = createEngine() as unknown as ExpressionEngine;
  const evaluator = new ThreeTierEvaluator(doc, engine);
  const settle = () => {
    for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
  };
  settle();
  return { doc, engine, evaluator, settle };
}

/** What a fresh pass over this text gives, with no editing history. */
function fresh(lines: string[]): string[] {
  const { doc, evaluator } = editorFor(lines);
  const answers = answersOf(doc);
  evaluator.terminateWorker();
  return answers;
}

/** The current text of a live document. */
const textOf = (doc: DocumentModel): string[] => Array.from({ length: doc.lineCount }, (_, i) => doc.getLineAt(i + 1)!.text);

describe("a live editor follows an edit to the section", () => {
  const start = ["# Travel", "Flights: $450", "Hotel: $220", "", "# Summary", 'total of section "Travel"'];

  test("a figure inserted into the block is counted", () => {
    const { doc, evaluator, settle } = editorFor(start);
    expect(shown(doc, 6)).toBe("$670.00");
    evaluator.applyTransaction([{ startLine: 4, deleteCount: 0, insertLines: ["Taxi: $50"] }]);
    settle();
    expect(shown(doc, 7)).toBe("$720.00");
    expect(answersOf(doc)).toEqual(fresh(textOf(doc)));
    evaluator.terminateWorker();
  });

  test("a figure edited in place is read again", () => {
    const { doc, evaluator, settle } = editorFor(start);
    doc.editLine(3, "Hotel: $300");
    settle();
    expect(shown(doc, 6)).toBe("$750.00");
    expect(answersOf(doc)).toEqual(fresh(textOf(doc)));
    evaluator.terminateWorker();
  });

  test("a figure deleted from the block is dropped", () => {
    const { doc, evaluator, settle } = editorFor(start);
    evaluator.applyTransaction([{ startLine: 2, deleteCount: 1, insertLines: [] }]);
    settle();
    expect(shown(doc, 5)).toBe("$220.00");
    expect(answersOf(doc)).toEqual(fresh(textOf(doc)));
    evaluator.terminateWorker();
  });

  test("renaming the heading away and back refuses, then answers", () => {
    const { doc, evaluator, settle } = editorFor(start);
    doc.editLine(1, "# Trips");
    settle();
    expect(shown(doc, 6)).toContain("SECTION_NOT_FOUND");
    expect(answersOf(doc)).toEqual(fresh(textOf(doc)));
    doc.editLine(1, "# Travel");
    settle();
    expect(shown(doc, 6)).toBe("$670.00");
    evaluator.terminateWorker();
  });

  test("a heading inserted into the block cuts it short", () => {
    const { doc, evaluator, settle } = editorFor(start);
    evaluator.applyTransaction([{ startLine: 3, deleteCount: 0, insertLines: ["# Hotels"] }]);
    settle();
    expect(shown(doc, 7)).toBe("$450.00");
    expect(answersOf(doc)).toEqual(fresh(textOf(doc)));
    evaluator.terminateWorker();
  });

  test("the total reads the block's positions, so an arriving value reaches it", () => {
    const { engine, evaluator } = editorFor(start);
    const dag = engine.getDag();
    expect([...dag.getAffectedLinesByPosition(2)]).toContain(6);
    expect([...dag.getAffectedLinesByPosition(3)]).toContain(6);
    evaluator.terminateWorker();
  });

  test("a figure outside the block is not read", () => {
    const { engine, evaluator } = editorFor(["$1", "# Travel", "$2", "# Summary", 'total of section "Travel"']);
    expect([...engine.getDag().getAffectedLinesByPosition(1)]).not.toContain(5);
    expect([...engine.getDag().getAffectedLinesByPosition(3)]).toContain(5);
    evaluator.terminateWorker();
  });

  test("a summary a section leaves out is not read, so it cannot close a cycle", () => {
    // Line 3 totals the Summary section, which holds line 6; line 6 totals the
    // Travel section, which holds line 3. Were the summaries read, the two
    // would read each other and both report a cycle. Each leaves the other out,
    // so both answer once the editor has settled.
    const doc = ["# Travel", "Flights: $450", 'Summary check: total of section "Summary"', "", "# Summary", 'total of section "Travel"', "$5"];
    const out = fresh(doc);
    expect(out[5]).toBe("$450.00");
    expect(out[2]).toBe("$5.00");
  });
});
