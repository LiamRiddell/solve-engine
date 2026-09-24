import { Value } from "@solve-js/vm/Value";

/**
 * Process-wide store for `global :name` variables, distinct from, and
 * unrelated to, the per-document `Map<string, Value>` each VM instance owns
 * for ordinary `:x` variables (see VM.ts's `createVM()`). Every document's
 * VM stays fully isolated for local variables; this is the one deliberate
 * exception, shared across every ExpressionEngine in the same JS realm.
 *
 * Distinct from the package-contributed async data sources (currency rates,
 * OSRS prices) reached through the ResolverRegistry: this store backs a
 * completely separate opcode pair (LOAD_GLOBAL_VAR/
 * STORE_GLOBAL_VAR) and is the synchronous fast-path cache underneath
 * GlobalVariableAsyncResolver, which handles the "not yet declared by any
 * loaded document" case via the engine's existing async-resolution pipeline
 * (see that file's doc comment for the full picture).
 */
export class GlobalVariableStore {
	private values = new Map<string, Value>();
	private listeners = new Set<GlobalVariableListener>();

	/**
	 * Guards against runaway cross-document write cycles: doc A's write
	 * notifies doc B, whose dirty line, once evaluated, writes a global
	 * that notifies doc C, ... eventually back to A. Same philosophy as the
	 * VM's own instruction-limit safety net: stop propagating past the
	 * limit rather than let a genuine cycle recurse unboundedly. The store
	 * itself is left in a well-defined state either way. This only bounds
	 * *notification* depth, never the value actually stored.
	 */
	private static readonly MAX_NOTIFY_DEPTH = 64;
	private notifyDepth = 0;

	/**
	 * Notifications staged during an evaluation pass, in the order the writes
	 * happened, flushed together once the pass leaves the value arena. `null`
	 * outside a pass, when a write notifies immediately.
	 *
	 * The written value still lands in {@link values} eagerly, so a later line
	 * in the same pass reads what an earlier one wrote; only the *notification*
	 * waits. Deferring it moves the listener callbacks (a document's dirty
	 * marking, an async read's first-write promise) out of the arena window,
	 * which is where the buffered atomic commit in
	 * `docs-internal/plans/CROSS_SCOPE_CELLS.md` needs them: a listener may then
	 * legitimately drive another pass, which a callback firing mid-dispatch,
	 * from inside `enableValueArena()`, cannot. Replayed in write order so the
	 * sequence a listener sees, and so which write first resolves a pending
	 * read, is exactly what it was when the notification fired inline.
	 */
	private pendingNotifications: { name: string; value: Value }[] | null = null;

	/**
	 * How many nested passes are open. A pass brackets its writes with
	 * {@link beginPass}/{@link endPass}; the depth lets the two arena windows a
	 * single evaluation opens (the from-line-1 pass and the viewport pass) share
	 * one staging batch and flush it once, at the outermost close.
	 */
	private passDepth = 0;

	/**
	 * Open a pass: from here until the matching {@link endPass}, a write stages
	 * its notification rather than firing it. Called as the evaluator enters its
	 * value-arena window. Nesting is counted, so an inner window does not flush
	 * the outer window's batch early.
	 */
	beginPass(): void {
		if (this.passDepth === 0) this.pendingNotifications = [];
		this.passDepth += 1;
	}

	/**
	 * Close a pass and, at the outermost close, replay every staged notification
	 * in write order. Called from the evaluator's `finally`, AFTER the arena is
	 * disabled, so the listeners run outside it and on the exception path too.
	 * Balanced against {@link beginPass}; a stray close with no pass open is a
	 * no-op rather than a fault.
	 */
	endPass(): void {
		if (this.passDepth === 0) return;
		this.passDepth -= 1;
		if (this.passDepth > 0) return;
		const pending = this.pendingNotifications;
		this.pendingNotifications = null;
		if (pending) {
			for (const entry of pending) this.notify(entry.name, entry.value);
		}
	}

	/**
	 * Writes made while a scratch run is open, or `null` outside one. See
	 * {@link beginScratch}.
	 */
	private scratchValues: Map<string, Value> | null = null;

	/** How many scratch runs are open, so a nested one does not end the outer. */
	private scratchDepth = 0;

	/**
	 * Open a scratch run: from here until the matching {@link endScratch}, a
	 * write lands in a map of its own, is read back by {@link get} and
	 * {@link has}, and notifies nobody. Closing the outermost run discards it.
	 *
	 * For `ExpressionEngine.explainLine`, which runs a line to derive its answer
	 * and must leave everything as it found it (#566). Explaining `global :rate
	 * = 0.3` would otherwise change the rate in every open document, and tell
	 * each of them to re-evaluate. The store is process-wide, so this is safe
	 * only because a scratch run is synchronous: nothing else runs while one is
	 * open.
	 */
	beginScratch(): void {
		if (this.scratchDepth === 0) this.scratchValues = new Map();
		this.scratchDepth += 1;
	}

