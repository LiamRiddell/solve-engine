import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import {
	DocumentModel,
	LineChange,
	LineState,
	ViewportRange,
} from "@solve-js/engine/DocumentModel";
import { Value, ValueType, enableValueArena, disableValueArena, errorValue, persistentValue, isArenaActive } from "@solve-js/vm/Value";
import { DependencyGraph, isPrefixedEdgeKey } from "@solve-js/vm/DependencyGraph";
import { VMCheckpointer } from "@solve-js/vm/VMCheckpoints";
import { isEmptyLine } from "@solve-js/engine/ExpressionEngineSafety";
// Deliberately the shared lexer, not an engine's own.
//
// `classifyLine` and `findInlineSolves` are character-level scans for headings,
// comment markers, code fences and backtick spans. Neither consults the
// keyword, unit or operator tables, so every lexer returns the same answer and
// there is nothing per-engine to respect. Pinned by
// __tests__/lexer/LineClassificationIsVocabularyIndependent.spec.ts, which
// compares a bare lexer against one carrying extra vocabulary.
//
// This matters because these are free functions with no engine to ask. Making
// them engine-aware would mean changing their signatures and every caller for
// no behavioural difference.
import { sharedLexer } from "@solve-js/lexer/Lexer";
import { CompilationWorkerManager, type CompileRequestItem } from "@solve-js/engine/CompilationWorkerManager";
import { PageManager } from "@solve-js/engine/PageManager";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import { withTagEdges } from "@solve-js/packages/tags/TagScanner";
import { sharedGlobalVariableStore, globalDagKey } from "@solve-js/vm/GlobalVariableStore";

// ── EvalTier (diagnostic enum) ──────────────────────────────────────────

/**
 * How much work a line's evaluation required.
 *
 * The tiers exist because most lines in a document have not changed. A line
 * that is clean and cached costs far less than one being compiled fresh, and
 * knowing which happened is how a slow document gets diagnosed.
 */
export enum EvalTier {
	/** Full pipeline: Lex → Parse → Compile → Execute (visible + dirty). */
	Tier1 = 1,
	/** Execute-only from cached bytecode (visible + cached). */
	Tier2 = 2,
	/** Compile-only for dependency tracking (invisible). Executes only variable assignments. */
	Tier3 = 3,
	/** Skipped, already clean or non-evaluable. */
	Skipped = 0,
}

// ── EvalLineResult ──────────────────────────────────────────────────────

/** Outcome for one line, including which tier handled it. */
export interface EvalLineResult {
	/** The line's persistent ID from DocumentModel. */
	lineId: number;
	/** 1-based line position. */
	lineNumber: number;
	/** Which tier was used. */
	tier: EvalTier;
	/** The first evaluation result, or null on error / non-evaluable. */
	result: Value | null;
	/** All result groups (one per expression/inline-solve), or undefined if skipped. */
	results?: Value[][];
	/** Error message, or null. */
	error: string | null;
}

// ── EvalResult ──────────────────────────────────────────────────────────

/** Outcome for a whole evaluation pass, with per-tier counts. */
export interface EvalResult {
	/** Per-line evaluation results. */
	lines: EvalLineResult[];
	/** Map of line numbers → flattened results for quick lookup. */
	resultMap: Map<number, Value[]>;
	/** Number of lines processed at each tier. */
	tierCounts: { tier1: number; tier2: number; tier3: number; skipped: number };
}

// ── ThreeTierEvaluator ──────────────────────────────────────────────────

/**
 * Orchestrates three-tier evaluation over a persistent DocumentModel.
 *
 * ── Tier assignment ─────────────────────────────────────────────────
 * | Tier  | Condition                          | Action                        |
 * |───────|────────────────────────────────────|───────────────────────────────|
 * | **1** | Visible + Dirty (new/changed)      | Full pipeline: lex→parse→compile→execute |
 * | **2** | Visible + Cached (scroll into view)| Execute from cached bytecode  |
 * | **3** | Invisible + Dirty                  | Compile-only; execute only variable defs |
 * | Skip  | Clean, empty, or non-evaluable     | No action                     |
 *
 * ── Evaluation order ─────────────────────────────────────────────────
 * Lines are always processed in ascending document order (line 1 → end)
 * so that variable assignments flow correctly through the shared VM.
 * Tier 2 relies on this: by the time a clean cached line is reached,
 * the VM already contains all variables from preceding Tier-1 lines.
 *
 * ── Thread safety ────────────────────────────────────────────────────
 * Tier 1 (visible+dirty) compilation runs synchronously on the main thread
 * for immediate rendering. Tier 3 (invisible+dirty) compilation can be
 * dispatched to a Web Worker via `dispatchBackgroundCompiles()`. Worker-
 * compiled bytecode is stored in the DocumentModel and validated via
 * `isBytecodeValid()` to ensure the line text hasn't changed between
 * dispatch and response.
 */
/**
 * Whether a definition's right-hand side reads the name it defines.
 *
 * `extractReadsAndWrites` records every `:name = ...` as reading `name` once,
 * a convention the graph relies on, so one occurrence says nothing. A second
 * is the right-hand side.
 */
function readsItself(reads: readonly string[], name: string): boolean {
	let seen = 0;
	for (const read of reads) if (read === name && ++seen === 2) return true;
	return false;
}

export class ThreeTierEvaluator {
	private doc: DocumentModel;
	private engine: ExpressionEngine;
	private dag: DependencyGraph;
	private checkpointer: VMCheckpointer | null;
	private compilationWorker: CompilationWorkerManager | null = null;
	private pageManager: PageManager;

	/**
	 * The text hash each line had when the graph last recorded what it reads,
	 * by line id.
	 *
	 * A positional edge is recorded at run time and pinned, so it outlives the
	 * text that produced it until the line runs again. Between an edit and
	 * that run the graph still describes the old text, and a line edited out
	 * of the viewport is compiled there without running, so the window can be
	 * as long as the reader likes. The document model records the edit as a
	 * new hash, and this is the hash the graph's edges for the line describe:
	 * a line arriving at the pass with a different one has its positions
	 * forgotten before anything else happens to it. See
	 * {@link forgetPositionsOfEditedText}.
	 */
	private textHashOfRecordedEdges: Map<number, number> = new Map();

	/**
	 * The names each line genuinely reads among those it writes, by line id.
	 *
	 * `:v3 = v3 + 3` reads `v3` on its right-hand side; `:v3 = 44` does not,
	 * although the graph records both as readers of `v3` by convention. The
	 * difference is visible only in the per-expression extraction, where the
	 * name appears twice, and only while Tier 1 has that in hand; the stored
	 * read set is deduplicated. Recorded there, read by Tier 2, which puts such
	 * a name back to the prefix before the line runs. Keyed by id so a
	 * structural edit does not lose it.
	 */
	private selfReadingWrites: Map<number, string[]> = new Map();

	/**
	 * Unsubscribe from sharedGlobalVariableStore, set in the constructor
	 * called from terminateWorker(). See the subscription itself below for
	 * why this only marks lines dirty and never re-evaluates synchronously.
	 */
	private globalUnsubscribe: (() => void) | null = null;

	/**
	 * @param doc The persistent document model.
	 * @param engine The expression engine (shared VM is accessed via engine.getVM()).
	 * @param checkpointer Optional VM state checkpointer. If provided, the evaluator
	 * will create checkpoints after variable-definition lines and support fast VM
	 * restoration via `restoreTo()`. If omitted, checkpointing is disabled.
	 */
	constructor(
		doc: DocumentModel,
		engine: ExpressionEngine,
		checkpointer?: VMCheckpointer
	) {
		this.doc = doc;
		this.engine = engine;
		this.dag = engine.getDag();
		// Built by default, because without one the engine answers wrong.
		//
		// A name written on more than one line has a value per position, and the
		// VM holds whichever write ran last. Anything re-running part of a
		// document therefore reads the state the document ENDS in unless this
		// rebuilds the state that position actually has. `setViewport` has always
		// asked for that (see {@link restoreTo}) and got nothing, so scrolling to
		// a line above a redefinition changed its answer: `:x = 1` / `x + 100`
		// with `:x = 99` below it showed 101, and 199 once scrolled to.
		//
		// It was an optional argument, which meant every host that did not know
		// to pass one got that. A caller may still supply its own, to share a
		// chain or to inspect it.
		this.checkpointer = checkpointer ?? new VMCheckpointer(engine.getVM());
		this.pageManager = new PageManager();

		// The async batcher re-runs a handful of lines out of the document when
		// a value arrives, against the same VM. Without the chain it reads what
		// the last full pass left, which is the state at the END of the
		// document, and a name written on more than one line is then wrong
		// everywhere below its second definition. Sharing the chain lets it
		// rebuild the state each line actually sits in. See
		// `AsyncResolutionBatcher.checkpointer`.
		this.engine.getBatcher().checkpointer = this.checkpointer;

		// Lets the engine answer "what's line N's cached result" for
		// cross-line features (prev/line<N>/aggregation) without owning
		// document lifecycle itself. See ExpressionEngine.makeLineContext().
		this.engine.setDocumentModel(this.doc);

		// ── Cross-document global-variable propagation ──────────────────
		// GlobalVariableAsyncResolver (via preflight) handles a line's FIRST
		// resolution when a global it reads wasn't known yet. This handles
		// the ONGOING case: a line that already has a real (non-pending)
		// value for `global :x` needs to go dirty again when some OTHER
		// document writes a NEW value to x, so this document's next
		// evaluate() picks up the change, "dealing with the DAG across
		// pages", not just first-resolution.
		this.globalUnsubscribe = sharedGlobalVariableStore.subscribe((name) => {
			// Mark-dirty ONLY, never synchronously re-evaluate here.
			// enableValueArena/disableValueArena (Value.ts) is a single
			// non-reentrant module-level flag; evaluate()/setViewport() both
			// wrap their body in it, so a re-entrant evaluate() call from
			// inside this callback (itself possibly firing from INSIDE
			// another evaluate() call, via a STORE_GLOBAL_VAR opcode in some
			// other document being evaluated concurrently) would disable the
			// arena out from under the still-running outer call. This
			// mirrors applyTransaction()'s existing contract exactly: mark
			// dirty, let the caller's own evaluate() cadence pick it up.
			for (const lineNumber of this.dag.getAffectedLines(globalDagKey(name))) {
				this.doc.markDirtyByLineNumber(lineNumber);
			}
		});
	}

