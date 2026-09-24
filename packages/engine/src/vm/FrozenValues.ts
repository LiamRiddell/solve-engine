/**
 * Frozen answers: a line that keeps the answer it had, with its date, instead
 * of following a live figure.
 *
 * `10 USD in GBP frozen` answers with today's rate the first time it is
 * evaluated, and from then on answers with that same amount, without asking a
 * provider again, until the host clears it. `10 USD in GBP frozen on
 * 2026-09-23` states the day it was frozen, so an engine that does not hold a
 * value frozen that day refuses the line by name rather than freezing a new
 * one: a note shared or archived with that text reads either the same amount or
 * an error, never a different amount.
 *
 * **Where the answer lives.** In a {@link FrozenValueStore}, one per engine
 * (see `engine/EngineContext.ts`), keyed by the line's expression without its
 * suffix, as written. The store travels in a snapshot (`toJSON`/`fromJSON`),
 * which is what lets a restored document read the same answer with no network,
 * and a host can read and restore it directly.
 *
 * **Where it is enforced.** In `executeBytecode` (see `vm/VM.ts`): a compiled
 * frozen line carries a {@link FrozenDirective}, and every path that runs a
 * line (a first evaluation, a Tier 2 re-run from cached bytecode, the batcher's
 * re-run when a live value lands, goal seek's probes) runs it through that one
 * function. A stored answer is returned without running the line at all, so no
 * rate is read and no request is made.
 *
 * This module holds only the store and the decision; it has no runtime import
 * of the engine, so `EngineContext` can own a store without a cycle.
 */
import type { Value } from "@solve-js/vm/Value";
import type { CalendarBackend } from "@solve-js/calendar/CalendarBackend";
import { stampFrozen } from "@solve-js/vm/Provenance";

/**
 * What a compiled `frozen` line carries on its program (see
 * `BytecodeProgram.frozen`).
 */
export interface FrozenDirective {
	/** The store key: the expression without its `frozen` suffix, as written, whitespace collapsed. */
	readonly key: string;
	/** The ISO day (`YYYY-MM-DD`) a dated suffix names, `frozen on <day>`; absent for a bare `frozen`. */
	readonly on?: string;
	/** The variable a `:name = ... frozen` line defines, which a stored answer must still set. */
	readonly write?: string;
}

/** One frozen answer, as the store holds it. */
export interface FrozenRecord {
	/** The key it is stored under; see {@link FrozenDirective.key}. */
	readonly key: string;
	/** The answer, carrying its {@link Value.frozen} mark and its sources stamped with the freeze time. */
	readonly value: Value;
	/** When it was frozen, in epoch milliseconds, from the engine's calendar clock. */
	readonly at: number;
	/**
	 * The ISO day it was frozen on, in the calendar of the engine that froze it.
	 * Kept as written rather than recomputed from {@link at}, so a snapshot
	 * restored in another time zone still matches `frozen on <that day>`.
	 */
	readonly day: string;
}

/**
 * What a frozen line does on this evaluation.
 *
 * - `stored`: answer with the stored value; the line is not run.
 * - `missing`: the line names a day, and no value frozen that day is stored,
 *   so it is refused; the line is not run.
 * - `evaluate`: nothing is stored yet and the line may freeze now, so it runs
 *   and its settled answer is recorded.
 */
export type FrozenOutcome =
	| { readonly kind: "stored"; readonly record: FrozenRecord }
	| { readonly kind: "missing"; readonly on: string; readonly storedDay?: string }
	| { readonly kind: "evaluate" };

const EVALUATE: FrozenOutcome = Object.freeze({ kind: "evaluate" });

/** Two digits, zero-padded. */
function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/**
 * The ISO day an instant falls on, in a calendar's own zone.
 *
 * @param calendar - The engine's calendar backend.
 * @param epochMs - The instant.
 * @returns `YYYY-MM-DD`.
 */
export function isoDayOf(calendar: CalendarBackend, epochMs: number): string {
	const f = calendar.fields(epochMs);
	return `${f.year}-${pad2(f.month0 + 1)}-${pad2(f.day)}`;
}

