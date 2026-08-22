/**
 * Historical currency conversion, `<money> in <currency> on <date>`.
 *
 * Live conversion (`100 USD in GBP`) uses whatever the rate is right now and
 * quietly drifts as the market moves, which is wrong for an expense or an
 * invoice: a note that was right when written stops being right. This module
 * adds the date to that resolution, so `100 USD in GBP on 2024-01-15` reports
 * the rate on the day it names and never changes afterwards.
 *
 * **Bring your own data source**, the same shape as stocks and weather. There
 * is no free, keyless historical-FX endpoint the engine can bake in the way
 * Frankfurter backs the live rate, so the HOST supplies a
 * {@link HistoricalRateProvider} via `createCurrencyPackage({ ... })`.
 * Unconfigured, a historical conversion resolves to a clearly worded
 * `HISTORICAL_RATES_NOT_CONFIGURED` error rather than silently falling back to
 * today's rate (see `packages/stocks/StocksPackage.ts` for the same principle,
 * and `uom/CurrencyExchange.ts`'s getRateSync doc for why a made-up number
 * dressed as a real one is worse than an honest failure).
 *
 * **Why one shared plugin index, read at runtime**: both the general
 * UomLiteralParselet (`100 USD in GBP on <date>`) and the currency
 * InParselet (`$100 in GBP on <date>`) emit the SAME `CALL_PLUGIN` at the
 * module-level {@link HISTORICAL_CURRENCY_FN_IDX}, exactly as Weather's five
 * phrases share one `WEATHER_FN_IDX`. The source currency is read from the
 * amount Value at RUNTIME rather than baked into the opcode stream, because the
 * InParselet's left operand (`$100`, a variable, a subexpression) has no
 * compile-time unit. Preflight fetches the rate ahead of the VM only when it can
 * recover the source currency unambiguously (exactly one distinct currency among
 * the amount's operand strings); a mixed-currency subexpression, where a foreign
 * literal may cancel out, is left to the runtime read of the amount's own unit,
 * so the two never disagree about, or double-fetch, a pair.
 */