	/**
	 * Evaluate all lines needed to render the given viewport.
	 *
	 * Processes lines from 1 to `viewport.endLine` in document order.
	 * Dirty lines in the viewport get Tier-1 full pipeline; clean cached
	 * lines get Tier-2 bytecode execution. Lines after the viewport
	 * get Tier-3 compile-only (with variable-def execution).
	 *
	 * @returns Results for all processed lines, including tier metadata.
	 */
	evaluate(viewport: ViewportRange, signal?: AbortSignal): EvalResult {
		// ── One AbortController Per Keystroke ────────────────────────
		// Link the UI layer's keystroke signal to the engine so that
		// all per-evaluation AbortControllers created during this call
		// are canceled when the user types a new keystroke.
		this.engine.setKeystrokeSignal(signal ?? null);

		// ── Phase 5.3: Enable arena for zero-allocation Value reuse ──
		enableValueArena();
		try {
			// Re-seed running-total accumulators before the from-line-1 pass. A
			// `total += 5` line reads its own running value, so re-running it in
			// place would read the previous evaluation's total and double-count.
			// Reset each accumulator variable and mark every line that touches
			// it dirty, so the loop below recomputes the total from its seed,
			// top to bottom. (No-op when the document has no accumulators.)
			this.reseedAccumulators();

			// The units in scope before the pass, so one that disappears during
			// it can be noticed.
			const unitsBefore = this.engine.userUnitNames();

			const lines: EvalLineResult[] = [];
			const resultMap = new Map<number, Value[]>();
			const tierCounts = { tier1: 0, tier2: 0, tier3: 0, skipped: 0 };

			// Process from line 1 to the end of the viewport for correct VM state.
			// We go to viewport.endLine because Tier 3 for invisible lines can be
			// done separately via backgroundCompile().
			const docEnd = this.doc.lineCount;
			const evalEnd = Math.min(viewport.endLine, docEnd);

			// Walked once, rather than descended into per position. See
			// `DocumentModel.getLineStatesInRange`.
			const states = this.doc.getLineStatesInRange(1, evalEnd);

			for (let pos = 1; pos <= evalEnd; pos++) {
				const state = states[pos - 1];
				if (!state) {
					tierCounts.skipped++;
					continue;
				}

				const inViewport = pos >= viewport.startLine && pos <= viewport.endLine;

				const lineResult = this.evaluateSingleLine(state, pos, inViewport);
				lines.push(lineResult);

				if (lineResult.tier === EvalTier.Tier1) tierCounts.tier1++;
				else if (lineResult.tier === EvalTier.Tier2) tierCounts.tier2++;
				else if (lineResult.tier === EvalTier.Tier3) tierCounts.tier3++;
				else tierCounts.skipped++;

				if (lineResult.results && inViewport) {
					resultMap.set(pos, lineResult.results.flat());
				}
			}

			// A line that read a position it had not read before may have
			// closed a cycle, and the end of the pass is when every edge the
			// walk would follow describes a run of the text that holds it.
			this.forgetCyclesClosedThisPass();

			// ── Phase 5.2g: Page-based LRU eviction ──────────────────────
			// Evict bytecode/results from cold/warm pages to bound memory.
			this.pageManager.maintainAfterEval(viewport, this.doc);

			// Every line has registered by now and the document is current, so a
			// name the pass reported as possibly undefined can be decided. See
			// `ExpressionEngine.settleOrphanedNames`.
			this.engine.settleOrphanedNames();

			// A user unit that was in scope when the pass began and is not now
			// has to reach the lines that used it, since a unit is expanded
			// while a line is compiled and those lines hold bytecode built
			// around it. Compared rather than counted, so a line that redefines
			// the same unit every pass does not invalidate for ever.
			const unitsAfter = new Set(this.engine.userUnitNames());
			if (unitsBefore.some((name) => !unitsAfter.has(name))) {
				this.engine.invalidateForRemovedUserUnits();
			}

			return { lines, resultMap, tierCounts };
		} finally {
			// Clear keystroke signal to prevent stale signal references
			// from being used by subsequent evaluations from other code paths.
			this.engine.setKeystrokeSignal(null);

			// Phase 5.3: Always disable arena, even on exception.
			// Prevents arena Values from leaking into subsequent evaluations or tests.
			disableValueArena();
		}
	}

	/**
	 * Background-compile invisible dirty lines beyond the viewport (Tier 3 only).
	 *
	 * Compiles expressions to discover reads/writes for the dependency graph
	 * without executing display-only expressions. Variable definitions are
	 * executed to maintain VM state for future Tier-2 executions.
	 *
	 * This is intended to be called after evaluate() so visible lines are
	 * rendered first, then background work fills in the dependency graph.
	 *
	 * **Phase 5.2h:** This synchronous method is retained for environments
	 * without Worker support. Prefer `dispatchBackgroundCompiles()` which
	 * offloads compilation to a Web Worker with Transferable bytecode.
	 */
	backgroundCompile(viewport: ViewportRange): EvalLineResult[] {
		const results: EvalLineResult[] = [];
		const docEnd = this.doc.lineCount;
		const startPos = viewport.endLine + 1;

		for (let pos = startPos; pos <= docEnd; pos++) {
			const state = this.doc.getLineAt(pos);
			if (!state) continue;

			// Skip clean lines, already compiled + executed
			if (!state.dirty) continue;

			// Skip already-compiled Tier 3 lines, they have bytecode
			// but were compiled without execution (non-variable-def).
			// Recompiling is wasteful since the text hasn't changed
			// (text change clears bytecodes via editLine).
			if (state.bytecodes.length > 0 && !state.isVariableDef) continue;

			const lineResult = this.evaluateSingleLine(state, pos, false);
			results.push(lineResult);
		}

		return results;
	}

	/**
	 * Dispatch background compilation to a Web Worker (Phase 5.2h).
	 *
	 * Collects invisible dirty lines beyond the viewport that need compilation,
	 * sends them to the compilation worker, and asynchronously stores the
	 * transferred bytecode in the DocumentModel when the worker responds.
	 *
	 * This is the non-blocking alternative to `backgroundCompile()`. The worker
	 * compiles expressions with Transferable ArrayBuffers (zero-copy postMessage),
	 * so bytecode appears on the main thread without serialization overhead.
	 *
	 * Lines that already have cached bytecode (from a previous worker pass or
	 * synchronous compile) are skipped, only truly uncompiled dirty lines are
	 * sent to the worker.
	 *
	 * **Usage:** Call after `evaluate()` so visible lines render first, then
	 * this fills the bytecode cache for future Tier-2 scrolls.
	 *
	 * @param viewport The current visible range. Lines beyond viewport.endLine
	 * that are dirty and don't have bytecode are dispatched.
	 */
	dispatchBackgroundCompiles(viewport: ViewportRange): void {
		// Collect invisible dirty lines that need compilation
		const items = this.collectInvisibleCompileTargets(viewport);
		if (items.length === 0) return;

		// Lazy-init the worker (only if there are items to compile)
		if (!this.compilationWorker) {
			this.compilationWorker = new CompilationWorkerManager();
		}

		// Fire-and-forget: send to worker, store results when they arrive
		this.compilationWorker.compileBatch(items).then((results) => {
			this.compilationWorker!.storeResults(results, this.doc);
		}).catch((_err) => {
			// Worker failure is non-fatal, next evaluate() will compile
			// these expressions synchronously.
		});
	}

	/**
	 * Terminate the compilation worker if active, and unsubscribe from
	 * sharedGlobalVariableStore. Call this when the evaluator is no longer
	 * needed to clean up resources, every call site that retires a
	 * ThreeTierEvaluator (document switch, pane destroy()) already calls
	 * this unconditionally, so folding the global-store unsubscribe in here
	 * needs no new call sites anywhere.
	 */
	terminateWorker(): void {
		if (this.compilationWorker) {
			this.compilationWorker.terminate();
			this.compilationWorker = null;
		}
		if (this.globalUnsubscribe) {
			this.globalUnsubscribe();
			this.globalUnsubscribe = null;
		}
	}

	/**
	 * Get the DocumentModel (read-only access for decoration building).
	 */
	getDoc(): DocumentModel {
		return this.doc;
	}

	/**
	 * Evaluate all dirty lines in the document, regardless of viewport.
	 * Used for full re-evaluation after plugin register/unregister.
	 */
	evaluateAll(signal?: AbortSignal): EvalResult {
		const viewport = { startLine: 1, endLine: this.doc.lineCount };
		const result = this.evaluate(viewport, signal);
		// evaluate() already calls maintainAfterEval internally
		return result;
	}

