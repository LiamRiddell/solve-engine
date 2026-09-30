/**
 * The built-in historical exchange rate against the real Frankfurter endpoint.
 *
 * Like the weather suite's live cases (#620), these run only with
 * SOLVE_LIVE_NETWORK=1 set, from `npm run test:live` and the scheduled
 * live-network workflow, never in a gate: a real third-party call in a gate
 * fails builds over outages that have nothing to do with the change. Without
 * the flag each case reports itself skipped. A timeout, a 5xx and a 429 count
 * as outages; any other failure is a real one. Every other behaviour of the
 * provider is proven offline through a stubbed fetch in
 * `__tests__/bugs/Issue699_frankfurterHistoricalRates.spec.ts`.
 */
import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/UnifiedErrorFramework";
import { HistoricalCurrencyErrorCodes, normaliseHistoricalRate } from "@solve-js/uom/HistoricalCurrency";
import { frankfurterHistoricalRateProvider } from "@solve-js/uom/FrankfurterHistoricalRates";

/** Whether the live cases may call Frankfurter: only with SOLVE_LIVE_NETWORK=1 set. */
const LIVE_NETWORK = process.env.SOLVE_LIVE_NETWORK === "1";

/** A stalled request, a server fault or the rate limit: an outage for this run, not a bug. */
function isOutage(error: unknown): boolean {
	if (error instanceof DOMException && error.name === "TimeoutError") return true;
	if (error instanceof TypeError && /fetch failed/.test(error.message)) return true;
	if (!(error instanceof EngineError) || error.code !== HistoricalCurrencyErrorCodes.QUERY_FAILED) return false;
	const status = error.context?.status;
	return typeof status === "number" && (status >= 500 || status === 429);
}

function reportSkipped(what: string, why: string): void {
	console.warn(`[frankfurter] SKIPPED "${what}": ${why}.`);
}

describe("frankfurterHistoricalRateProvider against the real endpoint", () => {
	test(
		"USD to GBP on 2024-01-15 is the rate issue #699 recorded, 0.78441",
		async () => {
			const what = "USD to GBP on 2024-01-15";
			if (!LIVE_NETWORK) {
				reportSkipped(what, "the live network cases are off (set SOLVE_LIVE_NETWORK=1 to run them)");
				return;
			}
			let answer;
			try {
				answer = await frankfurterHistoricalRateProvider("USD", "GBP", "2024-01-15", AbortSignal.timeout(15_000));
			} catch (error) {
				if (isOutage(error)) {
					reportSkipped(what, "Frankfurter is unreachable from this environment");
					return;
				}
				throw error;
			}
			expect(normaliseHistoricalRate(answer, "2024-01-15")).toEqual({ rate: 0.78441, asOf: "2024-01-15" });
		},
		20_000,
	);
});