	/** Close a scratch run and, at the outermost close, discard its writes. See {@link beginScratch}. */
	endScratch(): void {
		if (this.scratchDepth === 0) return;
		this.scratchDepth -= 1;
		if (this.scratchDepth === 0) this.scratchValues = null;
	}

	get(name: string): Value | undefined {
		const scratch = this.scratchValues;
		if (scratch !== null && scratch.has(name)) return scratch.get(name);
		return this.values.get(name);
	}

	has(name: string): boolean {
		return this.scratchValues?.has(name) === true || this.values.has(name);
	}

	/**
	 * Last-write-wins: any document may call this for any name at any time.
	 * Notifies listeners synchronously, within the same call, before
	 * returning, so that ThreeTierEvaluator's dirty-marking (a listener)
	 * and GlobalVariableAsyncResolver's first-write promise (also a
	 * listener) both observe the new value immediately, no microtask delay.
	 *
	 * A write that does not CHANGE the stored value notifies nobody. This
	 * is not just an optimisation, it is what stops a re-evaluation cycle
	 * from sustaining itself. Every listener re-runs work in response to a
	 * write (ThreeTierEvaluator marks dependent lines dirty; the playground
	 * worker refreshes other documents), and those re-runs re-execute the
	 * very STORE_GLOBAL_VAR opcode that produced this write. Re-evaluating
	 * an unchanged `global :x = 5` line therefore used to re-notify, which
	 * re-triggered the listeners, which re-evaluated... bounded only by
	 * MAX_NOTIFY_DEPTH below, and only in DEPTH, so with more than one
	 * writer the work per keystroke grew exponentially. Nothing observable
	 * changed, so there is nothing for a listener to react to.
	 */
	set(name: string, value: Value): void {
		if (this.scratchValues !== null) {
			// A scratch write is read back and then discarded, so nobody is told.
			this.scratchValues.set(name, value);
			return;
		}
		const previous = this.values.get(name);
		if (previous !== undefined && sameValue(previous, value)) {
			// Nothing observable changed, so nobody is told. The newer object
			// still replaces the older one: they are interchangeable by
			// definition here, and keeping the most recent one avoids holding a
			// reference to a Value from an older pass.
			this.values.set(name, value);
			return;
		}

		// The depth bound is checked BEFORE the write, not inside notify()
		// afterwards. It used to guard only the notification, so at the limit
		// the value was stored and then no listener was called: the store held
		// a number that every reader of it was, permanently, never told about.
		// That is the one state this class cannot be allowed to reach, because
		// nothing later re-reads a cell it was not notified of. Refusing the
		// write instead keeps the store and its readers agreeing on the same
		// value, which is the invariant callers actually depend on.
		//
		// This bounds a host listener that writes back on notification. It is
		// not, and was never, a cross-document cycle detector: both engine-side
		// listeners are non-reentrant, so engine code cannot reach a depth
		// above 1. See docs-internal/plans/CROSS_SCOPE_CELLS.md, Release E.
		if (this.notifyDepth >= GlobalVariableStore.MAX_NOTIFY_DEPTH) return;

		this.values.set(name, value);
		// The value is written now; the notification is what waits. Inside a
		// pass it is staged and replayed when the pass leaves the arena (see
		// {@link pendingNotifications}); outside one, a single-expression run or
		// the async re-execution of one line, it fires immediately, as before.
		if (this.pendingNotifications !== null) {
			this.pendingNotifications.push({ name, value });
		} else {
			this.notify(name, value);
		}
	}

	private notify(name: string, value: Value): void {
		this.notifyDepth++;
		try {
			for (const listener of this.listeners) listener(name, value);
		} finally {
			this.notifyDepth--;
		}
	}

