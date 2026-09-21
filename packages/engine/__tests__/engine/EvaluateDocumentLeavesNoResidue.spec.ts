import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";

/**
 * `evaluateDocument` borrows the caller's engine for one pass: it stands up its
 * own DocumentModel and ThreeTierEvaluator on an engine a host may already be
 * driving, and its own comment promises that "borrowing the engine for one pass
 * leaves nothing behind".
 *
 * Two things make that promise load-bearing rather than tidy. Constructing a
 * ThreeTierEvaluator wires BOTH the document model and its own VM checkpointer
 * onto the engine, unconditionally. And the checkpointer is what the async
 * batcher uses to restore VM state when a value arrives later, against
 * checkpoints keyed by line position. So a borrowed pass that keeps the engine
 * pointed at its own checkpointer does not merely leave a stale field: it
 * redirects the host's later async re-execution onto checkpoints recorded for a
 * document that no longer exists, at positions belonging to different lines.
 */

function hostEngineDrivingItsOwnDocument(): { engine: ExpressionEngine; doc: DocumentModel } {
  const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  const doc = new DocumentModel();
  doc.setDocument([":subtotal = 100", ":subtotal * 2"].join("\n"));
  // Constructing it is what wires the document and the checkpointer onto the
  // engine, which is the state a borrowed pass has to put back.
  const evaluator = new ThreeTierEvaluator(doc, engine);
  evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
  return { engine, doc };
}

describe("evaluateDocument leaves a borrowed engine as it found it", () => {
  test("the host's document model is restored", () => {
    const { engine, doc } = hostEngineDrivingItsOwnDocument();

    evaluateDocument(engine, [":other = 5", ":other + 1"].join("\n"));

    expect(engine.getDocumentModel()).toBe(doc);
  });

  test("the host's checkpointer is restored", () => {
    const { engine } = hostEngineDrivingItsOwnDocument();
    const hostCheckpointer = engine.getBatcher().checkpointer;
    expect(hostCheckpointer).not.toBeNull();

    evaluateDocument(engine, [":other = 5", ":other + 1"].join("\n"));

    // Before this was restored, the engine kept the throwaway pass's
    // checkpointer, so the host's next async resolution restored variable
    // state from the wrong document's checkpoints.
    expect(engine.getBatcher().checkpointer).toBe(hostCheckpointer);
  });

  test("repeated borrowing does not accumulate, so the host's state survives every pass", () => {
    const { engine, doc } = hostEngineDrivingItsOwnDocument();
    const hostCheckpointer = engine.getBatcher().checkpointer;

    for (let i = 0; i < 3; i++) {
      evaluateDocument(engine, [`:pass${i} = ${i}`, `:pass${i} + 1`].join("\n"));
    }

    expect(engine.getDocumentModel()).toBe(doc);
    expect(engine.getBatcher().checkpointer).toBe(hostCheckpointer);
  });
});