	/**
	 * Zero-allocation viewport evaluation, the Phase 5.2e "holy grail."
	 *
	 * **Key insight:** When the user scrolls (viewport-only change, no edits),
	 * we don't need to re-evaluate from line 1. Instead:
	 *
	 * 1. Restore the VM to just before the viewport via the nearest checkpoint.
	 * 2. Evaluate ONLY the visible lines (Tier 2 for clean cached, Tier 1 for dirty).
	 * 3. Lines before the viewport are completely skipped, their state lives in
	 *    the VM checkpointer's prototypal chain.
	 *
	 * **Correctness guard:** If any variable-definition line before the viewport
	 * is dirty (e.g., the user edited a variable def that hasn't been
	 * re-evaluated yet), we clear stale checkpoints and fall back to `evaluate()`
	 * which processes from line 1 and rebuilds fresh checkpoints. This
	 * guarantees that stale checkpoints are never used as restoration targets.
	 * Only variable-def lines matter here, `VMCheckpointer.snapshot()` only
	 * records state for lines that write a variable, so a dirty plain-expression
	 * line before the viewport has no checkpoint to invalidate (see
	 * `DocumentModel.hasAnyDirtyVariableDefLineBefore()`).
	 *
	 * **Performance:** O(visible lines) instead of O(document length). Target:
	 * < 1ms for a typical ~30-line viewport, independent of document size.
	 *
	 * @param viewport The visible line range.
	 * @returns Results for visible lines only. Lines before the viewport are
	 * not included in `lines[]` or `resultMap`.
	 */
	setViewport(viewport: ViewportRange, signal?: AbortSignal): EvalResult {
		// ── One AbortController Per Keystroke ────────────────────────
		// Link the UI layer's keystroke signal to the engine.
		this.engine.setKeystrokeSignal(signal ?? null);

		// ── Correctness guard: dirty lines before viewport invalidate checkpoints ──
		if (viewport.startLine > 1 && this.hasDirtyLinesBefore(viewport.startLine)) {
			// Clear stale checkpoints, evaluate() will rebuild them from line 1.
			// evaluate() handles its own arena enable/disable and signal cleanup.
			this.checkpointer?.clear();
			return this.evaluate(viewport, signal);
		}

		// ── Running totals are re-seeded here too ──
		// A `total += 5` line compiles to no bytecode, so a clean one cannot be
		// re-run from cache: it has to go back through the full pipeline. That
		// was already true, and harmless while the VM was never rewound, because
		// the total simply stayed where the last pass left it. Restoring to the
		// line before the viewport rewinds it, and a viewport containing the
		// accumulator lines then found nothing to rebuild them from:
		// `spent += 10` / `spent += 20` / `spent` answered
		// `Undefined variable: spent` on a scroll. Marking them dirty sends them
		// to Tier 1, which recomputes each total from its seed.
		this.reseedAccumulators();

		// ── Phase 5.2g: Page-based LRU eviction (MUST run before preload) ──
		// maintainAfterEval captures the scroll direction and updates lastViewportStart
		// BEFORE preloadNextPages reads the direction for preloading.
		this.pageManager.maintainAfterEval(viewport, this.doc);

		// ── Phase 5.2g: Detect scroll direction & preload ───────────
		this.preloadNextPages(viewport);

		// ── Restore VM state from nearest checkpoint before the viewport ──
		// This sets all variables that were defined at or before startLine-1.
		this.restoreTo(viewport.startLine - 1);

		// ── Phase 5.3: Enable arena for zero-allocation Tier 2 execution ──
		enableValueArena();
		try {
			// ── Evaluate only visible lines ──
			const result = this.collectEvalResults(viewport.startLine, viewport.endLine);
			return result;
		} finally {
			// Clear keystroke signal to prevent stale signal references.
			this.engine.setKeystrokeSignal(null);

			// Phase 5.3: Always disable arena, even on exception.
			// Prevents cross-test contamination from arena leaks.
			disableValueArena();
		}
	}

	/**
	 * Apply incremental line-level changes to the document model.
	 *
	 * **Phase 5.2f:** Replaces the O(N) `setDocument()` + full re-evaluation
	 * with O(changed) incremental updates. Key benefits:
	 *
	 * 1. Unchanged lines retain their persistent lineIds → bytecode survives
	 * 2. Only changed + DAG-downstream lines are marked dirty → Tier 1 re-evaluation
	 * 3. Clean lines in viewport use Tier 2 (cached bytecode execution)
	 * 4. Clean lines outside viewport are skipped entirely
	 *
	 * The DAG is fully cleared after propagation: shifted lines would have
	 * stale entries keyed by old line numbers, so the DAG is rebuilt from
	 * scratch during the subsequent `evaluate()` call.
	 *
	 * **Caller should follow up with `evaluate(viewport)`** to re-evaluate
	 * dirty lines from line 1 and rebuild the DAG + checkpoints.
	 *
	 * @param changes Line-level changes to apply. Must be non-overlapping.
	 * @returns Metadata about the applied changes.
	 */
	applyTransaction(changes: LineChange[]): {
		inserted: number[];
		removed: number[];
	} {
		// ── Phase 1: Collect DAG writes + downstream lineIds ───────────
		// Must happen BEFORE applyChanges() because line numbers are still
		// valid at this point. We collect writes from deleted lines and
		// resolve downstream consumers to lineIds (not line numbers) so
		// they survive the position shifts that applyChanges() causes.
		const allWrites = new Set<string>();

		for (const change of changes) {
			for (let i = 0; i < change.deleteCount; i++) {
				const lineNum = change.startLine + i;
				const writes = this.dag.getWrites(lineNum);
				for (const w of writes) {
					allWrites.add(w);
				}
				// Clean up DAG references for this line, and forget any name the
				// deleted line was the last to define.
				this.undefineOrphans(this.dag.removeLine(lineNum));
				// A deleted line will never be compiled again, so it cannot drop
				// its own definitions on the way through. Losing one reaches the
				// lines that used it here rather than at the end of a pass,
				// because this runs before the next pass begins and that
				// comparison would see the unit already gone.
				if (this.engine.undefineUserUnitsFrom(this.doc.getLineAt(lineNum)?.lineId ?? -1)) {
					this.engine.invalidateForRemovedUserUnits();
				}
				// And its cached bytecode. The dependency graph was already
				// pruned here; the LineCache was not, so a deleted line kept its
				// entry until the whole cache was dropped on a document switch.
				// Editing a long document over a session accumulated entries for
				// line numbers that no longer existed.
				this.engine.getLineCache().removeAllForLine(lineNum);
			}
		}

		// Resolve downstream consumers to persistent lineIds BEFORE the
		// structural change shifts line numbers. After applyChanges(),
		// we mark these lineIds dirty, their positions don't matter.
		const downstreamLineIds = new Set<number>();
		const positionalReaderLineIds = new Set<number>();

		// Every line that reads a position joins them, because a structural
		// edit changes what a position means without changing a character of
		// the line that reads it. `line 5` names different text once a line is
		// inserted above it, `prev` names a different neighbour, and an `above`
		// aggregate covers a different block. None of that reaches the loop
		// above, which follows the names a deleted line wrote.
		//
		// A reader that moved counts too, not only one whose target moved:
		// `line 5 + 4` sitting at position 4 is a reference, and after an
		// insert above it, sitting at position 5, it is a self-reference. A
		// settled pass reports that; the edited document answered from the
		// value it had.
		//
		// Their answers go as well as their dirty flag, which is the half that
		// was missing. Marking a line dirty says it must run again; it does not
		// stop another line reading what it said in the meantime, and after a
		// structural edit what it said was about a document that no longer
		// exists. Two positional readers that end up reading each other then
		// chase those old answers instead of reporting the cycle: `line 3 + 5`
		// above an `average above` that covers it took the average's previous
		// value, computed a new one, and the average recomputed from that, by a
		// smaller amount each pass, landing wherever the passes ran out. With
		// nothing to chase, both report the cycle, which is what a pass over the
		// same text reports.
		//
		// Only on a structural edit, and only these lines. An ordinary edit
		// leaves every position meaning what it meant, so a reader's answer is
		// still about this document and taking it away would show an error to
		// whoever asked before it ran again.
		for (const reader of this.dag.linesReadingAPosition()) {
			const state = this.doc.getLineAt(reader);
			if (!state) continue;
			downstreamLineIds.add(state.lineId);
			positionalReaderLineIds.add(state.lineId);
		}
		for (const writeVar of allWrites) {
			const affected = this.dag.getAffectedLines(writeVar);
			for (const lineNum of affected) {
				const state = this.doc.getLineAt(lineNum);
				if (state) {
					downstreamLineIds.add(state.lineId);
				}
			}
		}

		// ── Phase 2: Apply structural changes to DocumentModel ─────────
		const result = this.doc.applyChanges(changes);

		// ── Phase 3: Clear checkpointer (line numbers shifted) ─────────
		this.checkpointer?.clear();

		// ── Phase 4: Mark DAG-downstream lines dirty by lineId ─────────
		// Using lineId instead of line number is position-agnostic:
		// lines that shifted due to insertions/deletions above them are
		// still correctly targeted. Lines that were deleted (lineId no
		// longer in the doc) are silently ignored by markDirty().
		for (const lineId of downstreamLineIds) {
			this.doc.markDirty(lineId);
		}
		for (const lineId of positionalReaderLineIds) {
			this.doc.forgetResult(lineId);
		}

		// ── Phase 5: Clear DAG to avoid phantom entries ────────────────
		// Entries keyed by old line numbers are stale after structural
		// changes. Rather than updating shifted entries, we clear the DAG
		// and let the subsequent evaluate() call rebuild it from scratch.
		this.dag.clear();

		// A deleted line's id is never seen again, so its entries are dead weight.
		for (const lineId of result.removed) {
			this.textHashOfRecordedEdges.delete(lineId);
			this.selfReadingWrites.delete(lineId);
		}

		return {
			inserted: result.inserted,
			removed: result.removed,
		};
	}