	/**
	 * Subscribe to every global-variable write (all names, callers filter
	 * for the name(s) they care about). Returns an unsubscribe function;
	 * callers MUST invoke it when disposing (e.g. ThreeTierEvaluator's
	 * terminateWorker()) to avoid leaking listeners for closed documents.
	 */
	subscribe(listener: GlobalVariableListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Full reset, test-only. Never called from production code paths;
	 * globals must outlive any single engine's own clear()/dispose cycle.
	 * Tests MUST call this in beforeEach/afterEach since this is a
	 * module-level singleton whose state and listeners otherwise leak
	 * across test cases and files.
	 */
	clear(): void {
		this.values.clear();
		this.listeners.clear();
		this.notifyDepth = 0;
		this.pendingNotifications = null;
		this.passDepth = 0;
		this.scratchValues = null;
		this.scratchDepth = 0;
	}
}

/**
 * Structural equality for two stored globals, used by `set()` to decide
 * whether a write is worth notifying about. Deliberately NOT identity:
 * VM.ts stores `persistentValue(val)`, a fresh object, on every
 * STORE_GLOBAL_VAR while the arena is active, so two writes of the same
 * literal are never the same object.
 *
 * `Object.is` rather than `===` so a global holding NaN compares equal to
 * itself; otherwise `global :x = 0/0` would re-notify on every
 * re-evaluation, which is exactly the cycle `set()` is trying to break.
 */
function sameValue(a: Value, b: Value): boolean {
	if (a.type !== b.type) return false;
	if (a.unit !== b.unit) return false;
	if ((a.timedOut ?? false) !== (b.timedOut ?? false)) return false;

	// Every sidecar changes what a reader SEES while `value` stays identical,
	// so none of them may be skipped here. `1.5` and `1.5 to 2 dp` are the same
	// double and display as "1.5" and "1.50"; `30` and `30 ± 2` are the same
	// double and display as "= 30" and "= 30 ± 2.0"; a datetime's grain, zone
	// and span decide whether an instant reads as a day, a wall clock or a
	// duration. Comparing only `value` reported those pairs equal and
	// suppressed the notification, which left every reader of the cell
	// displaying the old rendering with no event that would ever correct it.
	// A missed notification is the one direction this function must never err
	// in: an unnecessary one costs a re-evaluation that reaches the same
	// answer, a missing one is permanent.
	if (a.decimalPlaces !== b.decimalPlaces) return false;
	if (a.uncertainty !== b.uncertainty) return false;
	if (a.grain !== b.grain) return false;
	if (a.zone !== b.zone) return false;
	if ((a.datetimeSpan ?? false) !== (b.datetimeSpan ?? false)) return false;
	if (!structurallyEqual(a.exact, b.exact, { left: MAX_COMPARED_NODES })) return false;
	if (!structurallyEqual(a.rational, b.rational, { left: MAX_COMPARED_NODES })) return false;

	return structurallyEqual(a.value, b.value, { left: MAX_COMPARED_NODES });
}

/**
 * How much of a payload is walked before the comparison gives up and reports
 * "not equal". A matrix, a range or a colour is far below this; a pathological
 * symbolic tree is not, and walking one on every write of every cell is the
 * cost this bound exists to refuse.
 *
 * Giving up is safe in one direction only, which is why it reports not-equal:
 * see the note in {@link sameValue}.
 */
const MAX_COMPARED_NODES = 1024;

/**
 * Structural comparison of two stored payloads, bounded.
 *
 * This used to be an `Array.isArray` check on the payload itself, which could
 * never fire: `Value.value`'s union has no array member. The arrays are one
 * level further in, as a matrix's `data` field, so the check was looking at
 * the wrong level and every object-valued cell fell through to `Object.is` on
 * two freshly-built objects. That is never true, so a matrix, range, colour,
 * split, chart, address or symbolic cell re-notified on every evaluation pass
 * for ever, each one dirtying the whole downstream closure of every reader.
 */
function structurallyEqual(a: unknown, b: unknown, budget: { left: number }): boolean {
	// Covers every primitive payload, and NaN compares equal to itself here so
	// `global :x = 0/0` does not re-notify on every pass.
	if (Object.is(a, b)) return true;
	if (budget.left-- <= 0) return false;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!structurallyEqual(a[i], b[i], budget)) return false;
		}
		return true;
	}

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
		if (!structurallyEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], budget)) return false;
	}
	return true;
}

/** Called when a cross-document global changes, so dependents can re-evaluate. */
export type GlobalVariableListener = (name: string, value: Value) => void;

/** Process-wide singleton, shared across every engine in the same JS realm. */
export const sharedGlobalVariableStore = new GlobalVariableStore();

/**
 * DAG bookkeeping key for a `global :name` reference, distinct from the
 * plain `name` key used for a local `:name`, so a single document that
 * reads/writes BOTH a local `:hello` and `global :hello` never collides
 * them in that document's own DependencyGraph reads/writes tracking. This
 * prefix exists ONLY at the DAG-bookkeeping layer (ExpressionEngineSafety's
 * extractReadsAndWrites, and ThreeTierEvaluator's dirty-marking subscriber)
 *, the VM-level storage key in this store, and the LOAD_GLOBAL_VAR/
 * STORE_GLOBAL_VAR bytecode operand, both stay unprefixed.
 */
export function globalDagKey(name: string): string {
	return `global:${name}`;
}
