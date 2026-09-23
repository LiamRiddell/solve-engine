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

	get(name: string): Value | undefined {
		return this.values.get(name);
	}

	has(name: string): boolean {
		return this.values.has(name);
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
		this.notify(name, value);
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