	/**
	 * Forget the positions the graph says a line reads, once its text changed.
	 *
	 * A positional edge is discovered while the line runs and pinned, because
	 * the text cannot put it back when the line re-registers. That is right
	 * while the text is the same and wrong the moment it is not: `prev + 1`
	 * edited to `7` went on reading line 1 in the graph until it ran, and a
	 * line edited out of the viewport is compiled there without running, so
	 * it could go on for as long as the reader liked. Three of the attempts
	 * recorded on #444 found cycles that had already been edited away for
	 * exactly that reason.
	 *
	 * Keyed on the edit itself, which the document model records as a new
	 * text hash, rather than on anything the graph knows. Done at the line's
	 * first visit after the edit, whatever tier that visit takes, and only
	 * when the line is dirty, since an edit always dirties, so a clean line's
	 * text is the text its edges describe. The run that follows records what
	 * the new text reads, and {@link DependencyGraph.reconcilePositionReads}
	 * keeps that exact from then on.
	 */
	private forgetPositionsOfEditedText(state: LineState, lineNumber: number): void {
		const recordedFor = this.textHashOfRecordedEdges.get(state.lineId);
		if (recordedFor === state.textHash) return;
		if (recordedFor !== undefined) this.dag.forgetPositionReads(lineNumber);
		this.textHashOfRecordedEdges.set(state.lineId, state.textHash);
	}

	/**
	 * Take the answers off any positional cycle this pass closed, once.
	 *
	 * Two lines that read each other's positions have no settled value: reached
	 * from scratch neither has a value to start from, so each reports the other
	 * and stays there. Reached by an ordinary edit, one of them already holds a
	 * number computed about the document before the edit, the other reads it,
	 * and the pair chases those numbers for as long as the document is open:
	 * `line 2 + 5` edited in above `prev + 5` grew by ten a pass.
	 *
	 * The edge that closes a cycle is recorded when the reader that holds it
	 * runs its current text, and the graph names those readers. From them, a
	 * walk over the positions each line reads finds the strongly connected
	 * components, and a component of more than one line that holds one of
	 * them is a cycle this pass closed (a cycle that already existed reaches
	 * the same state on its own, and if it is on the walk it holds errors, so
	 * nothing below touches it). The walk is one pass over what the new edges
	 * reach, however many readers there are, which is what keeps a column of
	 * `prev + 1` linear on the pass after an insert, when every edge is new;
	 * and it is skipped outright while no edge points downwards, since a cycle
	 * needs one and a document of `prev` and `above` has none.
	 *
	 * Every edge followed is current: an edited line's positions are forgotten
	 * before it runs (see {@link forgetPositionsOfEditedText}), a run cuts the
	 * line's positions back to what it read, and a structural edit clears the
	 * graph. That is what an earlier attempt lacked, and why it found cycles
	 * that had been edited away.
	 *
	 * Only a member holding an answer is reset, and it is reset once. A pass
	 * from scratch has every member holding an error by the time the cycle
	 * closes, because some member reads a line below it that has not run, and
	 * every positional form answers an unread or errored line with an error,
	 * all the way round. So a number on a member is the one thing a settled
	 * pass never holds, and forgetting it, with the line marked to run again,
	 * leaves the members in the state a pass from scratch is in. From there
	 * both paths take the same steps to the same answers. Resetting on every
	 * pass, which an earlier attempt did, re-created the not-yet-evaluated
	 * answer on every pass and stranded the reader.
	 */
	private forgetCyclesClosedThisPass(): void {
		const gained = this.dag.takeReadersThatGainedAPosition();
		const changes = this.dag.takeEdgeChanges();
		// A cycle is closed, or the name that pinned one withdrawn, by a change in
		// the graph, so the walk starts from what changed: readers that gained a
		// position, lines whose edges changed, and the readers of a name whose
		// producers changed. A settled pass changes nothing and walks nothing.
		const roots = new Set<number>(gained);
		for (const line of changes.lines) roots.add(line);
		for (const key of changes.keys) {
			if (isPrefixedEdgeKey(key)) continue;
			for (const reader of this.dag.directConsumersOf(key)) roots.add(reader);
		}
		if (roots.size === 0) return;

		// Tarjan's components, iteratively: a `prev` chain can be thousands of
		// lines deep, which is deeper than a recursive walk should go.
		const index = new Map<number, number>();
		const low = new Map<number, number>();
		const onStack = new Set<number>();
		const stack: number[] = [];
		const frames: { line: number; targets: number[]; next: number }[] = [];
		let visited = 0;
		const enter = (line: number): void => {
			index.set(line, visited);
			low.set(line, visited);
			visited++;
			stack.push(line);
			onStack.add(line);
			frames.push({ line, targets: this.dependantsOf(line), next: 0 });
		};

		for (const root of roots) {
			if (index.has(root)) continue;
			enter(root);
			while (frames.length > 0) {
				const frame = frames[frames.length - 1];
				if (frame.next < frame.targets.length) {
					const target = frame.targets[frame.next++];
					if (!index.has(target)) enter(target);
					else if (onStack.has(target)) low.set(frame.line, Math.min(low.get(frame.line)!, index.get(target)!));
					continue;
				}
				frames.pop();
				if (frames.length > 0) {
					const parent = frames[frames.length - 1].line;
					low.set(parent, Math.min(low.get(parent)!, low.get(frame.line)!));
				}
				if (low.get(frame.line) !== index.get(frame.line)) continue;
				const members: number[] = [];
				let member: number;
				do {
					member = stack.pop()!;
					onStack.delete(member);
					members.push(member);
				} while (member !== frame.line);
				// A component of one line is never a cycle here: a definition that
				// reads the name it writes is put back to the prefix before it runs,
				// which is all the from-scratch pass does with it too.
				if (members.length > 1 && members.some((line) => roots.has(line))) this.forgetAnswersOn(members);
			}
		}
	}

	/**
	 * The lines whose answers are computed from this line's: the readers of its
	 * position, and the readers of each name it writes.
	 *
	 * Both kinds of edge, because a cycle can run through either. `line 2 + 5`
	 * above `prev + 5` is a cycle of positions; `:v1 = v2 + 5` above
	 * `:v2 = v1 + 8` is a cycle of names; `spent += line 3` above `spent` is
	 * one of each. A walk that followed positions alone found the first and
	 * declared the other two out of scope.
	 *
	 * Edges point the way the graph's consumer index points, from a line to
	 * what reads it, which is the transpose of "what this line reads". The
	 * strongly connected components of a graph and its transpose are the same
	 * sets, so the walk finds the same cycles, and the consumer index is the one
	 * the graph keeps clear of a definition's conventional read of its own name
	 * and of a running total's read of its own total. Followed as raw reads,
	 * every definition was a self-loop and every twice-defined name a cycle.
	 *
	 * Only variable names among the keys: a tag, a global or a data source is
	 * not a line's answer, and a cycle cannot run through one.
	 */
	private dependantsOf(line: number): number[] {
		const out = [...this.dag.getAffectedLinesByPosition(line)];
		for (const key of this.dag.getWrites(line)) {
			if (isPrefixedEdgeKey(key)) continue;
			for (const reader of this.dag.directConsumersOf(key)) out.push(reader);
		}
		return out;
	}

	/**
	 * Take the answer off each member of a cycle that holds one.
	 *
	 * An error is left where it is: it is what a settled pass holds, and the
	 * line re-runs to the same error regardless. A value still arriving is left
	 * too, since forgetting it would only start the fetch again.
	 */
	private forgetAnswersOn(members: readonly number[]): void {
		for (const member of members) {
			const state = this.doc.getLineAt(member);
			if (state === undefined) continue;
			const held = state.result;
			if (held === null || held.type === ValueType.Error || held.type === ValueType.Pending) continue;
			this.doc.forgetResult(state.lineId);
			this.doc.markDirty(state.lineId);
			// Its names too, now rather than when it next runs. A member above
			// another reads that one's name before the other runs, and would read
			// the stale value the reset exists to remove.
			for (const written of state.writes) this.engine.restoreToPrefix(written, member);
		}
	}

	// ── Private helpers ─────────────────────────────────────────────────

