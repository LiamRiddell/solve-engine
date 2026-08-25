import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #179 follow-up: a running total (`+= / -=`) must be idempotent under
 * re-evaluation. A host re-parses the whole document on every keystroke (batch
 * path) and re-runs edited lines and their dependents (incremental path). The
 * accumulator seeds 0 only while its name is undefined, so before this fix it
 * read its own previous evaluation's value and grew without bound: a ledger
 * opening `spent += 10` produced 10, then 40, then 70 on successive passes.
 *
 * The fix resets accumulator names at the start of each batch pass, and
 * surfaces the compound line's reads/writes so the incremental evaluator
 * checkpoints the total (resetting it before a re-run) and re-evaluates the
 * lines that depend on it.
 */
describe("Issue #179: accumulator re-evaluation is idempotent", () => {
  describe("batch document path (parseDocument)", () => {
    let engine: ExpressionEngine;
    beforeEach(() => {
      engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
    });

    const read = (doc: string): string[] =>
      engine.parseDocument(doc).lines.map((l) => (l.result ? formatValue(l.result) : (l.error ?? "?")));

    test("a seed-zero ledger produces the same result on every re-parse", () => {
      const doc = ["spent += 10", "spent += 20", "spent"].join("\n");
      const first = read(doc);
      expect(first).toEqual(["= 10", "= 30", "= 30"]);
      // The exact same document, re-parsed twice more, must not drift.
      expect(read(doc)).toEqual(first);
      expect(read(doc)).toEqual(first);
    });

    test("a subtraction ledger is stable across re-parse", () => {
      const doc = ["budget -= 120", "budget -= 30", "budget"].join("\n");
      const first = read(doc);
      expect(first).toEqual(["= -120", "= -150", "= -150"]);
      expect(read(doc)).toEqual(first);
    });

    test("a ledger opened by a plain assignment stays stable too", () => {
      const doc = [":budget = 500", "budget -= 120", "budget -= 30", "budget"].join("\n");
      const first = read(doc);
      expect(first).toEqual(["= 500", "= 380", "= 350", "= 350"]);
      expect(read(doc)).toEqual(first);
    });

    test("editing the document to new amounts recomputes from the seed, not the stale total", () => {
      expect(read(["spent += 10", "spent"].join("\n"))).toEqual(["= 10", "= 10"]);
      // A different document (a corrected amount) must reflect only the new text.
      expect(read(["spent += 25", "spent"].join("\n"))).toEqual(["= 25", "= 25"]);
    });
  });

  describe("incremental path (ThreeTierEvaluator)", () => {
    const build = (lines: string[]): { doc: DocumentModel; evaluator: ThreeTierEvaluator } => {
      const engine = newTrackedEngine();
      const doc = new DocumentModel();
      doc.setDocument(lines.join("\n"));
      const evaluator = new ThreeTierEvaluator(doc, engine);
      evaluator.evaluate({ startLine: 1, endLine: lines.length });
      return { doc, evaluator };
    };
    const at = (doc: DocumentModel, n: number): number | undefined => doc.getLineAt(n)?.result?.toNumber();

    test("editing an accumulator line re-seeds instead of stacking, and dependents update", () => {
      const { doc, evaluator } = build(["spent += 10", "spent += 20", "spent"]);
      expect(at(doc, 1)).toBe(10);
      expect(at(doc, 3)).toBe(30);

      // Correct the opening amount; the ledger must recompute from 0.
      doc.editLine(1, "spent += 15");
      evaluator.evaluate({ startLine: 1, endLine: 3 });
      expect(at(doc, 1)).toBe(15);
      expect(at(doc, 2)).toBe(35); // dependent line re-evaluated
      expect(at(doc, 3)).toBe(35);
    });
  });
});