/**
 * The frozen answers one engine holds.
 *
 * A map from key to {@link FrozenRecord}, plus a switch that stops new answers
 * being recorded while the engine evaluates something that is not a line of the
 * document (an explanation's sub-expressions), so that looking at a line never
 * freezes it.
 */
export class FrozenValueStore {
	private readonly records = new Map<string, FrozenRecord>();
	private suspended = 0;

	/** How many answers are stored. */
	get size(): number {
		return this.records.size;
	}

	/** Whether an evaluation may record a new answer now. False inside {@link withoutRecording}. */
	get recording(): boolean {
		return this.suspended === 0;
	}

	/** The stored answer for a key, if there is one. */
	get(key: string): FrozenRecord | undefined {
		return this.records.get(key);
	}

	/** Whether an answer is stored for a key. */
	has(key: string): boolean {
		return this.records.has(key);
	}

	/**
	 * Store a line's settled answer as frozen, and return the value the line
	 * answers with.
	 *
	 * The stored value is a copy of `value`, never `value` itself: the answer a
	 * line settles on can be a cached provider result that other lines share,
	 * and the frozen mark must not appear on those.
	 *
	 * @param key - The line's key; see {@link FrozenDirective.key}.
	 * @param value - The answer the line settled on.
	 * @param at - When it is frozen, in epoch milliseconds.
	 * @param day - The ISO day `at` falls on in the engine's calendar.
	 * @returns The frozen copy, carrying its mark and its stamped sources.
	 */
	record(key: string, value: Value, at: number, day: string): Value {
		const frozen = value.clone();
		frozen.frozen = { at, key };
		frozen.sources = stampFrozen(value.sources, at);
		this.records.set(key, { key, value: frozen, at, day });
		return frozen;
	}

	/**
	 * Put back a record exactly as it was stored, for a snapshot restore or a
	 * host carrying frozen answers of its own.
	 *
	 * @param record - The record, whose value already carries its mark.
	 */
	restore(record: FrozenRecord): void {
		this.records.set(record.key, record);
	}

	/**
	 * Forget one stored answer, so its line freezes afresh the next time it is
	 * evaluated (or, if it names a day, is refused).
	 *
	 * @returns Whether an answer was stored for the key.
	 */
	delete(key: string): boolean {
		return this.records.delete(key);
	}

	/** Forget every stored answer. */
	clear(): void {
		this.records.clear();
	}

	/** Every stored answer, in the order they were frozen. */
	entries(): FrozenRecord[] {
		return Array.from(this.records.values());
	}

	/**
	 * Run `fn` with recording switched off, so a frozen line evaluated inside
	 * it answers from the store when it can and otherwise answers live without
	 * being frozen.
	 *
	 * @returns What `fn` returns.
	 */
	withoutRecording<T>(fn: () => T): T {
		this.suspended++;
		try {
			return fn();
		} finally {
			this.suspended--;
		}
	}

	/**
	 * Decide what a frozen line does on this evaluation. See {@link FrozenOutcome}.
	 *
	 * A bare `frozen` uses whatever is stored, and freezes now when nothing is.
	 * A dated `frozen on <day>` uses only a value frozen that day, and freezes
	 * now only when that day is today; any other day with nothing stored for it
	 * is `missing`, because a value fetched today is not the value it had then.
	 *
	 * @param directive - The line's directive.
	 * @param calendar - The engine's calendar, for today's date.
	 */
	outcome(directive: FrozenDirective, calendar: CalendarBackend): FrozenOutcome {
		const record = this.records.get(directive.key);
		if (directive.on === undefined) {
			return record !== undefined ? { kind: "stored", record } : EVALUATE;
		}
		if (record !== undefined) {
			return record.day === directive.on
				? { kind: "stored", record }
				: { kind: "missing", on: directive.on, storedDay: record.day };
		}
		return directive.on === isoDayOf(calendar, calendar.now()) ? EVALUATE : { kind: "missing", on: directive.on };
	}
}