	/**
	 * Reset running-total accumulators and mark the lines that touch them
	 * dirty, so the from-line-1 pass in {@link evaluate} recomputes each total
	 * from its seed instead of reading its own previous evaluation's value.
	 *
	 * A `total += 5` line compiles to no bytecode (it rides the symbolic
	 * channel), so a clean one would be skipped by the tier dispatch rather
	 * than re-run. It must re-run to re-apply its delta over the freshly-reset
	 * base, so every line that WRITES an accumulator name is forced dirty (the
	 * DAG drops a self-writing line from its own variable's consumers, so
	 * getAffectedLines can't surface them). Pure readers of the total keep
	 * their real bytecode and re-run via Tier 2 once the total is correct, so
	 * they need no special handling. Cheap: a no-op unless the document
	 * actually uses `+=`/`-=`, and accumulators are rare.
	 */
	private reseedAccumulators(): void {
		const names = this.engine.resetAccumulators();
		if (names.size === 0) return;
		// Read from the lines themselves, not from the dependency graph.
		//
		// A structural edit clears the graph (see {@link applyTransaction}) and
		// lets the next pass rebuild it, so asking the graph what each line
		// writes answers nothing at all on the pass that follows an insert or a
		// delete. No accumulator line was marked, so none re-ran, and the totals
		// below the edit kept the previous pass's sum: inserting `spent += 2`
		// above `spent += 7` left the second line reading 7 rather than 9. The
		// line's own write set is recorded on the line and survives the edit.
		const docEnd = this.doc.lineCount;
		for (let pos = 1; pos <= docEnd; pos++) {
			const state = this.doc.getLineAt(pos);
			if (state === undefined || state.writes.length === 0) continue;
			for (const written of state.writes) {
				if (names.has(written)) {
					this.doc.markDirtyByLineNumber(pos);
					break;
				}
			}
		}
	}

	/**
	 * Collect evaluation results for a contiguous range of lines.
	 *
	 * Used by both `evaluate()` (startLine=1) and `setViewport()` (any start).
	 * All lines in the range are treated as in-viewport (visible), callers that
	 * need the invisible/dirty → Tier 3 handling should use `evaluate()` instead.
	 *
	 * @param startLine First line to evaluate (1-based, inclusive).
	 * @param endLine Last line to evaluate (1-based, inclusive). Clamped to docEnd.
	 */
	private collectEvalResults(startLine: number, endLine: number): EvalResult {
		const lines: EvalLineResult[] = [];
		const resultMap = new Map<number, Value[]>();
		const tierCounts = { tier1: 0, tier2: 0, tier3: 0, skipped: 0 };

		const docEnd = this.doc.lineCount;
		const evalEnd = Math.min(endLine, docEnd);

		for (let pos = startLine; pos <= evalEnd; pos++) {
			const state = this.doc.getLineAt(pos);
			if (!state) continue;

			// All processed lines are in-viewport for setViewport, or conditionally
			// in-viewport for evaluate (handled by caller). We pass `true` here
			// because evaluateSingleLine's `inViewport` param controls Tier 1 vs
			// Tier 3 dispatch; callers must manage this distinction externally.
			//
			// evaluate() handles this by passing `inViewport` per-line; it loops
			// directly rather than using this helper for that reason.
			const lineResult = this.evaluateSingleLine(state, pos, true);
			lines.push(lineResult);

			if (lineResult.tier === EvalTier.Tier1) tierCounts.tier1++;
			else if (lineResult.tier === EvalTier.Tier2) tierCounts.tier2++;
			else if (lineResult.tier === EvalTier.Tier3) tierCounts.tier3++;
			else tierCounts.skipped++;

			if (lineResult.results) {
				resultMap.set(pos, lineResult.results.flat());
			}
		}

		// The same end-of-pass check `evaluate` makes; a viewport pass runs
		// lines and records what they read just as a full one does.
		this.forgetCyclesClosedThisPass();

		return { lines, resultMap, tierCounts };
	}

	/**
	 * Check whether any **variable-definition** line before `position`
	 * (1-based, exclusive) is dirty.
	 *
	 * Used by `setViewport()` to decide whether to fall back to `evaluate()`:
	 * if a variable-def before the viewport is dirty, the checkpoint state
	 * `restoreTo()` would use may be stale and we need to reprocess from
	 * line 1 to rebuild checkpoints correctly.
	 *
	 * Deliberately narrower than `DocumentModel.hasAnyDirtyLineBefore()`:
	 * checkpoints only snapshot variable-def lines (see VMCheckpointer), so a
	 * dirty plain-expression line before the viewport can't have invalidated
	 * one, there's nothing checkpointed for it to invalidate. Using the
	 * broader check here previously caused a real perf bug: `PageManager`'s
	 * cold-page eviction marks evicted non-variable-def lines dirty, so
	 * scrolling far into a large, variable-def-free document would trip this
	 * guard, fall back to `evaluate()`, which recompiles those lines via
	 * Tier 3 (never clearing their dirty flag by design), causing the very
	 * next `maintainAfterEval()` to re-evict and re-dirty them, a
	 * self-sustaining loop that pinned every subsequent `setViewport()` call
	 * to the cost of a full re-evaluation instead of O(visible lines).
	 *
	 * Delegates to DocumentModel.hasAnyDirtyVariableDefLineBefore(), which
	 * tracks dirty lineIds incrementally instead of scanning every line up to
	 * `position` on every call. This used to be a real per-scroll cost
	 * (benchmarked at ~10ms scrolled near the bottom of a 20k-line document)
	 * since it fired on every viewport change, not just edits.
	 */
	private hasDirtyLinesBefore(position: number): boolean {
		return this.doc.hasAnyDirtyVariableDefLineBefore(position);
	}

	/**
	 * Evaluate a single line using the appropriate tier.
	 *
	 * Tier assignment logic:
	 * - Empty/markdown-only lines → skipped
	 * - Dirty + in-viewport → Tier 1 (full pipeline)
	 * - Dirty + not in viewport → Tier 3 (compile-only, execute variable defs)
	 * - Clean + has bytecode + in viewport → Tier 2 (execute from cache)
	 * - Clean + no bytecode → skipped (non-evaluable)
	 *
	 * Around the dispatch, the graph is kept honest about what the line reads
	 * by position: an edited line's old positions go before it runs, and a
	 * line that executed is cut back to the positions that run read. Only an
	 * executing tier is reconciled, since a line compiled without running, or
	 * skipped, read nothing for a reason that says nothing about its text.
	 */
	private evaluateSingleLine(
		state: LineState,
		lineNumber: number,
		inViewport: boolean
	): EvalLineResult {
		// An edit always dirties, so a clean line's edges describe its text and
		// the map is not consulted for it: the check costs the pass nothing on
		// the lines that are most of it.
		if (state.dirty) this.forgetPositionsOfEditedText(state, lineNumber);
		const lineResult = this.dispatchLine(state, lineNumber, inViewport);
		if (lineResult.tier === EvalTier.Tier1 || lineResult.tier === EvalTier.Tier2) {
			this.dag.reconcilePositionReads(lineNumber);
		}
		return lineResult;
	}

	/** The tier dispatch itself; see {@link evaluateSingleLine} for what wraps it. */
	private dispatchLine(
		state: LineState,
		lineNumber: number,
		inViewport: boolean
	): EvalLineResult {
		const baseResult: Omit<EvalLineResult, "tier" | "result" | "error"> = {
			lineId: state.lineId,
			lineNumber,
		};

		// A clean line outside the viewport has nothing to do, and nothing has
		// to be worked out in order to know that.
		//
		// It is the last case the dispatch below reaches, so it used to arrive
		// there having paid for an emptiness scan of its text and an expression
		// extraction, neither of which can change the answer: the line is not
		// dirty, so it is not compiled, and it is not visible, so it is not
		// executed. A pass runs from line 1 to the end of the viewport, so on a
		// long document scrolled to the bottom almost every line took that
		// route, and an edit cost the distance from line 1 rather than the size
		// of the viewport.
		//
		// The two paths below this also mark an empty line clean and record
		// that it is empty. Both are already true of a line that is clean: it
		// has been through here before, on the pass that cleaned it.
		if (!state.dirty && !inViewport) {
			return { ...baseResult, tier: EvalTier.Skipped, result: null, error: null };
		}

		// Skip empty/markdown-only lines
		if (state.isEmpty || isEmptyLine(state.text)) {
			this.deregisterIfDirty(state, lineNumber);
			state.isEmpty = true;
			this.doc.markClean(state.lineId);
			return { ...baseResult, tier: EvalTier.Skipped, result: null, error: null };
		}

		// Extract all evaluable expressions (may be multiple inline solves)
		const { expressions, inlineSolveCount } = this.extractExpressions(state);
		if (expressions.length === 0) {
			this.deregisterIfDirty(state, lineNumber);
			state.isEmpty = true;
			this.doc.markClean(state.lineId);
			return { ...baseResult, tier: EvalTier.Skipped, result: null, error: null };
		}

		// Determine the expression to evaluate (only needed for dirty lines)
		if (state.dirty) {
			if (inViewport) {
				// ── Tier 1: Visible + Dirty → Full Pipeline ──────────
				return this.evaluateTier1(state, lineNumber, expressions, inlineSolveCount, baseResult);
			} else {
				// ── Tier 3: Invisible + Dirty → Compile-only ─────────
				// Skip recompilation if already compiled by a previous Tier 3 pass.
				// Non-variable-def lines keep dirty=true after Tier 3 (so they get
				// Tier 1 when scrolled into view), but recompiling identical text
				// produces the same bytecode and DAG entries. Text changes clear
				// bytecodes via DocumentModel.editLine(), so a length check is safe.
				if (state.bytecodes.length > 0 && state.bytecodes.length === expressions.length && !state.isVariableDef) {
					return { ...baseResult, tier: EvalTier.Skipped, result: null, error: null };
				}
				return this.evaluateTier3(state, lineNumber, expressions, inlineSolveCount, baseResult);
			}
		}

		// Line is clean
		if (inViewport && state.bytecodes.length > 0) {
			// ── Tier 2: Visible + Cached → Execute from bytecode ────
			return this.evaluateTier2(state, lineNumber, baseResult);
		}

		// Clean, not in viewport, or no bytecode → skip
		return { ...baseResult, tier: EvalTier.Skipped, result: null, error: null };
	}

