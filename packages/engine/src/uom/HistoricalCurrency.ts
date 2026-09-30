/**
 * Historical currency conversion, `<money> in <currency> on <date>`.
 *
 * Live conversion (`100 USD in GBP`) uses whatever the rate is right now and
 * quietly drifts as the market moves, which is wrong for an expense or an
 * invoice: a note that was right when written stops being right. This module
 * adds the date to that resolution, so `100 USD in GBP on 2024-01-15` reports
 * the rate on the day it names and never changes afterwards.
 *
 * **Where the rate comes from.** The default currency package answers from
 * Frankfurter, the same keyless endpoint that backs the live rate, asked for a
 * date (see `uom/FrankfurterHistoricalRates.ts`, which also holds its
 * refusals: a day before the ECB reference rates began, a day in the future, a
 * currency the ECB does not quote). A host supplies its own
 * {@link HistoricalRateProvider} via `createCurrencyPackage({ ... })` to use
 * another source, which then takes precedence. A host that passes `null`
 * switches the dated form off, and a conversion then resolves to a clearly
 * worded `HISTORICAL_RATES_NOT_CONFIGURED` error rather than silently falling
 * back to today's rate (see `uom/CurrencyExchange.ts`'s getRateSync doc for why
 * a made-up number dressed as a real one is worse than an honest failure).
 *
 * **Why one shared plugin function, read at runtime**: both the general
 * UomLiteralParselet (`100 USD in GBP on <date>`) and the currency
 * InParselet (`$100 in GBP on <date>`) emit the SAME `CALL_PLUGIN` by the
 * module-level name {@link HISTORICAL_CURRENCY_FN}, the same way Weather's five
 * phrases share one plugin function. The source currency is read from the
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
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { getActiveQueryClient } from "@solve-js/services/DataQueryService";
import { ValueType, numberValue, uomValue, errorValue, faultedOperand, type Value } from "@solve-js/vm/Value";
import { combineSources, withSources } from "@solve-js/vm/Provenance";
import type { IAsyncResolver, AsyncCheckResult } from "@solve-js/resolvers/ResolverRegistry";
import { sharedCurrencyExchange } from "@solve-js/uom/CurrencyExchange";
import { createTimeoutSignal } from "@solve-js/utilities/TimeoutSignal";
import { EngineError, ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { LineExecutionContext } from "@solve-js/vm/VM";

/**
 * A historical rate together with the day it was published for, when that is
 * not the day asked about (a weekend or a holiday answered with the last rate
 * before it). The conversion's provenance records `asOf` as the rate's day.
 */
export interface HistoricalRate {
	/** The value of 1 unit of the source currency in the target currency. A finite, positive number. */
	readonly rate: number;
	/** The ISO day (`YYYY-MM-DD`) the rate was published for. The day asked about when omitted. */
	readonly asOf?: string;
}

/**
 * Resolve one historical exchange rate: the value of 1 unit of `from` in `to`
 * on `isoDate` (`YYYY-MM-DD`), as a number or a {@link HistoricalRate}. The
 * default currency package uses Frankfurter's; a host supplies its own to use
 * another source. Receives an `AbortSignal` that fires on caller cancellation
 * or the fetch timeout, pass it to `fetch()`. A result that is not a finite,
 * positive number is refused as a failed query rather than converted through.
 */
export type HistoricalRateProvider = (
	from: string,
	to: string,
	isoDate: string,
	signal: AbortSignal,
) => Promise<number | HistoricalRate>;

/**
 * Cache namespace for historical rates, distinct from the live "currency"
 * namespace so a live and a historical rate for the same pair never overwrite
 * each other, and so `ResolverRegistry.unregister("currency-historical")`
 * clears only these entries.
 */
export const HISTORICAL_CURRENCY_NS = "currency-historical";

