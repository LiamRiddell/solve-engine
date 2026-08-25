/**
 * Snapshot and restore engine state.
 *
 * Everything a session accumulates lives only in memory: named variables,
 * user-defined functions, and the per-line result/bytecode cache. Rebuilding
 * that from scratch means re-evaluating the whole document, which gets slower
 * with the document and re-runs every async resolver as a side effect. The
 * contract these tests pin down is that `engine.toJSON()` captures that state as
 * a plain, JSON-safe object and `ExpressionEngine.fromJSON()` restores it onto a
 * fresh engine that then behaves identically, without carrying anything that
 * would be wrong to restore.
 *
 * The load-bearing assertions:
 * - A restored engine answers later expressions exactly as the engine that
 *   evaluated the document would have (variables, a user function, the caches).
 * - Every supported value kind survives the round trip, including the exact
 *   money and exact fraction sidecars, and non-finite numbers that plain
 *   `JSON.stringify` would silently turn into `null`.
 * - A snapshot from an incompatible serialised shape is refused clearly with a
 *   coded error rather than restored wrongly.
 * - Resolved and in-flight async values are NOT restored stale: an async-backed
 *   line and any variable it defines are dropped, so the restored engine
 *   re-fetches rather than serving a point-in-time value from another moment.
 */

import { describe, expect, test, afterEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import {
	serializeValue,
	deserializeValue,
	type EngineSnapshot,
} from "@solve-js/engine/EngineSnapshot";
import { Value, ValueType, numberValue, type MatrixData } from "@solve-js/vm/Value";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import { OpCode } from "@solve-js/parser/OpCode";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { createQueryResolver } from "@solve-js/resolvers/QueryResolver";

// ── Engine lifecycle ────────────────────────────────────────────────────────
// Both constructed and restored engines hold a query cache whose GC timers keep
// the process alive, so every engine a test makes (including the ones fromJSON
// builds, which the constructor-only tracker cannot see) is cleared here.

const live: ExpressionEngine[] = [];
function track<T extends ExpressionEngine>(engine: T): T {
	live.push(engine);
	return engine;
}
afterEach(() => {
	while (live.length > 0) {
		try {
			live.pop()?.clear();
		} catch {
			/* already torn down */
		}
	}
});

/** Snapshot, force it through a real JSON round trip, and restore, so every test also proves the snapshot survives `JSON.stringify`/`JSON.parse`. Restores the full built-in set by default, since a snapshot must be restored against the packages it was taken with (the engine no longer registers any by default). */
function roundTrip(engine: ExpressionEngine, packages: IEnginePackage[] = BUILTIN_PACKAGES): ExpressionEngine {
	const snapshot = engine.toJSON();
	const throughJson = JSON.parse(JSON.stringify(snapshot)) as EngineSnapshot;
	return track(ExpressionEngine.fromJSON(throughJson, { packages }));
}

/** Assert two Values are equal in every field the engine reads, including the exact-money and exact-fraction sidecars. */
function assertValueEquals(after: Value, before: Value): void {
	expect(after.type).toBe(before.type);
	expect(after.unit).toBe(before.unit);
	if (typeof before.value === "bigint") {
		expect(typeof after.value).toBe("bigint");
		expect((after.value as bigint).toString()).toBe(before.value.toString());
	} else if (before.type === ValueType.Matrix) {
		const bm = before.value as MatrixData;
		const am = after.value as MatrixData;
		expect(am.rows).toBe(bm.rows);
		expect(am.cols).toBe(bm.cols);
		expect(am.data).toEqual(bm.data);
	} else {
		expect(after.value).toEqual(before.value);
	}
	if (before.exact) {
		expect(after.exact?.coef.toString()).toBe(before.exact.coef.toString());
		expect(after.exact?.scale).toBe(before.exact.scale);
	} else {
		expect(after.exact).toBeUndefined();
	}
	if (before.rational) {
		expect(after.rational?.n.toString()).toBe(before.rational.n.toString());
		expect(after.rational?.d.toString()).toBe(before.rational.d.toString());
	} else {
		expect(after.rational).toBeUndefined();
	}
}

// ── A deterministic async package ───────────────────────────────────────────
// Models a real fetch-backed package (weather/stocks/currency) via the same
// createQueryResolver plumbing they use, but with a value the test controls by
// pre-seeding the query cache, so the async op resolves synchronously and the
// test never races a real network or a batcher flush. `asyncprice <symbol>`
// compiles to the PUSH_STRING(symbol) + CALL_PLUGIN pair the resolver scans for.

// The engine files this package's async function under `${pkg.name}:${name}`
// and assigns it a stable CALL_PLUGIN index. Computing the index here from that
// same qualified name gives the resolver the exact index the engine will emit,
// and the parselet emits the call by name (below), so all three agree.
const TEST_ASYNC_PKG_NAME = "test-async";
const ASYNC_FN_NAME = "asyncPrice";
const ASYNC_FN_IDX = pluginFunctionIndexFor(`${TEST_ASYNC_PKG_NAME}:${ASYNC_FN_NAME}`);

const { resolver: asyncResolver, pluginFunction: asyncPluginFunction } = createQueryResolver({
	namespace: "testasync",
	pluginFunctionIndex: ASYNC_FN_IDX,
	// Only reached on a genuine cache miss; the tests seed the cache instead.
	fetchQuery: async () => numberValue(0),
});

const asyncPriceParselet: PrefixParselet = {
	category: "TestAsync",
	parse(parser, _token, builder): void {
		const symbol = parser.consume().value;
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(symbol);
		// Emit the plugin call by name; the engine's builder resolves it to the
		// same index the resolver watches, so the compiled bytecode is the
		// PUSH_STRING(symbol) + CALL_PLUGIN pair the resolver scans for.
		builder.emitPluginCall(ASYNC_FN_NAME, 1);
	},
};

const TEST_ASYNC_PACKAGE: IEnginePackage = {
	name: TEST_ASYNC_PKG_NAME,
	lexerVocabulary: { keywords: { asyncprice: "ASYNC_PRICE" } },
	prefixParselets: { ASYNC_PRICE: asyncPriceParselet },
	pluginFunctions: { [ASYNC_FN_NAME]: asyncPluginFunction },
	asyncResolvers: [asyncResolver],
};

const ASYNC_PACKAGES = [...BUILTIN_PACKAGES, TEST_ASYNC_PACKAGE];

// ── Round-trip behavioural identity ─────────────────────────────────────────

describe("a restored engine behaves like the one that evaluated the document", () => {
	test("variables and a user function resolve identically after a round trip", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(
			[
				":price = 100",
				":qty = 3",
				"double(x) = x * 2",
				":subtotal = price * qty",
			].join("\n"),
		);

		const restored = roundTrip(engine);

		for (const expr of [":price + 1", "double(21)", ":subtotal", "double(price) + qty"]) {
			const before = engine.evaluateExpression(expr);
			const after = restored.evaluateExpression(expr);
			expect(after.toNumber()).toBe(before.toNumber());
			expect(after.type).toBe(before.type);
		}
	});

	test("a function defined before the snapshot is callable after restore", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument("cube(n) = n * n * n\n:seed = 4");
		const restored = roundTrip(engine);
		expect(restored.evaluateExpression("cube(3)").toNumber()).toBe(27);
		expect(restored.evaluateExpression("cube(seed)").toNumber()).toBe(64);
	});

	test("the restore uses the snapshot's own locale by default", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":x = 7");
		const snapshot = engine.toJSON();
		expect(snapshot.locale).toBe("en");
		const restored = track(ExpressionEngine.fromJSON(snapshot, { packages: BUILTIN_PACKAGES }));
		expect(restored.getConfig()).toBeDefined();
		expect(restored.evaluateExpression(":x + 1").toNumber()).toBe(8);
	});
});

