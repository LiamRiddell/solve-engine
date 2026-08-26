/**
 * Proactive background refresh of live async values.
 *
 * The engine's async resolution is pull-based: a value refetches when a line is
 * re-evaluated (a keystroke) and it has gone stale. A note left open, showing a
 * live quote or an FX rate, holds whatever it last resolved. This manager closes
 * that gap for the values currently on screen: it drives a refetch on each
 * value's own cadence and, when the fresh result differs, asks the engine to
 * re-evaluate the affected lines, so the answer updates without the reader
 * touching the document.
 *
 * It is deliberately small, because query-core owns the fetching, dedup and
 * cache. This manager owns only the timers and the liveness bookkeeping:
 *
 * - **Only what is live.** A key stops refreshing the moment no line references
 *   it any more (the reader edited that line away). Each tick checks the DAG
 *   before fetching, so a stale key never reaches the network, and its timer
 *   stops itself.
 * - **Back-pressure.** A tick that finds its own previous fetch still running
 *   skips this round rather than stacking a second request on a slow source.
 * - **Off unless asked.** The engine constructs this only when the host has
 *   enabled background refresh; otherwise no timers exist at all.
 *
 * The fresh value reaches the host through the engine's existing event stream
 * (the {@link enqueue} callback feeds the same batcher the pull path does), so a
 * host that already consumes `getEventStream()` needs no new wiring.
 */
import type { Value } from "@solve-js/vm/Value";
import type { DependencyGraph } from "@solve-js/vm/DependencyGraph";

/** What a resolver hands the manager when a live value wants background refresh. */
export interface BackgroundRefreshRegistration {
	/** The package that owns the value, for the DAG lookup and the re-eval enqueue (`_engine` in practice). */
	packageId: string;
	/** The value's cache key, as the batcher and DAG know it (e.g. `weather:current:london`). */
	queryKey: string;
	/** How often to refetch, in ms. Must be positive; a non-positive value is ignored. */
	intervalMs: number;
	/** Force a fresh fetch and return the new value. Provided by the resolver. */
	refetch: () => Promise<Value>;
}

interface LiveEntry extends BackgroundRefreshRegistration {
	timer: ReturnType<typeof setInterval>;
	/** The last value pushed to the host, so an unchanged refetch does not trigger a needless re-render. */
	lastValue: Value | null;
	/** True while a refetch for this key is in flight, so a slow source does not stack requests. */
	inFlight: boolean;
}

/** Whether a refetched value differs from the last one pushed, enough to be worth a re-render. */
function valuesDiffer(previous: Value | null, next: Value): boolean {
	if (!previous) return true;
	if (previous.type !== next.type) return true;
	// Scalars (a number, a temperature, a price, a description) carry their
	// answer in `value` and, for a unit, `unit`. A structured value (matrix,
	// colour) holds an object in `value`, where a fresh fetch is a new reference
	// and this reports a change, which is the safe direction: re-render rather
	// than risk showing a stale figure.
	if (previous.value !== next.value) return true;
	const prevUnit = (previous as { unit?: unknown }).unit;
	const nextUnit = (next as { unit?: unknown }).unit;
	return prevUnit !== nextUnit;
}

/**
 * Owns the timers and liveness bookkeeping for proactive background refresh; see
 * the module comment above for the full picture. The engine constructs one only
 * when the host has enabled the feature, hands it the dependency graph and a
 * callback that re-evaluates a query's lines, and drives it through
 * {@link register} (start refreshing a value) and {@link clearAll} (stop
 * everything on teardown).
 */
export class BackgroundRefreshManager {
	/** Live entries, keyed by JSON.stringify([packageId, queryKey]), which is unambiguous whatever the query text. */
	private readonly entries = new Map<string, LiveEntry>();

	/**
	 * @param dag - The engine's dependency graph, read to tell whether a key is still on screen.
	 * @param enqueue - Called with `(packageId, queryKey)` when a background refetch produced a
	 *   changed value, to re-evaluate the lines that depend on it. Wired to the engine's batcher.
	 */
	constructor(
		private readonly dag: DependencyGraph,
		private readonly enqueue: (packageId: string, queryKey: string) => void,
	) {}

	/** Number of keys currently being polled. */
	get size(): number {
		return this.entries.size;
	}

	private static idOf(packageId: string, queryKey: string): string {
		return JSON.stringify([packageId, queryKey]);
	}

	/**
	 * Start refreshing a live value on its cadence. Idempotent: a key already
	 * being polled is left as it is (the first registration's cadence stands).
	 */
	register(registration: BackgroundRefreshRegistration): void {
		if (!(registration.intervalMs > 0)) return;
		const id = BackgroundRefreshManager.idOf(registration.packageId, registration.queryKey);
		if (this.entries.has(id)) return;

		const timer = setInterval(() => void this.tick(id), registration.intervalMs);
		// Node keeps its event loop alive for any pending timer; a background
		// refresher must not be the reason a process cannot exit. `unref` is
		// Node-only and browsers need no equivalent.
		(timer as unknown as { unref?: () => void }).unref?.();

		this.entries.set(id, { ...registration, timer, lastValue: null, inFlight: false });
	}

	private async tick(id: string): Promise<void> {
		const entry = this.entries.get(id);
		if (!entry) return;
		// Back-pressure: a previous refetch for this key is still running.
		if (entry.inFlight) return;
		// Liveness: no line references this value any more, so stop, before the
		// network is touched. This is what keeps an open note from leaking timers
		// and requests once the reader has edited a live line away.
		if (this.isDead(entry)) {
			this.stop(id);
			return;
		}

		entry.inFlight = true;
		try {
			const next = await entry.refetch();
			// The engine may have been cleared, or the key edited away, during the
			// fetch; re-read rather than trust the captured entry.
			const still = this.entries.get(id);
			if (!still) return;
			if (next && valuesDiffer(still.lastValue, next)) {
				still.lastValue = next;
				this.enqueue(still.packageId, still.queryKey);
			}
		} catch {
			// A background refetch that throws is swallowed: the resolver's own
			// onError has already cached an honest error value, which the pull path
			// surfaces on the next re-evaluation. A timer callback must never throw.
		} finally {
			const e = this.entries.get(id);
			if (e) e.inFlight = false;
		}
	}

	private isDead(entry: LiveEntry): boolean {
		return this.dag.getAffectedLinesByDataSource(entry.packageId, [entry.queryKey]).size === 0;
	}

	/**
	 * Stop polling every key no longer referenced by any line. Optional: each
	 * tick already drops a dead key, so a key stops within one interval on its
	 * own; calling this after an evaluation pass stops it at once instead.
	 */
	reconcile(): void {
		for (const [id, entry] of this.entries) {
			if (this.isDead(entry)) this.stop(id);
		}
	}

	private stop(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		clearInterval(entry.timer);
		this.entries.delete(id);
	}

	/** Stop every timer and forget every key. The manager is reusable afterwards (the engine survives clear()). */
	clearAll(): void {
		for (const entry of this.entries.values()) clearInterval(entry.timer);
		this.entries.clear();
	}
}
