/**
 * Where a live figure came from, and how that record travels with the answers
 * built from it.
 *
 * An exchange rate, a share price or a temperature is not a constant: it was
 * true at one moment, according to one provider. A {@link ValueSource} records
 * both, and a `Value` carries a list of them in its `sources` sidecar (see
 * `vm/Value.ts`), so a host can show "reference rate, 23 Sep 16:02" beside a
 * converted amount and beside every line computed from it.
 *
 * The record is set where a live figure enters the engine (the exchange rate
 * tables in `uom/CurrencyExchange.ts`, `createQueryResolver`, the historical
 * rate resolver) and is merged, never invented, as arithmetic combines values:
 * `(10 USD in GBP) * 3` carries the rate's source, and a sum of two converted
 * amounts carries both of theirs. A value with no live input carries nothing,
 * which is what `undefined` means here and why the plain-number paths never
 * touch this module.
 *
 * Deliberately a list of facts, not a trust score. The engine does not decide
 * whether a rate is fresh enough; it says where the rate came from and when,
 * and the host decides what to show.
 */

/**
 * How the engine came by a figure.
 *
 * - `live`: fetched from a provider at run time (Frankfurter, CoinGecko,
 *   Open-Meteo, or a host's own fetch).
 * - `primed`: handed to the engine by the host, for instance a rate table set
 *   with `currencyExchangeService.primeRates`.
 * - `historical`: a figure for a named past day (`100 USD in GBP on
 *   2024-01-15`), which does not change once fetched.
 */
export type SourceKind = "live" | "primed" | "historical";

/**
 * One provenance record: who supplied a figure, how, and when.
 *
 * Every field is a plain string or number, so a record crosses the worker
 * boundary and a JSON snapshot unchanged.
 */
export interface ValueSource {
	/** Who supplied the figure: `"Frankfurter"`, `"CoinGecko"`, `"Open-Meteo"`, or the name a host gave its own provider. */
	readonly provider: string;
	/** How the engine came by it. See {@link SourceKind}. */
	readonly kind: SourceKind;
	/** When the engine received it, in epoch milliseconds. For a primed table, when the host says the table was published. */
	readonly fetchedAt: number;
	/** What was asked for, when the provider answers more than one question: `"USD/GBP"`, `"AAPL"`, `"current:London"`. */
	readonly subject?: string;
	/** For a historical figure, the ISO day (`YYYY-MM-DD`) it describes. */
	readonly asOf?: string;
	/** Set once the figure is part of a frozen answer: when that answer was frozen, in epoch milliseconds. */
	readonly frozenAt?: number;
}

/**
 * The mark a frozen answer carries: when it was frozen, and the key the engine
 * stored it under.
 *
 * Present on the value a `frozen` line answers with (see
 * `engine/FrozenValues.ts`). Arithmetic does not copy it: `line 1 * 3` is a new
 * value, and it says so by carrying line 1's sources, each stamped with
 * {@link ValueSource.frozenAt}, rather than claiming to be frozen itself.
 */
export interface FrozenMark {
	/** When the answer was frozen, in epoch milliseconds, read from the engine's calendar clock. */
	readonly at: number;
	/** The key the answer is stored under: the line's expression without its `frozen` suffix, as written. */
	readonly key: string;
}

/** Whether two records describe the same figure. Identity first, since most merges meet the same array twice. */
function sameSource(a: ValueSource, b: ValueSource): boolean {
	return a === b || (
		a.fetchedAt === b.fetchedAt &&
		a.provider === b.provider &&
		a.kind === b.kind &&
		a.subject === b.subject &&
		a.asOf === b.asOf &&
		a.frozenAt === b.frozenAt
	);
}

/**
 * The sources of a value computed from two others: every record either carries,
 * each once, the left operand's first.
 *
 * Returns one of its arguments unchanged whenever it can (either side empty,
 * or both the same list, or the right adding nothing new), so the common case
 * of a sourced value meeting a plain number allocates nothing.
 *
 * @param a - The left operand's sources, if any.
 * @param b - The right operand's sources, if any.
 * @returns The merged list, or `undefined` when neither side has a source.
 */
export function combineSources(
	a: readonly ValueSource[] | undefined,
	b: readonly ValueSource[] | undefined,
): readonly ValueSource[] | undefined {
	if (a === undefined) return b;
	if (b === undefined || a === b) return a;
	let merged: ValueSource[] | undefined;
	for (const source of b) {
		const pool: readonly ValueSource[] = merged ?? a;
		let seen = false;
		for (const existing of pool) {
			if (sameSource(existing, source)) { seen = true; break; }
		}
		if (seen) continue;
		if (merged === undefined) merged = a.slice();
		merged.push(source);
	}
	return merged ?? a;
}

/**
 * The merged sources of a list of values, for an operation that reads several
 * at once (a builtin's arguments, an aggregate over lines).
 *
 * @param values - The operands, in order.
 * @returns Every record any of them carries, each once, or `undefined` when none carries one.
 */
export function sourcesOfValues(values: readonly { readonly sources?: readonly ValueSource[] }[]): readonly ValueSource[] | undefined {
	let out: readonly ValueSource[] | undefined;
	for (let i = 0; i < values.length; i++) {
		const s = values[i].sources;
		if (s !== undefined) out = combineSources(out, s);
	}
	return out;
}

/**
 * Give a value its sources, when there are any.
 *
 * For a value the caller has just built (an aggregate's total, a converted
 * amount): it is set in place, so it must never be handed a value someone else
 * holds, such as an operand or a cached result.
 *
 * @param value - A freshly built value.
 * @param sources - The records it should carry, or `undefined` for none.
 * @returns The same value, for use in a return expression.
 */
export function withSources<T extends { sources?: readonly ValueSource[] }>(value: T, sources: readonly ValueSource[] | undefined): T {
	if (sources !== undefined) value.sources = sources;
	return value;
}

/**
 * The same records, each stamped with the moment its answer was frozen.
 *
 * A record that was already part of an earlier freeze keeps its first stamp:
 * freezing a line built from a frozen line does not move the date the rate was
 * fixed on.
 *
 * @param sources - The frozen answer's sources.
 * @param at - When the answer was frozen, in epoch milliseconds.
 * @returns A new list, or `undefined` for a value with no source.
 */
export function stampFrozen(sources: readonly ValueSource[] | undefined, at: number): readonly ValueSource[] | undefined {
	if (sources === undefined) return undefined;
	return sources.map((s) => (s.frozenAt !== undefined ? s : { ...s, frozenAt: at }));
}
