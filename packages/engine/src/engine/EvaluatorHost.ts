import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * The names of the engine members the incremental evaluator reaches: the
 * seams {@link ThreeTierEvaluator}, `evaluateDocument` and the checkpointer
 * they wire need, and nothing a host calls.
 *
 * Listed once here so what the evaluator needs is one named contract (#761).
 * Every member it names is marked `@internal` on {@link ExpressionEngine},
 * except `evaluateLine`, which is host API as well, and `getBatcher`, which
 * the live-editor guide uses for `onLineResult`. Removing the seams from the
 * published types (turning on `stripInternal`) is held for 3.0, and this list
 * is what that change keeps reachable to the evaluator.
 *
 * @internal
 */
export const EVALUATOR_SEAMS = [
	"addPassSpend",
	"applyDocumentRandomSeed",
	"beginPass",
	"compileExpression",
	"endPass",
	"evaluateLine",
	"executeCached",
	"forgetOrphanedNames",
	"getBatcher",
	"getDag",
	"getDocumentModel",
	"getLineCache",
	"getVM",
	"invalidateForRemovedUserUnits",
	"isAccumulatorName",
	"passSpent",
	"resetAccumulators",
	"restoreToPrefix",
	"setDocumentModel",
	"setKeystrokeSignal",
	"settleOrphanedNames",
	"undefineEquationsFrom",
	"undefineUserUnitsFrom",
	"userUnitNames",
] as const;

/**
 * What the incremental evaluator needs of an engine: exactly the members named
 * in {@link EVALUATOR_SEAMS}. {@link ExpressionEngine} satisfies it, and the
 * evaluator holds its engine as this type, so a seam it starts to use has to
 * be added to the list, where it is seen, rather than reached for in passing.
 *
 * @internal
 */
export type EvaluatorHost = Pick<ExpressionEngine, (typeof EVALUATOR_SEAMS)[number]>;