/**
 * The package-local name every historical conversion is compiled to. Both the
 * general UOM parselet and the currency InParselet emit a `CALL_PLUGIN` to it by
 * this name (`builder.emitPluginCall(HISTORICAL_CURRENCY_FN, 3)`); the engine
 * assigns the numeric index at registration. Module level, so the general UOM
 * parselets can emit it without importing a per-package instance. See this
 * module's doc.
 */
export const HISTORICAL_CURRENCY_FN = "historicalCurrency";

/**
 * The qualified name the engine files this function's index under. It is
 * registered by the currency package (`name: "solve-currency"`, see
 * CurrencyPackage.ts), so the bytecode-scanning resolver below recovers the
 * runtime index by this name via {@link pluginFunctionIndexFor} rather than
 * owning a hand-allocated one.
 */
const HISTORICAL_CURRENCY_QUALIFIED = `solve-currency:${HISTORICAL_CURRENCY_FN}`;

/** Structured error codes this feature produces, co-located per the `errors/ErrorCode.ts` per-package pattern. */
export const HistoricalCurrencyErrorCodes = {
	/** The host switched historical rates off (`historicalRateProvider: null`), so `on <date>` conversions cannot be answered. NOT a fall back to today's rate. */
	NOT_CONFIGURED: "HISTORICAL_RATES_NOT_CONFIGURED",
	/** The provider threw, timed out, or answered with something that is not a rate, for one pair/date. Transient, evicted after a cooldown so a retry can happen. */
	QUERY_FAILED: "HISTORICAL_RATE_QUERY_FAILED",
	/** A dated conversion for a day the built-in Frankfurter rates do not cover: before 4 January 1999 (the ECB reference rates' first day) or after today. */
	DATE_OUT_OF_RANGE: "HISTORICAL_RATE_DATE_OUT_OF_RANGE",
	/** A dated conversion for a currency the built-in Frankfurter rates do not quote: a cryptocurrency, or a code the ECB publishes no rate for. */
	UNSUPPORTED_CURRENCY: "HISTORICAL_RATE_UNSUPPORTED_CURRENCY",
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

/**
 * The codes a provider may throw that reach the reader as they are, because
 * they are a refusal with its own reason rather than a failed query. Any other
 * throw becomes {@link HistoricalCurrencyErrorCodes.QUERY_FAILED}.
 */
const REFUSAL_CODES: ReadonlySet<string> = new Set([
	HistoricalCurrencyErrorCodes.DATE_OUT_OF_RANGE,
	HistoricalCurrencyErrorCodes.UNSUPPORTED_CURRENCY,
]);

/**
 * Read a provider's answer as a rate and the day it describes, or `null` for
 * an answer that is not a finite, positive number (NaN, zero, a negative, a
 * string, an object without a rate). Exported for its own tests.
 */
export function normaliseHistoricalRate(answer: unknown, isoDate: string): { rate: number; asOf: string } | null {
	const isRate = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
	if (isRate(answer)) return { rate: answer, asOf: isoDate };
	if (typeof answer !== "object" || answer === null) return null;
	const { rate, asOf } = answer as { rate?: unknown; asOf?: unknown };
	if (!isRate(rate)) return null;
	return { rate, asOf: typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : isoDate };
}

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
	// Built at local midnight by the datetime normaliser through the engine's
	// own calendar backend, which the parser carries, so it reads back as the
	// same local day through that backend.
	const date = parser.getCalendar().fields(Number(dateToken.value));
	return `${date.year}-${pad2(date.month0 + 1)}-${pad2(date.day)}`;
}

/**
 * Resolve one historical rate to a cached `Value`, an honest error rather than
 * a rejection so a failed lookup surfaces as `ValueType.Error` the reader can
 * see (the same never-throw shape `resolvers/QueryResolver.ts` uses).
 *
 * With no provider the result is `HISTORICAL_RATES_NOT_CONFIGURED` and stays
 * cached (a missing provider is not transient). A provider that throws, times
 * out or answers with something that is not a rate yields
 * `HISTORICAL_RATE_QUERY_FAILED`, and one that throws a refusal in
 * {@link REFUSAL_CODES} yields that refusal; either is evicted after
 * {@link FAILURE_COOLDOWN_MS} so a later keystroke retries it.
 */