// ── Value fidelity ──────────────────────────────────────────────────────────

describe("every supported value kind survives the round trip", () => {
	test("scalars, units, money, fractions, bigints, and vectors restore identically", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(
			[
				":n = 42.5",
				':s = "hello"',
				":b = 5 > 3",
				":u = 100 cm",
				":pct = 25%",
				":big = 99999999999999999999n",
				":money = $19.99",
				":frac = 1/3",
				":vec = [1, 2, 3]",
			].join("\n"),
		);

		const restored = roundTrip(engine);

		for (const name of ["n", "s", "b", "u", "pct", "big", "money", "frac", "vec"]) {
			const before = engine.getVM().getVar(name);
			const after = restored.getVM().getVar(name);
			expect(before).toBeDefined();
			expect(after).toBeDefined();
			assertValueEquals(after as Value, before as Value);
		}
	});

	test("money stays exact across a restore, not the drifted double", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":a = $0.10\n:b = $0.20");
		const restored = roundTrip(engine);

		const before = engine.evaluateExpression("a + b");
		const after = restored.evaluateExpression("a + b");
		expect(after.exact).toBeDefined();
		expect(after.exact?.coef.toString()).toBe(before.exact?.coef.toString());
		expect(after.exact?.scale).toBe(before.exact?.scale);
		expect(after.toNumber()).toBeCloseTo(0.3, 10);
	});

	test("an exact fraction keeps its rational sidecar, so 1/3 + 1/3 + 1/3 is exactly 1", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":third = 1/3");
		const restored = roundTrip(engine);
		const sum = restored.evaluateExpression("third + third + third");
		expect(sum.toNumber()).toBe(1);
	});

	test("non-finite numbers round-trip through sentinels rather than becoming null", () => {
		// JSON.stringify writes NaN/Infinity/-Infinity as null, a silent
		// corruption, so the serializer names them. Tested at the value level so
		// the assertion does not depend on the engine's own division semantics.
		for (const n of [Infinity, -Infinity, NaN, 0, -1.5, 1e308, Number.MAX_SAFE_INTEGER]) {
			const serialized = serializeValue(new Value(ValueType.Number, n), "test");
			const throughJson = JSON.parse(JSON.stringify(serialized));
			const restored = deserializeValue(throughJson);
			if (Number.isNaN(n)) {
				expect(Number.isNaN(restored.toNumber())).toBe(true);
			} else {
				expect(restored.toNumber()).toBe(n);
			}
		}
	});
});