import type { QueryClient } from "@tanstack/query-core";
import type { Token } from "@solve-js/lexer";
import type { Parser } from "@solve-js/parser/Parser";
import type { BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { nextInstruction } from "@solve-js/parser/OperandWidth";
import { allocatePluginFunctionIndex } from "@solve-js/vm/VMBuiltins";
import { getActiveQueryClient } from "@solve-js/services/DataQueryService";
import { ValueType, numberValue, uomValue, errorValue, faultedOperand, type Value } from "@solve-js/vm/Value";
import type { IAsyncResolver, AsyncCheckResult } from "@solve-js/resolvers/ResolverRegistry";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { createTimeoutSignal } from "@solve-js/utilities/TimeoutSignal";

/**
 * Resolve one historical exchange rate: the value of 1 unit of `from` in `to`
 * on `isoDate` (`YYYY-MM-DD`). Supplied by the host, backed by whichever
 * provider and key THEY have. Receives an `AbortSignal` that fires on caller
 * cancellation or the fetch timeout, pass it to `fetch()`.
 */
export type HistoricalRateProvider = (
	from: string,
	to: string,
	isoDate: string,
	signal: AbortSignal,
) => Promise<number>;

/**
 * Cache namespace for historical rates, distinct from the live "currency"
 * namespace so a live and a historical rate for the same pair never overwrite
 * each other, and so `ResolverRegistry.unregister("currency-historical")`
 * clears only these entries.
 */
export const HISTORICAL_CURRENCY_NS = "currency-historical";

/**
 * The single `CALL_PLUGIN` index every historical conversion is compiled to.
 * Module level (allocated once), so the general UOM parselets can emit it
 * without importing a per-package instance's index. See this module's doc.
 */
export const HISTORICAL_CURRENCY_FN_IDX = allocatePluginFunctionIndex();

/** Structured error codes this feature produces, co-located per the `errors/ErrorCode.ts` per-package pattern. */
export const HistoricalCurrencyErrorCodes = {
	/** No {@link HistoricalRateProvider} was supplied, so `on <date>` conversions cannot be answered. NOT a fall back to today's rate. */
	NOT_CONFIGURED: "HISTORICAL_RATES_NOT_CONFIGURED",
	/** The host provider threw or timed out for one pair/date. Transient, evicted after a cooldown so a retry can happen. */
	QUERY_FAILED: "HISTORICAL_RATE_QUERY_FAILED",
	/** The VM reached the conversion before preflight cached its rate, a "shouldn't happen" invariant break, not a user error. */
	NOT_PREFLIGHTED: "HISTORICAL_RATE_NOT_PREFLIGHTED",
	/** The amount being converted was not a currency Value (bad bytecode, or a non-currency left operand). */
	INVALID_OPERAND: "HISTORICAL_CURRENCY_INVALID_OPERAND",
} as const;

/**
 * How long a FAILED historical fetch's error result stays cached before the
 * next evaluation retries it. A successful rate is kept forever (see
 * {@link HISTORICAL_RATE_STALE_TIME_MS}), so only failures need a bound, without
 * one a transient provider outage would either retry on every keystroke or
 * stick as "the answer" permanently. Mirrors `resolvers/QueryResolver.ts`.
 */
const FAILURE_COOLDOWN_MS = 30_000;

/**
 * TanStack Query staleTime for a resolved historical rate: `Infinity`, it never
 * goes stale. The rate on a fixed past date is immutable, unlike a live rate
 * that the query cache re-fetches once its short window lapses. This is the
 * whole point of the feature, a cached historical rate is permanently fresh.
 */
export const HISTORICAL_RATE_STALE_TIME_MS = Infinity;

/** Hard timeout for one provider call, an unresponsive source must not block re-evaluation indefinitely. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * The TanStack Query key one historical rate is cached under. Currencies are
 * upper-cased so `usd`/`USD` share one entry, the date is already ISO. Both the
 * resolver (writer) and the plugin function (reader) build the key here, so
 * they cannot drift.
 */
export function historicalRateQueryKey(from: string, to: string, isoDate: string): [string, string] {
	return [HISTORICAL_CURRENCY_NS, `${from.toUpperCase()}:${to.toUpperCase()}:${isoDate}`];
}

/** Two digits, zero-padded, for reassembling an ISO date from a Date's local fields. */
function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/**
 * Consume an `on <date>` suffix for a currency conversion, or leave the parser
 * untouched and return `null`.
 *
 * Returns the ISO date (`YYYY-MM-DD`) only when the target `to` is a currency
 * (and the source `from`, when the caller knows it at compile time, likewise)
 * AND the next two tokens are the word "on" followed by a fused
 * `DATETIME_LITERAL` (which the datetime package produces for `2024-01-15` and
 * `15 Jan 2024` alike). Anything else consumes nothing, so `100 km in miles`,
 * `100 USD in GBP` with no date, and a bare `on` that is not a date all fall
 * straight through to the ordinary live conversion. Reading the fused literal
 * rather than re-deriving the date from its parts reuses the datetime package's
 * own calendar validation and its canonical (European/ISO) orderings.
 *
 * `from` is optional because the `$100 in GBP on <date>` form's left operand
 * has no compile-time unit (it is a value the VM produces). There the target
 * check is enough to commit, and the plugin function verifies the amount really
 * is a currency at runtime.
 */
export function tryConsumeCurrencyOnDate(parser: Parser, to: string, from?: string): string | null {
	if (!sharedCurrencyExchange.isCurrency(to)) return null;
	if (from !== undefined && !sharedCurrencyExchange.isCurrency(from)) return null;

	const onToken = parser.peek();
	if (!onToken || onToken.type !== "IDENT" || onToken.value.toLowerCase() !== "on") return null;

	const dateToken = parser.peekAt(1);
	if (!dateToken || dateToken.type !== "DATETIME_LITERAL") return null;

	parser.consume(); // "on"
	parser.consume(); // the date literal
	const date = new Date(Number(dateToken.value));
	// Built with new Date(year, month - 1, day) (local midnight) by the datetime
	// normalizer, so it reads back the same way in local fields.
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Resolve one historical rate to a cached `Value`, an honest error rather than
 * a rejection so a failed lookup surfaces as `ValueType.Error` the reader can
 * see (the same never-throw shape `resolvers/QueryResolver.ts` uses).
 *
 * With no provider the result is `HISTORICAL_RATES_NOT_CONFIGURED` and stays
 * cached (a missing provider is not transient). A provider that throws or times
 * out yields `HISTORICAL_RATE_QUERY_FAILED` and is evicted after
 * {@link FAILURE_COOLDOWN_MS} so a later keystroke retries it.
 */
async function fetchHistoricalRate(
	provider: HistoricalRateProvider | undefined,
	from: string,
	to: string,
	isoDate: string,
	signal: AbortSignal,
	queryClient: QueryClient,
): Promise<Value> {
	const fromUpper = from.toUpperCase();
	const toUpper = to.toUpperCase();

	if (!provider) {
		return errorValue(
			HistoricalCurrencyErrorCodes.NOT_CONFIGURED,
			`Historical exchange rates are not configured. Supply historicalRateProvider via createCurrencyPackage({ ... }) to convert ${fromUpper} to ${toUpper} on ${isoDate}.`,
		);
	}

	const { signal: fetchSignal, cleanup } = createTimeoutSignal(signal, FETCH_TIMEOUT_MS, "Historical currency rate fetch");
	try {
		const rate = await provider(fromUpper, toUpper, isoDate, fetchSignal);
		return numberValue(rate);
	} catch (error) {
		const failedValue = errorValue(
			HistoricalCurrencyErrorCodes.QUERY_FAILED,
			`Failed to resolve the historical rate for ${fromUpper} to ${toUpper} on ${isoDate}: ${error instanceof Error ? error.message : String(error)}`,
		);
		// Bound the failure's lifetime separately from the (infinite) success
		// staleTime, so a transient outage is retried rather than treated as the
		// permanent answer a real past rate would be.
		const key = historicalRateQueryKey(from, to, isoDate);
		const cooldownTimer = setTimeout(() => {
			if (queryClient.getQueryData(key) === failedValue) {
				queryClient.removeQueries({ queryKey: key, exact: true });
			}
		}, FAILURE_COOLDOWN_MS);
		// unref so a pending eviction timer does not, on its own, keep a Node
		// process alive (browsers need no equivalent). Same reasoning as
		// `resolvers/QueryResolver.ts`.
		(cooldownTimer as unknown as { unref?: () => void }).unref?.();
		return failedValue;
	} finally {
		cleanup();
	}
}

/**
 * Build the plugin function every historical conversion dispatches to at runtime.
 *
 * Args are `[amount, toUnit, isoDate]` (CALL_PLUGIN hands them back in push
 * order). The source currency is the amount's own unit, read here rather than
 * passed as an operand so the `$100 in GBP on <date>` form, whose left operand
 * has no compile-time unit, works through the same path.
 *
 * **Two ways the rate arrives, one reader.** For a literal-source conversion
 * (`100 USD in GBP on <date>`, `$100 in GBP on <date>`) preflight recovers the
 * source currency from the bytecode and caches the rate before the VM runs, so
 * this reads it and applies it synchronously. But a source known only at RUNTIME
 * (a variable or subexpression left operand, `x in GBP on <date>`) carries no
 * currency literal for preflight's scan to find, so preflight could not have
 * fetched anything. On that cache miss this fetches the rate itself and returns
 * the Promise: the VM yields a pending result (see EngineContext's
 * PluginFunctionHandler), the engine awaits it, re-evaluates, and this same
 * reader then reads the freshly cached rate. The fetch shares the resolver's
 * query key and function, so a literal and a variable form of the same
 * conversion never fetch twice.
 *
 * @param provider - the host historical-rate provider, closed over so the
 * runtime fetch can reach it; `undefined` surfaces `NOT_CONFIGURED` through the
 * same fetch, never a fall back to today's rate.
 */
export function createHistoricalCurrencyPluginFunction(
	provider?: HistoricalRateProvider,
): (args: Value[]) => Value | Promise<Value> {
	return (args: Value[]): Value | Promise<Value> => {
		const amount = args[0];
		const toArg = args[1];
		const dateArg = args[2];

		// CALL_PLUGIN already refuses a faulted argument before dispatch; this is
		// the same guard in this function's own terms, in case it is ever called
		// directly (tests, a future call site).
		const fault = faultedOperand(amount);
		if (fault) return fault;

		if (amount.type !== ValueType.Uom || amount.unit === undefined || !sharedCurrencyExchange.isCurrency(amount.unit)) {
			return errorValue(
				HistoricalCurrencyErrorCodes.INVALID_OPERAND,
				`Historical conversion needs an amount in a currency, for example "100 USD in GBP on 2024-01-15".`,
			);
		}

		const from = amount.unit;
		const to = String(toArg.value);
		const isoDate = String(dateArg.value);

		// A currency converts to itself at 1 on any date, no rate lookup needed.
		if (from.toUpperCase() === to.toUpperCase()) {
			return uomValue(amount.toNumber(), to);
		}

		const queryClient = getActiveQueryClient();
		const key = historicalRateQueryKey(from, to, isoDate);
		const cached = queryClient?.getQueryData(key) as Value | undefined;

		if (cached === undefined) {
			// Preflight caches the rate before the VM for a literal-source
			// conversion, but a source currency known only at runtime (a
			// variable/subexpression left operand) leaves no literal for its scan,
			// so nothing was cached. Fetch it here and return the Promise: the VM
			// makes the line pending, the engine awaits and re-evaluates, and the
			// re-run reads the now-cached rate below. Same query key and function
			// as the resolver, so the two never double-fetch.
			if (!queryClient) {
				// No active query client at all (not the engine's normal path):
				// nothing can fetch or cache, so this stays the invariant-break
				// error it was (mirrors QueryResolver's _NOT_PREFLIGHTED).
				return errorValue(
					HistoricalCurrencyErrorCodes.NOT_PREFLIGHTED,
					`No historical rate resolved for ${from.toUpperCase()} to ${to.toUpperCase()} on ${isoDate}.`,
				);
			}
			return queryClient.fetchQuery({
				queryKey: key,
				queryFn: ({ signal }) => fetchHistoricalRate(provider, from, to, isoDate, signal, queryClient),
				staleTime: HISTORICAL_RATE_STALE_TIME_MS,
			});
		}
		// A not-configured or failed fetch resolved to an Error Value: surface it
		// as-is rather than converting against a rate that is not there.
		if (cached.type === ValueType.Error) return cached;

		const rate = cached.value as number;
		// A cross-currency rate is a double, so the result is an ordinary float Uom,
		// the same as the live path (exact-decimal money holds only within one
		// currency, see vm/VMConversion.ts's exactMoneyOp).
		return uomValue(amount.toNumber() * rate, to);
	};
}

/**
 * The provider-less historical plugin function: reads a rate preflight (or a
 * test) has already cached and applies it, and on a miss resolves to
 * `NOT_CONFIGURED` through the shared fetch rather than a made-up rate. Kept as a
 * standalone export for direct callers; the currency package wires a
 * provider-backed instance through {@link createHistoricalCurrencyPluginFunction}
 * so a runtime-only source currency can still fetch.
 */
export const historicalCurrencyPluginFunction = createHistoricalCurrencyPluginFunction();

/**
 * Build the async resolver that fetches historical rates through the host
 * `provider` before the VM runs.
 *
 * Scans compiled bytecode for the historical `CALL_PLUGIN`. `to` and `isoDate`
 * are the last two strings its parselets emit; the strings before them are the
 * amount's operands. It fetches only when those name exactly one distinct
 * currency (an unambiguous source), deferring a mixed-currency subexpression to
 * the runtime plugin, so it never fetches a pair the amount does not resolve to.
 * A same-currency conversion needs no rate and is skipped. A missing provider is
 * discovered by the fetch, not here, so the grammar still recognises `on <date>`
 * and reports the not-configured error plainly.
 */
export function createHistoricalCurrencyResolver(provider?: HistoricalRateProvider): IAsyncResolver {
	return {
		namespace: HISTORICAL_CURRENCY_NS,

		preflight(
			_tokens: Token[],
			bytecode: BytecodeProgram,
			packageId: string,
			signal: AbortSignal,
			queryClient: QueryClient,
		): AsyncCheckResult | null {
			const { opcodes, strings } = bytecode;
			const len = opcodes.length;
			let i = 0;

			// Pool indices of the PUSH_STRINGs seen since the last CALL_PLUGIN, so
			// each historical conversion is read from its own operand strings.
			let stringIdxs: number[] = [];

			while (i < len) {
				const op = opcodes[i] as OpCode;

				if (op === OpCode.PUSH_STRING) {
					stringIdxs.push(opcodes[i + 1]);
				} else if (op === OpCode.CALL_PLUGIN) {
					const fnIdx = opcodes[i + 1];
					const argCount = opcodes[i + 2];
					if (fnIdx === HISTORICAL_CURRENCY_FN_IDX && argCount === 3 && stringIdxs.length >= 3) {
						// The parselet emits `to` then `isoDate` as the last two
						// strings; everything before them is the amount's operands.
						const isoDate = strings[stringIdxs[stringIdxs.length - 1]];
						const to = strings[stringIdxs[stringIdxs.length - 2]];

						// Fetch ahead of the VM only when the source currency is
						// UNAMBIGUOUS: exactly one distinct currency among the operand
						// strings. A single literal amount (`100 USD in GBP on
						// <date>`) leaves exactly one, so its rate is fetched here. A
						// mixed-currency subexpression (`(100 USD * (5 JPY / 5 JPY))
						// in GBP on <date>`, where the JPY cancels) leaves more than
						// one, and the bytecode cannot say which the result carries,
						// so this defers to the runtime plugin, which reads the true
						// source off the computed amount (see
						// createHistoricalCurrencyPluginFunction). That keeps the fast
						// literal path while never fetching a currency the amount does
						// not actually resolve to.
						const sources = new Set<string>();
						for (let k = 0; k < stringIdxs.length - 2; k++) {
							const s = strings[stringIdxs[k]];
							if (sharedCurrencyExchange.isCurrency(s)) sources.add(s.toUpperCase());
						}

						if (sources.size === 1) {
							const from = sources.values().next().value as string;
							// Same currency needs no rate, the plugin function
							// converts it at 1 without ever reading the cache.
							if (from !== to.toUpperCase()) {
								const key = historicalRateQueryKey(from, to, isoDate);
								if (queryClient.getQueryData(key) === undefined) {
									const resolver = queryClient.fetchQuery({
										queryKey: key,
										queryFn: ({ signal: qSignal }) => fetchHistoricalRate(provider, from, to, isoDate, qSignal, queryClient),
										staleTime: HISTORICAL_RATE_STALE_TIME_MS,
									});
									return { queryKey: key.join(":"), resolver, packageId, signal, metadata: { from, to, isoDate } };
								}
							}
						}
					}
					stringIdxs = []; // reset for the next conversion
				}

				// Step over this instruction and its operands via the shared width
				// table, so a wide opcode never desyncs the scan.
				i = nextInstruction(opcodes, i);
			}

			return null;
		},

		destroy(): void {
			// Cache cleared by ResolverRegistry.unregister() via removeQueries({ queryKey: ["currency-historical"] }).
		},
	};
}