	/**
	 * A line edited into something with nothing to evaluate stops defining.
	 *
	 * A heading, a comment or a blank is skipped before anything is compiled, so
	 * it never reached the registration that tells the graph what it writes, and
	 * its old edges stood. Turning `:v3 = 19` into `# a heading` therefore left
	 * `v3` defined for the rest of the session, and a line reading it went on
	 * answering, or blamed the wrong name: `v3 * v0` reported `v0` as the
	 * undefined one where a fresh pass reports `v3`.
	 *
	 * Registering it with no edges is what says so. Only when the line is dirty,
	 * since a line that was already empty has nothing to withdraw, and its own
	 * write set is dropped as part of registering nothing.
	 *
	 * Any unit it defined goes the same way, and for the same reason: a line
	 * drops its own definitions as it is compiled again, which a line nothing
	 * compiles never reaches. Whether that has to reach the lines that used the
	 * unit is decided once at the end of the pass, by comparing the units in
	 * scope before and after it.
	 */
	private deregisterIfDirty(state: LineState, lineNumber: number): void {
		if (!state.dirty) return;
		state.reads = [];
		state.writes = [];
		this.registerWithTags(lineNumber, [], []);
		this.engine.undefineUserUnitsFrom(state.lineId);
		// And its checkpoint, for the same reason Tier 1 drops one for a line
		// that wrote nothing: a heading defines nothing.
		this.checkpointer?.dropCheckpointAt(lineNumber);
	}

	/**
	 * Register a line's edges, with the groups its text joins and asks about.
	 *
	 * The evaluator registers from three places and the engine from two, and a
	 * line registered twice with different edge sets loses whichever went first.
	 * They all route through the same helper so the sets cannot disagree.
	 */
	private registerWithTags(lineNumber: number, reads: string[], writes: string[]): void {
		const text = this.doc.getLineAt(lineNumber)?.text ?? "";
		const edges = withTagEdges(text, reads, writes);
		this.undefineOrphans(this.dag.registerLine(lineNumber, edges.reads, edges.writes));
	}

	/**
	 * Forget names that no line defines any more.
	 *
	 * The graph reports a key when the line that wrote it stops doing so and no
	 * other line writes it. The VM's variable store only ever accumulated, so
	 * the value outlived the line: deleting `:x = 12` left `x + 4` answering
	 * `16` for the rest of the session, and editing away `1 sprint = 2 weeks`
	 * left the conversions below it working.
	 *
	 * The checkpoint chain is told as well, since it records what each line
	 * wrote and would otherwise put the name back on the next restore.
	 *
	 * Only variable names: the key space also holds category tags, globals, data
	 * sources and line positions, and none of those is a VM binding. A prefix is
	 * what tells them apart, and a variable's key is the bare name.
	 */
	private undefineOrphans(orphaned: readonly string[]): void {
		this.engine.forgetOrphanedNames(orphaned);
	}

	/**
	 * Tier 1: Full pipeline, lex, parse, compile, execute.
	 * Uses the engine's existing evaluateLine() which handles all pipeline
	 * stages including DAG updates and LineCache population.
	 *
	 * Supports multiple expressions per line (inline solves). Evaluates each
	 * expression left-to-right through the engine so variable definitions in
	 * earlier solves update the VM state before later solves are evaluated.
	 * Reads/writes are aggregated across all expressions for the DAG.
	 */
	private evaluateTier1(
		state: LineState,
		lineNumber: number,
		expressions: string[],
		inlineSolveCount: number,
		baseResult: Omit<EvalLineResult, "tier" | "result" | "error">
	): EvalLineResult {
		// Whatever this line used to define, it does not any more until it says
		// so again while being compiled below.
		//
		// Done here rather than while compiling, because compiling can be
		// skipped: the bytecode cache is keyed by the expression's TEXT, so a
		// line edited into something another line already says is a cache hit
		// and never reaches the compiler. Editing the definition in
		// `5 sprints in weeks` / `spent` / `1 sprint = 4 weeks` to `spent` is
		// exactly that, and the unit survived the line that declared it.
		//
		// A line that still is a definition re-registers it as it compiles, and
		// the pass compares the units in scope before and after itself, so
		// dropping and re-adding the same one invalidates nothing.
		this.engine.undefineUserUnitsFrom(state.lineId);

		const allResults: Value[][] = [];
		const allBytecodes: BytecodeProgram[] = [];
		const allReads = new Set<string>();
		const allWrites = new Set<string>();
		let hasVariableDef = false;
		let lastValue: Value | null = null;
		let firstError: string | null = null;
		let anyFailed = false;
		/** Set when any expression returned a value still waiting on a resolver. */
		let anyPending = false;

		// Evaluate each expression independently, a failure in one expression
		// (e.g., parse error in s`bad syntax`) must not prevent other expressions
		// on the same line from being evaluated and having their results stored.
		// Without per-expression error handling, same-line cross-reference inline
		// solves (s`:a = 5` s`:b = a + 3` s`a + b`) would lose ALL results when
		// the third expression throws because 'b' references cross a VM state
		// boundary or the engine encounters a transient error.
		// Before this line runs, each name it wrote holds what the lines above
		// left, as it does when a pass from scratch reaches the line. A Tier 1
		// line is dirty, so its recorded writes may be about text that has
		// changed; that is fine either way, since a name the new text no
		// longer writes is one the line no longer defines. See
		// `ExpressionEngine.restoreToPrefix` for what this closes.
		for (const written of state.writes) this.engine.restoreToPrefix(written, lineNumber);

		// Names an earlier expression on this line has already set, so a later
		// one on the same line that fails does not undo it.
		const definedEarlierOnThisLine = new Set<string>();
		// And the names this line writes that its right-hand side reads, for
		// Tier 2; see {@link selfReadingWrites}.
		const selfReading: string[] = [];
		for (const expression of expressions) {
			if (!expression.trim()) continue;

			let value: Value[] | null = null;
			let entry: { bytecode: BytecodeProgram; readVariables: string[]; writeVariable: string | null } | undefined;

			try {
				// evaluateLine returns the single evaluated Value; this evaluator
				// keeps its results grouped as Value[] per expression (allResults
				// is Value[][]), so wrap the one value into its group here.
				const evaluated = this.engine.evaluateLine(lineNumber, expression);
				value = [evaluated];
				lastValue = evaluated;
				// Sync the DocumentModel from the LineCache.
				// Use get(lineNumber, expression) instead of getEntryForLine(lineNumber)
				// because multiple expressions on the same line share the same lineNumber
				// and getEntryForLine always returns the FIRST entry (Map insertion order).
				entry = this.engine.getLineCache().get(lineNumber, expression) as typeof entry;
			} catch (e) {
				const errorMessage = e instanceof Error ? e.message : String(e);
				if (!firstError) firstError = errorMessage;
				anyFailed = true;
				value = null;
			}

			// An unresolved async value does not throw, so `anyFailed` alone would
			// let this line be marked clean while its data has not arrived. Once
			// clean, nothing re-runs the resolver preflight and the value stays
			// pending for good. Treat it as not-yet-complete instead.
			if (value && value.some((v) => v.type === ValueType.Pending)) {
				anyPending = true;
			}

			if (value) {
				allResults.push(value);
			} else {
				// Expression failed, push an ErrorValue sentinel so results[] stays
				// aligned with expressions[] and bytecodes[] indices. Downstream code
				// checking result.type === Error will find it, vs a raw null that NPEs.
				allResults.push([errorValue("eval_failed", firstError ?? "unknown error")]);
			}

			// A throw is a failure as much as an error answer is: either way the
			// store never happened, and the name must be left as the lines above
			// left it, whichever branch below learns what this expression writes.
			const failed = value === null || value.some((v) => v.type === ValueType.Error);
			if (entry) {
				allBytecodes.push(entry.bytecode);
				for (const r of entry.readVariables) allReads.add(r);
				if (entry.writeVariable) {
					allWrites.add(entry.writeVariable);
					hasVariableDef = true;
					if (readsItself(entry.readVariables, entry.writeVariable)) selfReading.push(entry.writeVariable);
					// The write stays declared whatever the answer was: the line is
					// still the one that defines the name, and a running total that
					// dropped its write when its step failed was never re-seeded
					// again, stuck on the error after the line it read was fixed.
					//
					// What a failed definition may not do is keep its own old value.
					// A pass from scratch skips the store, leaving the name as the
					// lines above had it, and this puts it back there. Unless an
					// earlier expression on this same line set it, in which case that
					// is what the lines above left and it is already in place. A
					// pending value is not a failure: it has not arrived yet.
					if (failed && !definedEarlierOnThisLine.has(entry.writeVariable)) {
						this.engine.restoreToPrefix(entry.writeVariable, lineNumber);
					} else if (!failed) {
						definedEarlierOnThisLine.add(entry.writeVariable);
					}
				}
			} else {
				// Fallback: LineCache missed, compile expression ourselves
				try {
					const { program, reads, writes } = this.engine.compileExpression(expression);
					allBytecodes.push(program);
					for (const r of reads) allReads.add(r);
					for (const w of writes) allWrites.add(w);
					if (writes.length > 0) hasVariableDef = true;
					for (const w of writes) if (readsItself(reads, w)) selfReading.push(w);
					// The same restore as the cached branch above; this is the branch
					// a throwing right-hand side takes, since a throw leaves no cache
					// entry behind, and it was the one path that kept its old value.
					for (const w of writes) {
						if (failed && !definedEarlierOnThisLine.has(w)) this.engine.restoreToPrefix(w, lineNumber);
						else if (!failed) definedEarlierOnThisLine.add(w);
					}
				} catch (compileErr) {
					// Push empty bytecode, expression will recompile on next pass.
					// The expression still failed to compile, but reads/writes were
					// already extracted from its tokens before the parse attempt
					// compileExpression() surfaces them via the thrown error's
					// context. Register them anyway so the DAG knows this line
					// depends on those variables and re-evaluates it once they
					// become defined, instead of losing the dependency entirely.
					allBytecodes.push({ opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false });
					if (compileErr instanceof EngineError && compileErr.context) {
						const errReads = compileErr.context.reads;
						const errWrites = compileErr.context.writes;
						if (Array.isArray(errReads)) for (const r of errReads) allReads.add(r);
						if (Array.isArray(errWrites)) {
							for (const w of errWrites) {
								allWrites.add(w);
								// A definition that does not even compile set nothing.
								if (!definedEarlierOnThisLine.has(w)) this.engine.restoreToPrefix(w, lineNumber);
							}
						}
					}
				}
			}
		}

		const reads = [...allReads];
		const writes = [...allWrites];

		// Always store results, even partial ones. If any expression failed
		// the line stays dirty so the failed expression(s) get retried on the
		// next evaluation pass. But successfully-evaluated expressions' results
		// are preserved so the DAG, UI decorations, and downstream consumers
		// can use them immediately.
		if (anyFailed || anyPending) {
			// Store partial results via updateLineCompiled (doesn't clear dirty).
			// The successful expressions' bytecodes are cached so Tier 2 works
			// for them on the next scroll pass.
			this.doc.updateLineCompiled(
				state.lineId,
				expressions,
				allBytecodes,
				reads,
				writes,
				hasVariableDef,
				inlineSolveCount,
			);
			// Also set results for the successful expressions
			state.results = allResults;
			state.result = allResults[0]?.[0] ?? null;
			state.inlineSolveCount = inlineSolveCount;
			state.expressions = expressions;
		} else {
			// All expressions succeeded, store full results and mark clean
			this.doc.updateLineResult(
				state.lineId,
				allResults,
				allBytecodes,
				expressions,
				reads,
				writes,
				hasVariableDef,
				inlineSolveCount,
			);
		}

		if (selfReading.length > 0) this.selfReadingWrites.set(state.lineId, selfReading);
		else this.selfReadingWrites.delete(state.lineId);

		// Register reads/writes in DAG (aggregated across all expressions).
		// Always register, even lines with no reads/writes (pure expressions
		// like "2+2") need DAG entries so downstream queries for line presence work.
		this.registerWithTags(lineNumber, reads, writes);

		// ── Checkpoint after variable definition ──
		// A pending value is not a value worth checkpointing: restoring it would
		// reinstate the unresolved placeholder rather than the eventual result.
		if (this.checkpointer && writes.length > 0 && !anyFailed && !anyPending) {
			this.checkpointer.snapshot(lineNumber, state.lineId, writes);
		} else if (this.checkpointer && writes.length === 0) {
			// A line that defines nothing any more has nothing for the chain to
			// say about it, and what it used to say is what the lines below would
			// otherwise be told the prefix holds.
			this.checkpointer.dropCheckpointAt(lineNumber);
		}

		return {
			...baseResult,
			tier: EvalTier.Tier1,
			result: lastValue,
			results: allResults,
			error: firstError,
		};
	}

