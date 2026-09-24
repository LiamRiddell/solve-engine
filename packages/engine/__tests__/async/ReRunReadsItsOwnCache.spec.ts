/**
 * A value landing is re-run against the cache of the engine that asked for it
 * (issue #568).
 *
 * A package's plugin function reads a resolved value back through
 * `getActiveQueryClient()`, one module-level slot the engine publishes its
 * query cache in when it runs a line. The batcher's re-run, which happens when
 * a fetch lands and outside any evaluation, used to leave that slot as it was:
 *
 * - an engine whose first line fetches had published nothing, since a line
 *   that goes pending at preflight never runs, so the re-run answered
 *   `No cached result for "BTC"`;
 * - with a second engine in the process, the re-run read the second engine's
 *   cache, and reported its price as the first engine's answer.
 *
 * The batcher now publishes its own engine's cache for the length of the
 * re-run and puts the previous one back. No test reaches the network: every
 * price comes from a stub `fetchPrice`.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createCryptoPackage } from "@solve-js/packages/crypto";
import { getActiveQueryClient } from "@solve-js/services/DataQueryService";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { Value } from "@solve-js/vm/Value";

/** Let a stubbed fetch resolve and the batcher's microtask flush run. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** An engine with the crypto package on a stub price, recording what its re-runs report. */
function priceEngine(fetchPrice: () => Promise<{ price: number }>): { engine: ExpressionEngine; reported: string[] } {
	const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, createCryptoPackage({ fetchPrice })] });
	const reported: string[] = [];
	engine.getBatcher().onLineResult = (line: number, value: Value) => {
		reported.push(`line ${line}: ${formatValue(value).replace(/^=\s*/, "")}`);
	};
	return { engine, reported };
}

describe("the async re-run reads the owning engine's query cache", () => {
	test("an engine whose first evaluated line fetches reports the landed value, not a missing cache", async () => {
		const { engine, reported } = priceEngine(async () => ({ price: 60_000 }));
		expect(engine.evaluateLine(1, 'crypto("BTC")').isPending()).toBe(true);

		await settle();

		expect(reported).toEqual(["line 1: $60,000.00"]);
		// The cached line holds the landed value too, not an error.
		expect(formatValue(engine.getLineCache().getEntryForLine(1)!.result)).toBe("= $60,000.00");
	});

	test("two engines in one process each read their own cache", async () => {
		let releaseA: (quote: { price: number }) => void = () => undefined;
		const a = priceEngine(() => new Promise((resolve) => { releaseA = resolve; }));
		const b = priceEngine(async () => ({ price: 99_000 }));

		// B fetches and lands first, then runs an ordinary line, which publishes
		// B's cache in the shared slot. A's line goes pending without running, so
		// it publishes nothing, which is how A's re-run used to find B's cache.
		b.engine.evaluateLine(1, 'crypto("BTC")');
		await settle();
		b.engine.evaluateLine(2, "1 + 1");
		const publishedBeforeA = getActiveQueryClient();

		a.engine.evaluateLine(1, 'crypto("BTC")');
		releaseA({ price: 60_000 });
		await settle();

		expect(a.reported).toEqual(["line 1: $60,000.00"]);
		expect(b.reported).toEqual(["line 1: $99,000.00"]);
		// A's re-run put back the cache B had published, so the slot reads as it
		// did for anything that runs after the re-run.
		expect(getActiveQueryClient()).toBe(publishedBeforeA);
	});
});