// ── JSON safety ─────────────────────────────────────────────────────────────

describe("a snapshot is plain JSON", () => {
	test("stringify then parse leaves the snapshot structurally identical", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":x = 10\nf(k) = k + 1\n:huge = 123456789012345678901234567890n\n:y = f(x)");
		const snapshot = engine.toJSON();
		// The snapshot is already JSON-safe (bigints are strings, no NaN/Infinity
		// numbers, typed arrays are plain arrays), so a real round trip is the
		// identity, not a lossy approximation.
		const throughJson = JSON.parse(JSON.stringify(snapshot));
		expect(throughJson).toEqual(snapshot);

		const restored = track(ExpressionEngine.fromJSON(throughJson, { packages: BUILTIN_PACKAGES }));
		expect(restored.evaluateExpression("f(41)").toNumber()).toBe(42);
		expect(restored.evaluateExpression(":y").toNumber()).toBe(11);
	});

	test("the snapshot carries the format envelope and engine version", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":x = 1");
		const snapshot = engine.toJSON();
		expect(snapshot.format).toBe("solve-engine/snapshot");
		expect(snapshot.version).toBe(1);
		expect(typeof snapshot.engineVersion).toBe("string");
	});
});

// ── Versioning gate ─────────────────────────────────────────────────────────

describe("an incompatible snapshot is refused clearly", () => {
	function codeOf(thunk: () => unknown): string | undefined {
		try {
			thunk();
		} catch (e) {
			return (e as { code?: string }).code;
		}
		return undefined;
	}

	test("a mismatched serialised-shape version is a coded rejection, not a wrong restore", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":x = 1");
		const snapshot = engine.toJSON();
		const fromFuture = { ...snapshot, version: snapshot.version + 1 };
		expect(codeOf(() => ExpressionEngine.fromJSON(fromFuture as EngineSnapshot))).toBe("SNAPSHOT_VERSION_MISMATCH");
	});

	test("an object that is not a snapshot at all is rejected", () => {
		expect(codeOf(() => ExpressionEngine.fromJSON({ hello: "world" } as unknown as EngineSnapshot))).toBe("SNAPSHOT_VERSION_MISMATCH");
		expect(codeOf(() => ExpressionEngine.fromJSON(null as unknown as EngineSnapshot))).toBe("SNAPSHOT_VERSION_MISMATCH");
	});

	test("a wrong format string is rejected even when a version is present", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":x = 1");
		const snapshot = engine.toJSON();
		const wrongFormat = { ...snapshot, format: "some-other-tool/export" };
		expect(codeOf(() => ExpressionEngine.fromJSON(wrongFormat as unknown as EngineSnapshot))).toBe("SNAPSHOT_VERSION_MISMATCH");
	});
});

// ── Async values are not restored stale ─────────────────────────────────────