	/**
	 * Tier 2: Execute from cached bytecode only.
	 * Skips lexing, parsing, and compiling, runs the pre-compiled bytecode
	 * against the engine's shared VM. Supports multiple bytecodes per line
	 * (inline solves), each is executed left-to-right so variable definitions
	 * in earlier bytecodes update the VM before later ones run.
	 * Assumes the VM already has correct variable state from preceding
	 * Tier-1 evaluations.
	 */
	private evaluateTier2(
		state: LineState,
		lineNumber: number,
		baseResult: Omit<EvalLineResult, "tier" | "result" | "error">
	): EvalLineResult {
		if (state.bytecodes.length === 0) {
			return { ...baseResult, tier: EvalTier.Skipped, result: null, error: null };
		}

		const results: Value[][] = [];
		let lastValue: Value | null = null;
		let firstError: string | null = null;
		let anyFailed = false;

		// Execute each bytecode independently, a failure in one should not
		// prevent other bytecodes on the same line from executing. Same-line
		// inline solves with variable definitions (s`:a = 5` s`a + 3`) rely
		// on earlier bytecodes updating the VM before later ones execute.
		// A clean line's VM state is the prefix, with one exception a pass from
		// scratch never has: a definition that reads the name it writes finds
		// its own previous answer there. `:v3 = v3 + 3` climbed by three a pass
		// once the `:v3 = 44` above it was edited away, where from scratch
		// nothing defines `v3` and the line reports so. The prefix is put back
		// first, per expression, and again after one that fails, since a failed
		// store leaves the name holding this line's old answer too.
		// The line's own record of what it reads and writes, which moves with the
		// line. The line cache is keyed by position and is not renumbered by a
		// structural edit, so a line that moved found no entry there and its
		// self-read went unrestored: `:v3 = v3 + 3` climbed by three a pass once
		// the `:v3 = 44` above it was deleted rather than edited.
		//
		// Genuinely reads it: the graph's convention records every definition as
		// a reader of its own name once, so the name has to appear among the
		// reads a second time, from the right-hand side, before this fires. That
		// keeps the prefix lookup off the ordinary `:x = 5`, which is most
		// definitions and would otherwise pay for it on every pass.
		for (const written of this.selfReadingWrites.get(state.lineId) ?? []) {
			this.engine.restoreToPrefix(written, lineNumber);
		}
		const cache = this.engine.getLineCache();
		const definedEarlierOnThisLine = new Set<string>();
		for (let i = 0; i < state.bytecodes.length; i++) {
			const bytecode = state.bytecodes[i];
			if (bytecode.opcodes.length === 0) continue;
			// Per expression where the cache still has the entry, so a later
			// expression that fails does not undo an earlier one on the same line;
			// the line's whole write set otherwise, which a moved line falls back to.
			const entry = cache.get(lineNumber, state.expressions[i] ?? "") as
				{ readVariables: string[]; writeVariable: string | null } | undefined;
			const writtenHere: readonly string[] = entry !== undefined
				? (entry.writeVariable === null ? [] : [entry.writeVariable])
				: state.writes;
			let failed = false;
			try {
				const value = this.engine.executeCached(bytecode, lineNumber);
				lastValue = value;
				results.push([value]);
				failed = value.type === ValueType.Error;
			} catch (e) {
				const errorMessage = e instanceof Error ? e.message : String(e);
				if (!firstError) firstError = errorMessage;
				anyFailed = true;
				failed = true;
				// Push error sentinel to maintain results[i] ↔ bytecodes[i] alignment
				results.push([errorValue("exec_failed", errorMessage)]);
			}
			for (const written of writtenHere) {
				if (failed && !definedEarlierOnThisLine.has(written)) this.engine.restoreToPrefix(written, lineNumber);
				else if (!failed) definedEarlierOnThisLine.add(written);
			}
		}

		// Update DAG: re-register reads/writes from the cached metadata.
		// Always register, even empty reads/writes so DAG line-presence queries work.
		this.registerWithTags(lineNumber, state.reads, state.writes);

		// A line that ran nothing keeps the result it already had.
		//
		// Some expressions compile to a program with no opcodes: a unit
		// definition (`1 sprint = 2 weeks`) and an equation stored for later
		// (`y + 3 = 10`) both do their work while being compiled, and have
		// nothing left to execute. The loop above skips those programs, so
		// `results` comes back empty, and assigning it unconditionally replaced
		// the answer Tier 1 had computed with nothing. The line showed
		// `sprint defined` on the pass that compiled it and went blank on the
		// next one, with the document untouched, because a live document is
		// evaluated again and again rather than once.
		//
		// Executing nothing produces no new result, which is not the same as
		// producing an empty one.
		if (results.length > 0) {
			state.results = results;
			state.result = results[0][0] ?? null;
		} else if (state.result !== null && isArenaActive()) {
			// Kept by value, not by reference.
			//
			// A pass runs with the Value arena on, and a result that never came
			// back through the VM's HALT is arena-owned: nothing cloned it on
			// the way out, because the program had no opcodes to return from.
			// Holding that object means holding a slot the arena hands to a
			// later line, and the line's own answer is then overwritten in
			// place. `1 sprint = 2 weeks` read `sprint defined` and then, once
			// the line below it had run, read that line's number instead.
			// Every stored result, keeping the line's shape: a line can hold
			// several expressions, and all of them can be definitions.
			state.results = state.results.map((group) => group.map(persistentValue));
			state.result = state.results[0]?.[0] ?? persistentValue(state.result);
		}
		if (anyFailed) {
			// Mark dirty so failed bytecodes are re-compiled (Tier 1) next pass
			this.doc.markDirty(state.lineId);
		}

		// ── Checkpoint after a line that writes ──
		// Tier 1 does this for a line it compiled; a line running from cache
		// writes the same names to the VM and has to record them the same way.
		// Without it the chain has a hole wherever a clean line sits between
		// two dirty ones, and `snapshot`'s re-run truncation would drop
		// entries that nothing ever puts back.
		if (this.checkpointer && state.writes.length > 0 && !anyFailed) {
			this.checkpointer.snapshot(lineNumber, state.lineId, state.writes);
		}

		return {
			...baseResult,
			tier: EvalTier.Tier2,
			// The stored result, for the same reason: a caller reading this pass's
			// answer for the line must see what the line says, not the nothing
			// that running no opcodes returned.
			result: results.length > 0 ? lastValue : state.result,
			results: results.length > 0 ? results : state.results,
			error: firstError,
		};
	}