async function fetchHistoricalRate(
	provider: HistoricalRateProvider | undefined,
	providerName: string,
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
		const answer = normaliseHistoricalRate(await provider(fromUpper, toUpper, isoDate, fetchSignal), isoDate);
		if (answer === null) {
			throw ErrorFactory.external(HistoricalCurrencyErrorCodes.QUERY_FAILED, "the provider answered with a rate that is not a positive number");
		}
		// The rate for a named day, so a conversion through it can say whose
		// rate it was, which day it describes, and when it was fetched.
		const value = numberValue(answer.rate);
		value.sources = [{ provider: providerName, kind: "historical", fetchedAt: Date.now(), subject: `${fromUpper}/${toUpper}`, asOf: answer.asOf }];
		return value;
	} catch (error) {
		// A refusal with its own reason reaches the reader as it is; anything
		// else is a failed query, named with the pair and the day.
		const failedValue = error instanceof EngineError && REFUSAL_CODES.has(error.code)
			? errorValue(error.code, error.message)
			: errorValue(
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
 * With live data switched off (`context.networkEnabled` false) a cache miss
 * answers `NETWORK_DISABLED` without calling the provider; a rate already
 * cached is still read.
 *
 * @param provider - the historical-rate provider, closed over so the runtime
 * fetch can reach it; `undefined` surfaces `NOT_CONFIGURED` through the same
 * fetch, never a fall back to today's rate.
 */
export function createHistoricalCurrencyPluginFunction(
	provider?: HistoricalRateProvider,
	providerName = "host",
): (args: Value[], context?: LineExecutionContext) => Value | Promise<Value> {
	return (args: Value[], context?: LineExecutionContext): Value | Promise<Value> => {
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

		// The running engine's own cache, from the line's context (#710).
		const queryClient = context?.queryClient ?? getActiveQueryClient();
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
			// With live data switched off preflight never ran, and this fetch
			// must not start either: the VM would refuse the promise, but only
			// after the request had left.
			if (context?.networkEnabled === false) {
				return errorValue(
					"NETWORK_DISABLED",
					`No historical rate for ${from.toUpperCase()} to ${to.toUpperCase()} on ${isoDate}: live data is switched off for this engine (network.enabled is false)`,
				);
			}
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
				queryFn: ({ signal }) => fetchHistoricalRate(provider, providerName, from, to, isoDate, signal, queryClient),
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
		return withSources(uomValue(amount.toNumber() * rate, to), combineSources(amount.sources, cached.sources));
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
export function createHistoricalCurrencyResolver(provider?: HistoricalRateProvider, providerName = "host"): IAsyncResolver {
	return {
		namespace: HISTORICAL_CURRENCY_NS,

		// The scan below keys on the plugin call that carries the date, so a
		// program without one is never this resolver's and the engine need not
		// ask. See IAsyncResolver.watchedOpcodes.
		watchedOpcodes: [OpCode.CALL_PLUGIN, OpCode.CALL_PLUGIN_WIDE],

		preflight(
			_tokens: Token[],
			bytecode: BytecodeProgram,
			packageId: string,
			signal: AbortSignal,
			queryClient: QueryClient,
		): AsyncCheckResult | null {
			const { opcodes, strings } = bytecode;
			const len = opcodes.length;
			// The engine assigns this function's CALL_PLUGIN index at registration;
			// recover it by the same qualified name to scan the compiled bytecode.
			const historicalFnIdx = pluginFunctionIndexFor(HISTORICAL_CURRENCY_QUALIFIED);
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
					if (fnIdx === historicalFnIdx && argCount === 3 && stringIdxs.length >= 3) {
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
										queryFn: ({ signal: qSignal }) => fetchHistoricalRate(provider, providerName, from, to, isoDate, qSignal, queryClient),
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
