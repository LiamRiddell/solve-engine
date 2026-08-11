/**
 * The `solve-engine/services` subpath. It has three exports and, before this
 * file, no test directory at all.
 *
 * Two of the three are a module-level hand-off rather than a helper:
 * `ExpressionEngine` publishes its own `QueryClient` immediately before every
 * `executeBytecode()` call so that a synchronous VM plugin function, whose
 * `(args) => Value` signature has nowhere to receive one, can read it back.
 * That makes `getActiveQueryClient()` part of the contract a package author
 * writing a cached data lookup depends on, and it is only meaningful from
 * inside a running evaluation, which is how it is exercised below.
 *
 * The third, `createQueryClient()`, sets the retry policy every async package
 * inherits. Its numbers are asserted because they bound how long a failing
 * request can hold a line in a pending state.
 */

import { afterEach, describe, expect, test } from "@jest/globals";
import { QueryClient } from "@tanstack/query-core";
import {
	createQueryClient,
	getActiveQueryClient,
	setActiveQueryClient,
} from "@solve-js/services/DataQueryService";
import { allocatePluginFunctionIndex } from "@solve-js/vm/VMBuiltins";
import { numberValue, type Value } from "@solve-js/vm/Value";
import { OpCode } from "@solve-js/parser/OpCode";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { newTrackedEngine } from "@tools/trackedEngine";

/*
 * The module-level slot is process-wide by design, so a test that leaves a
 * client published would change what the next spec in this file observes.
 */
afterEach(() => {
	setActiveQueryClient(null);
});

/**
 * A package whose one plugin function records the client that was published
 * while it ran. This is exactly the shape `IEnginePackage.pluginFunctions`
 * documents, reached the way an integrator would reach it.
 */
function probePackage(seen: Array<QueryClient | null>): IEnginePackage {
	const index = allocatePluginFunctionIndex();

	const parselet: PrefixParselet = {
		category: "Probe",
		parse(_parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			builder.emitOpcode(OpCode.CALL_PLUGIN);
			builder.emitIndex(index);
			builder.emitIndex(0);
		},
	};

	return {
		name: "query-client-probe",
		lexerVocabulary: { keywords: { whichclient: "PROBE_CLIENT" } },
		prefixParselets: [{ tokenType: "PROBE_CLIENT", parselet }],
		pluginFunctions: [
			{
				index,
				handler: (_args: Value[]): Value => {
					seen.push(getActiveQueryClient());
					return numberValue(1);
				},
			},
		],
	};
}

describe("the active-query-client hand-off", () => {
	test("nothing is published before any engine runs", () => {
		// The slot starts empty, which is what makes a null return mean "no
		// evaluation in flight" rather than "not wired up yet".
		expect(getActiveQueryClient()).toBeNull();
	});

	test("a plugin function sees the client of the engine that is running it", () => {
		/*
		 * This is the whole point of the module. A package handler has no
		 * parameter through which a client could arrive, so if this reads
		 * null, every cached lookup a third party writes silently becomes an
		 * uncached one.
		 */
		const seen: Array<QueryClient | null> = [];
		const engine = newTrackedEngine("en");
		engine.registerPackage(probePackage(seen));

		engine.evaluateExpression("whichclient");

		expect(seen).toHaveLength(1);
		expect(seen[0]).toBe(engine.queryClient);
	});

	test("two engines each publish their own, not the first one to run", () => {
		/*
		 * A host with two documents open has two engines and two caches. If
		 * the slot were written once and left, the second document's lookups
		 * would read the first document's cache, which is a cross-document
		 * data leak rather than a performance detail.
		 */
		const seen: Array<QueryClient | null> = [];
		const first = newTrackedEngine("en");
		const second = newTrackedEngine("en");
		first.registerPackage(probePackage(seen));
		second.registerPackage(probePackage(seen));

		first.evaluateExpression("whichclient");
		second.evaluateExpression("whichclient");
		first.evaluateExpression("whichclient");

		expect(seen[0]).toBe(first.queryClient);
		expect(seen[1]).toBe(second.queryClient);
		expect(seen[2]).toBe(first.queryClient);
		expect(first.queryClient).not.toBe(second.queryClient);
	});

	test("clear() unpublishes the engine's own client", () => {
		// Leaving a cleared engine's client published would let a later
		// execution read a cache nobody owns any more.
		const engine = newTrackedEngine("en");
		engine.evaluateExpression("1 + 1");
		expect(getActiveQueryClient()).toBe(engine.queryClient);

		engine.clear();

		expect(getActiveQueryClient()).toBeNull();
	});

	test("clear() leaves another engine's published client alone", () => {
		/*
		 * The guard in `clear()` is an identity check for a reason: two
		 * engines in one process interleave, and an unconditional
		 * `setActiveQueryClient(null)` would let one document's teardown
		 * blank the slot out from under another document's in-flight
		 * evaluation.
		 */
		const running = newTrackedEngine("en");
		const other = newTrackedEngine("en");
		running.evaluateExpression("1 + 1");
		expect(getActiveQueryClient()).toBe(running.queryClient);

		other.clear();

		expect(getActiveQueryClient()).toBe(running.queryClient);
	});
});

describe("createQueryClient", () => {
	test("hands back a fresh client each time, so engines do not share a cache", () => {
		const a = createQueryClient();
		const b = createQueryClient();
		try {
			expect(a).toBeInstanceOf(QueryClient);
			expect(a).not.toBe(b);
		} finally {
			a.clear();
			b.clear();
		}
	});

	test("the retry backoff doubles and then flattens at five seconds", () => {
		/*
		 * Derived from the documented policy, `min(500 * 2^attempt, 5000)`,
		 * rather than read back. It matters because three retries at this
		 * schedule is the longest a failing lookup can hold a line pending:
		 * 500 + 1000 + 2000 ms, and the cap is what stops a fourth attempt
		 * from ever being scheduled minutes out.
		 */
		const client = createQueryClient();
		try {
			const options = client.getDefaultOptions().queries;
			const delay = options?.retryDelay as (attempt: number, error: Error) => number;
			const failure = new Error("network");

			expect(delay(0, failure)).toBe(500);
			expect(delay(1, failure)).toBe(1000);
			expect(delay(2, failure)).toBe(2000);
			expect(delay(3, failure)).toBe(4000);
			// 500 * 2^4 is 8000, past the cap, so this and everything after
			// it is 5000.
			expect(delay(4, failure)).toBe(5000);
			expect(delay(10, failure)).toBe(5000);
		} finally {
			client.clear();
		}
	});

	test("refetch-on-focus and refetch-on-reconnect are both off", () => {
		/*
		 * Both would fire outside any evaluation the engine knows about, so
		 * a result could change under a line that nobody edited. The engine
		 * re-evaluates on its own schedule through the resolver preflight
		 * path instead.
		 */
		const client = createQueryClient();
		try {
			const options = client.getDefaultOptions().queries;
			expect(options?.refetchOnWindowFocus).toBe(false);
			expect(options?.refetchOnReconnect).toBe(false);
		} finally {
			client.clear();
		}
	});
});