describe("resolved and in-flight async values are not restored stale", () => {
	test("an in-flight (pending) async line is present in the live cache but omitted from the snapshot", async () => {
		const engine = track(new ExpressionEngine({ packages: ASYNC_PACKAGES }));
		// A bare engine has no host to mirror resolved values into; sink them so
		// the in-flight fetch settling later does not warn about a missing hook.
		engine.getBatcher().onLineResult = () => {};

		const pending = engine.evaluateLine(1, "asyncprice FOO");
		expect(pending.type).toBe(ValueType.Pending);

		// The snapshot is taken while the line is still in flight. The engine kept
		// the line so it can re-evaluate when the fetch settles, but the snapshot
		// must not carry a point-in-time async result.
		const snapshot = engine.toJSON();
		expect(engine.getLineCache().getEntryForLine(1)).toBeDefined();
		expect(snapshot.lineCache.some((e) => e.line === 1)).toBe(false);

		// Let the fetch settle inside the test so nothing resolves after teardown.
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
	});

	test("a resolved async variable is dropped, so a restored engine re-fetches rather than serving a stale value", () => {
		const engine = track(new ExpressionEngine({ packages: ASYNC_PACKAGES }));
		// Seed the query cache so the async op resolves synchronously to a value
		// the test controls, no batcher flush or real network involved.
		engine.queryClient.setQueryData(["testasync", "FOO"], numberValue(50000));

		const resolved = engine.evaluateLine(1, ":p = asyncprice FOO");
		expect(resolved.toNumber()).toBe(50000);
		expect(engine.getVM().getVar("p")?.toNumber()).toBe(50000);

		const snapshot = engine.toJSON();
		expect(snapshot.variables.p).toBeUndefined();
		expect(snapshot.lineCache.some((e) => e.line === 1)).toBe(false);

		const restored = track(ExpressionEngine.fromJSON(snapshot, { packages: ASYNC_PACKAGES }));
		// Stale 50000 must NOT have been restored: the variable is simply absent,
		// so reading it re-triggers the fetch instead.
		expect(restored.getVM().getVar("p")).toBeUndefined();
	});

	test("a plain variable defined after an async one of the same name is still carried", () => {
		const engine = track(new ExpressionEngine({ packages: ASYNC_PACKAGES }));
		engine.queryClient.setQueryData(["testasync", "FOO"], numberValue(1));
		engine.evaluateLine(1, ":p = asyncprice FOO"); // async writer, line 1
		engine.evaluateLine(2, ":p = 500"); // plain writer, line 2, the current value

		const snapshot = engine.toJSON();
		// The most recent definition of p is the plain line 2, so p is carried.
		expect(snapshot.variables.p).toBeDefined();
		const restored = track(ExpressionEngine.fromJSON(snapshot, { packages: ASYNC_PACKAGES }));
		expect(restored.getVM().getVar("p")?.toNumber()).toBe(500);
	});
});

// ── Caches carried and keyed correctly ──────────────────────────────────────

describe("the line and bytecode caches are carried", () => {
	test("restored line-cache entries match by result, reads, and write variable", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":x = 10\n:y = x * 2\n:z = y + 5");
		const restored = roundTrip(engine);

		for (let line = 1; line <= 3; line++) {
			const before = engine.getLineCache().getEntryForLine(line);
			const after = restored.getLineCache().getEntryForLine(line);
			expect(before).toBeDefined();
			expect(after).toBeDefined();
			expect(after!.result.toNumber()).toBe(before!.result.toNumber());
			expect(after!.readVariables).toEqual(before!.readVariables);
			expect(after!.writeVariable).toBe(before!.writeVariable);
		}

		expect(restored.getBytecodeCache().size).toBe(engine.getBytecodeCache().size);
	});

	test("incremental re-evaluation works after a restore, so the dependency graph was rebuilt", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":base = 10\n:scaled = base * 2");
		const restored = roundTrip(engine);

		const updated = restored.evaluateIncremental("base", 100);
		// scaled reads base, so changing base re-computes it: 100 * 2 = 200.
		expect(updated.get(2)?.toNumber()).toBe(200);
	});
});

// ── Symbolic values are deferred, not silently dropped ───────────────────────

describe("symbolic (algebra) values are deferred with a clear error", () => {
	test("serialising a symbolic value is refused by name", () => {
		// Built directly rather than through the engine so the assertion is exact:
		// the serializer refuses on the type tag before it ever inspects the node.
		const symbolic = new Value(ValueType.Symbolic, { kind: "var", name: "x" } as unknown as MatrixData);
		let code: string | undefined;
		try {
			serializeValue(symbolic, 'variable "s"');
		} catch (e) {
			code = (e as { code?: string }).code;
		}
		expect(code).toBe("SNAPSHOT_UNSUPPORTED_VALUE");
	});

	test("a cached line whose result is symbolic is skipped, and the rest of the snapshot still succeeds", () => {
		const engine = track(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		engine.parseDocument(":x = 5\nexpand((a + 1) * (a + 2))");
		// toJSON must not throw just because one line produced a symbolic result.
		const snapshot = engine.toJSON();
		expect(snapshot.variables.x).toBeDefined();
		expect(snapshot.lineCache.some((e) => e.line === 2)).toBe(false);

		const restored = roundTrip(engine);
		expect(restored.evaluateExpression(":x + 1").toNumber()).toBe(6);
	});
});