	/**
	 * Tier 3: Compile-only for invisible lines.
	 * Lex → Parse → Compile to discover reads/writes for the dependency graph.
	 * Executes the bytecode ONLY if the line defines a variable (isVariableDef
	 * or writes.length > 0), because variable assignments affect VM state
	 * that other lines depend on. Pure expression lines are compiled but NOT
	 * executed, saving CPU for large documents.
	 *
	 * Supports multiple expressions per line (inline solves). Each is compiled
	 * separately; variable-def expressions are also executed.
	 */
	private evaluateTier3(
		state: LineState,
		lineNumber: number,
		expressions: string[],
		inlineSolveCount: number,
		baseResult: Omit<EvalLineResult, "tier" | "result" | "error">
	): EvalLineResult {
		const allBytecodes: BytecodeProgram[] = [];
		const allReads = new Set<string>();
		const allWrites = new Set<string>();
		let hasVariableDef = false;
		let lastResult: Value | null = null;
		let firstError: string | null = null;
		let anyFailed = false;
		/** Set when a result is still waiting on a resolver. */
		let anyPending = false;

		// Compile each expression independently, a parse error in one
		// should not prevent other expressions from being compiled and
		// having their reads/writes registered in the DAG.
		for (const expression of expressions) {
			if (!expression.trim()) continue;

			try {
				const { program, reads, writes } = this.engine.compileExpression(expression);
				allBytecodes.push(program);
				for (const r of reads) allReads.add(r);
				for (const w of writes) allWrites.add(w);
				if (writes.length > 0) hasVariableDef = true;

				if (writes.length > 0 && program.opcodes.length > 0) {
					// Variable definitions MUST execute to maintain VM state
					lastResult = this.engine.executeCached(program, lineNumber);
					// Same reasoning as Tier 1: a pending result does not throw,
					// and marking the line clean would strand it unresolved.
					if (lastResult && lastResult.type === ValueType.Pending) {
						anyPending = true;
					}
				}
			} catch (e) {
				const errorMessage = e instanceof Error ? e.message : String(e);
				if (!firstError) firstError = errorMessage;
				anyFailed = true;
				// Push empty bytecode placeholder for alignment
				allBytecodes.push({ opcodes: new Uint8Array(0), numbers: new Float64Array(0), strings: [], hasAsync: false });
			}
		}

		const reads = [...allReads];
		const writes = [...allWrites];

		// Store compile-only state in DocumentModel, even partial results
		// preserve successful expressions' bytecodes and DAG data.
		this.doc.updateLineCompiled(
			state.lineId,
			expressions,
			allBytecodes,
			reads,
			writes,
			hasVariableDef,
			inlineSolveCount,
		);

		// Register reads/writes in DAG regardless, partial data is valid.
		// Always register, even empty reads/writes for DAG line-presence queries.
		this.registerWithTags(lineNumber, reads, writes);

		if (hasVariableDef && lastResult && !anyFailed && !anyPending) {
			state.results = [[lastResult]];
			state.result = lastResult;
			this.doc.markClean(state.lineId);

			// ── Checkpoint after variable definition ────────────
			if (this.checkpointer) {
				this.checkpointer.snapshot(lineNumber, state.lineId, writes);
			}
		}

		return { ...baseResult, tier: EvalTier.Tier3, result: lastResult, results: hasVariableDef && lastResult && !anyFailed && !anyPending ? [[lastResult]] : undefined, error: firstError };
	}

	// ── Public checkpoint API (used by Phase 5.2e setViewport) ──────

	/**
	 * Restore the VM to the state at or just after the given line number.
	 *
	 * Finds the nearest checkpoint at or before `lineNumber` and replays
	 * all variable definitions from the checkpoint chain into the VM.
	 * After calling this, the VM is ready to evaluate lines starting at
	 * `lineNumber + 1` without re-evaluating all preceding lines.
	 *
	 * **Usage:** Phase 5.2e's `setViewport()` calls `restoreTo(viewport.startLine - 1)`
	 * before evaluating only the newly visible lines. This is the key to
	 * O(visible lines) scrolling.
	 *
	 * @param lineNumber The line number to restore to. Variables defined
	 * at lines ≤ this number will be available in the VM.
	 */
	restoreTo(lineNumber: number): void {
		if (this.checkpointer) {
			this.checkpointer.restoreTo(lineNumber);
		}
	}

	/**
	 * Get the VM checkpointer, or null if checkpointing is disabled.
	 */
	getCheckpointer(): VMCheckpointer | null {
		return this.checkpointer;
	}

	/**
	 * Get the PageManager (Phase 5.2g).
	 * Exposed for testing.
	 */
	getPageManager(): PageManager {
		return this.pageManager;
	}

	// ── Phase 5.2g: Directional preloading ──────────────────────────

	/**
	 * Preload the next 1–2 pages in the current scroll direction.
	 *
	 * Called during `setViewport()` (scroll-only path). Collects dirty
	 * uncompiled lines in pages just beyond the viewport and dispatches
	 * them to the background compilation worker so bytecode is ready
	 * before the user scrolls those lines into view.
	 */
	private preloadNextPages(viewport: ViewportRange): void {
		const targets = this.pageManager.getPreloadTargets(viewport, this.doc);
		if (targets.length === 0) return;

		// Lazy-init worker if needed
		if (!this.compilationWorker) {
			this.compilationWorker = new CompilationWorkerManager();
		}

		// Fire-and-forget: worker compiles, stores bytecode on response
		this.compilationWorker.compileBatch(targets).then((results) => {
			this.compilationWorker!.storeResults(results, this.doc);
		}).catch((_err) => {
			// Non-fatal, next evaluate() will compile synchronously
		});
	}

	/**
	 * Collect invisible dirty lines that need background compilation.
	 *
	 * Iterates lines beyond `viewport.endLine`, filtering for:
	 * - Dirty lines (need re-compilation)
	 * - Non-empty, non-markdown lines
	 * - No existing bytecode (skip already-compiled Tier 3 lines)
	 *
	 * Returns CompileRequestItem[] suitable for CompilationWorkerManager.
	 */
	private collectInvisibleCompileTargets(viewport: ViewportRange): CompileRequestItem[] {
		const items: CompileRequestItem[] = [];
		const docEnd = this.doc.lineCount;
		const startPos = viewport.endLine + 1;

		for (let pos = startPos; pos <= docEnd; pos++) {
			const state = this.doc.getLineAt(pos);
			if (!state) continue;

			// Skip clean lines
			if (!state.dirty) continue;

			// Skip already-compiled lines
			if (state.bytecodes.length > 0 && !state.isVariableDef) continue;

			// Skip empty/markdown-only lines
			if (state.isEmpty || isEmptyLine(state.text)) continue;

			const { expressions } = this.extractExpressions(state);
			if (expressions.length === 0) continue;

			// Create one CompileRequestItem per expression (inline solves
			// on the same line share the same lineId + textHash). The worker
			// compiles each independently; storeResults batches by lineId.
			for (const expression of expressions) {
				if (!expression.trim()) continue;
				items.push({
					lineId: state.lineId,
					expression,
					textHash: state.textHash,
				});
			}
		}

		return items;
	}

	/**
	 * Extract all evaluable expressions from a LineState.
	 *
	 * For full-line expressions: returns `{ expressions: [trimmedText], inlineSolveCount: 0 }`.
	 * For inline solve lines: returns `{ expressions: [...allSolves], inlineSolveCount: N }`.
	 * For pre-extracted (cached) expressions: returns the cached array.
	 *
	 * Inline solves are extracted left-to-right via the sharedLexer, so variable
	 * definitions in earlier solves (e.g., `s\`x = 5\` more text s\`x + 1\``)
	 * correctly update the VM state before later solves are evaluated.
	 */
	private extractExpressions(state: LineState): { expressions: string[]; inlineSolveCount: number } {
		// Use pre-extracted expressions if available (from cache / previous evaluation)
		if (state.expressions.length > 0) {
			return { expressions: state.expressions, inlineSolveCount: state.inlineSolveCount };
		}

		const trimmed = state.text.trim();
		if (trimmed.length === 0) return { expressions: [], inlineSolveCount: 0 };

		// Check for inline solve syntax: s`expression`
		const inlineSpans = sharedLexer.findInlineSolves(state.text);
		if (inlineSpans.length > 0) {
			return {
				expressions: inlineSpans.map(s => s.expression),
				inlineSolveCount: inlineSpans.length,
			};
		}

		// Full-line expression
		return { expressions: [trimmed], inlineSolveCount: 0 };
	}
}
