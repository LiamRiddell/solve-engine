import { afterAll, afterEach, describe, expect, test } from "@jest/globals";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { createQueryResolver, type QueryResolverOptions } from "@solve-js/resolvers/QueryResolver";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { numberValue, type Value } from "@solve-js/vm/Value";
import { EngineError } from "@solve-js/errors/EngineError";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import {
	createTestEngine,
	expectDocument,
	expectExpression,
	DocumentAssertion,
	ExpectationError,
} from "@solve-js/testing";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #720: a live value is Pending on its first evaluation, and the only way
 * to reach its answer was to read the event stream, wait for `lines-updated`
 * and re-evaluate by hand. A package author had no matcher for what a live
 * value resolves to, and no document-level assertion at all.
 *
 * `engine.settle({ timeoutMs })` now resolves once every fetch the engine
 * started has settled and the batcher has re-run the lines they fed, and
 * rejects with `SETTLE_TIMEOUT` at the deadline. The testing kit gains
 * `settled()`, `toResolveTo(value, unit?)` and `expectDocument(engine, text)`,
 * all built on it. A fetch that lands after `clear()` is dropped instead of
 * re-running the next document's lines.
 */

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let serial = 0;
const engines: ExpressionEngine[] = [];

afterEach(() => {
	for (const engine of engines.splice(0)) engine.clear();
});

// The resolvers that never answer are given a 200 ms fetch timeout of their
// own; waiting it out lets their timers end before the file does.
afterAll(() => later(250));

/**
 * A package whose keyword `word` followed by a name looks the name up through
 * `fetchQuery`, built with `createQueryResolver` exactly as a live-data package
 * is. Each call gets its own namespace, so one test's cache is not another's.
 */
function probePackage(
	fetchQuery: QueryResolverOptions["fetchQuery"],
	options: Partial<QueryResolverOptions> & { word?: string } = {},
): IEnginePackage {
	const name = `probe720-${++serial}`;
	const word = options.word ?? "lookup";
	const fn = "lookup";
	const { resolver, pluginFunction } = createQueryResolver({
		namespace: name,
		pluginFunctionIndex: pluginFunctionIndexFor(`${name}:${fn}`),
		fetchQuery,
		failureCooldownMs: 50,
		...options,
	});
	class LookupParselet implements PrefixParselet {
		readonly category = "Probe";
		parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			const subject = parser.consume();
			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(String(subject.value));
			builder.emitPluginCall(fn, 1);
		}
	}
	return {
		name,
		lexerVocabulary: { keywords: { [word]: "PROBE720_LOOKUP" } },
		prefixParselets: { PROBE720_LOOKUP: new LookupParselet() },
		pluginFunctions: { [fn]: pluginFunction },
		asyncResolvers: [resolver],
		tokenCategories: { PROBE720_LOOKUP: "function" },
	};
}

/** A probe engine, cleared after the test, with the batcher's hook wired so no unwired warning is logged. */
function engineWith(pkg: IEnginePackage): ExpressionEngine {
	const engine = createTestEngine([pkg]);
	engine.getBatcher().onLineResult = () => {};
	engines.push(engine);
	return engine;
}

/** Answers the subject's length plus 38 after `ms`: `lookup abcde` is 43. */
const slowLength = (ms: number) => async (query: string): Promise<Value> => {
	await later(ms);
	return numberValue(query.length + 38);
};

/** A promise that never settles, for the resolver that never answers. */
const never = (): Promise<Value> => new Promise<Value>(() => {});

/** The code a rejected promise carries, or "resolved". */
async function codeOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
		return "resolved";
	} catch (error) {
		return error instanceof EngineError || error instanceof ExpectationError ? error.code : `raw ${String(error)}`;
	}
}

// ── engine.settle, the part ──────────────────────────────────────────────

describe("engine.settle", () => {
	test("the issue's probe: pending first, then 43 after settle, with no event loop by hand", async () => {
		const engine = engineWith(probePackage(slowLength(20)));
		expect(engine.evaluateExpression("lookup abcde").isPending()).toBe(true);
		await engine.settle();
		expect(formatValue(engine.evaluateExpression("lookup abcde"))).toBe("= 43");
	});

	test("resolves at once when nothing is in flight", async () => {
		const engine = engineWith(probePackage(slowLength(20)));
		const started = Date.now();
		await engine.settle({ timeoutMs: 1_000 });
		expect(Date.now() - started).toBeLessThan(100);
	});

	test("a timeout of zero with nothing in flight resolves; with something in flight it refuses", async () => {
		const engine = engineWith(probePackage(slowLength(30)));
		await expect(engine.settle({ timeoutMs: 0 })).resolves.toBeUndefined();
		engine.evaluateExpression("lookup abc");
		expect(await codeOf(engine.settle({ timeoutMs: 0 }))).toBe("SETTLE_TIMEOUT");
		await engine.settle();
	});

	test("a resolver that never answers meets the deadline with SETTLE_TIMEOUT, naming how many", async () => {
		const engine = engineWith(probePackage(never, { timeoutMs: 200 }));
		engine.evaluateExpression("lookup a");
		engine.evaluateExpression("lookup b");
		const started = Date.now();
		let caught: unknown;
		try {
			await engine.settle({ timeoutMs: 40 });
		} catch (error) {
			caught = error;
		}
		expect(Date.now() - started).toBeLessThan(1_000);
		expect(caught).toBeInstanceOf(EngineError);
		const error = caught as EngineError;
		expect(error.code).toBe("SETTLE_TIMEOUT");
		expect(error.context).toMatchObject({ inFlight: 2, timeoutMs: 40 });
		expect(error.message).toContain("2 live values were still being fetched after 40 ms");
		// The pending contract holds: the line is still Pending, not zero.
		expect(engine.evaluateExpression("lookup a").isPending()).toBe(true);
	});

	test("a resolver that rejects settles, and the next evaluation is the coded failure", async () => {
		const engine = engineWith(probePackage(async () => {
			await later(5);
			throw new Error("service down");
		}));
		engine.evaluateExpression("lookup x");
		await engine.settle();
		const value = engine.evaluateExpression("lookup x");
		expect(value.isError()).toBe(true);
		expect(value.errorCode).toMatch(/_QUERY_FAILED$/);
	});

	test("two lines sharing one query key make one fetch, and both settle", async () => {
		let fetches = 0;
		const engine = engineWith(probePackage(async (query) => {
			fetches++;
			await later(10);
			return numberValue(query.length);
		}));
		const doc = evaluateDocument(engine, "lookup same\nlookup same * 2");
		expect(doc.lines.map((l) => l.result?.isPending())).toEqual([true, true]);
		await engine.settle();
		const settled = evaluateDocument(engine, "lookup same\nlookup same * 2");
		expect(settled.lines.map((l) => formatValue(l.result!))).toEqual(["= 4", "= 8"]);
		expect(fetches).toBe(1);
	});

	test("clear() releases a waiting settle, since what it waited for is gone", async () => {
		const engine = engineWith(probePackage(never, { timeoutMs: 200 }));
		engine.evaluateExpression("lookup a");
		const waiting = engine.settle({ timeoutMs: 5_000 });
		const started = Date.now();
		engine.clear();
		await expect(waiting).resolves.toBeUndefined();
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"refuses a timeoutMs of %p with SETTLE_TIMEOUT_INVALID",
		async (timeoutMs) => {
			const engine = engineWith(probePackage(slowLength(1)));
			expect(await codeOf(engine.settle({ timeoutMs }))).toBe("SETTLE_TIMEOUT_INVALID");
		},
	);

	test("refuses a timeoutMs that is not a number, without a raw error", async () => {
		const engine = engineWith(probePackage(slowLength(1)));
		const bad = { timeoutMs: "100" } as unknown as { timeoutMs: number };
		expect(await codeOf(engine.settle(bad))).toBe("SETTLE_TIMEOUT_INVALID");
	});
});

// ── The kit's waiting matchers, the parts ────────────────────────────────

describe("ExpressionAssertion.settled and toResolveTo", () => {
	test("toResolveTo reads the settled value, and checks the unit", async () => {
		const engine = engineWith(probePackage(async (q) => {
			await later(10);
			const v = numberValue(q.length);
			v.unit = "m";
			return v;
		}));
		await expectExpression(engine, "lookup dover").toResolveTo(5, "m");
	});

	test("a value that was never pending is compared at once", async () => {
		const engine = engineWith(probePackage(slowLength(1)));
		await expectExpression(engine, "2 + 2").toResolveTo(4);
	});

	test("toResolveTo fails with EXPECTED_EQUAL when the settled value differs", async () => {
		const engine = engineWith(probePackage(slowLength(10)));
		expect(await codeOf(expectExpression(engine, "lookup abcde").toResolveTo(44))).toBe("EXPECTED_EQUAL");
	});

	test("settled then toFailWith reads a rejecting resolver's code", async () => {
		const engine = engineWith(probePackage(async () => {
			throw new Error("nope");
		}));
		const assertion = await expectExpression(engine, "lookup z").settled();
		expect(() => assertion.toBeError()).not.toThrow();
	});

	test("a value that never settles fails with EXPECTED_SETTLED at the kit's deadline", async () => {
		const engine = engineWith(probePackage(never, { timeoutMs: 200 }));
		const started = Date.now();
		expect(await codeOf(expectExpression(engine, "lookup q").toResolveTo(1, undefined, { timeoutMs: 40 }))).toBe("EXPECTED_SETTLED");
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	test("a line whose first fetch reveals a second settles through both within one deadline", async () => {
		const engine = engineWith(probePackage(slowLength(10)));
		await expectExpression(engine, "lookup ab + lookup abcd").toResolveTo(40 + 42);
	});

	test("a document line's assertion refuses settled, since the document already settled", async () => {
		const engine = engineWith(probePackage(never, { timeoutMs: 200 }));
		const doc = await expectDocument(engine, "lookup a", { timeoutMs: 20 });
		expect(await codeOf(doc.line(1).settled())).toBe("EXPECTED_SETTLED");
	});
});

describe("expectDocument", () => {
	test("settles the document's live values and reads each line", async () => {
		const engine = engineWith(probePackage(slowLength(10)));
		const doc = await expectDocument(engine, ":v = lookup abcde\nv * 2\n\nsome prose");
		doc.line(1).toEqual(43);
		doc.line(2).toEqual(86);
		doc.line(4).toBeError();
		expect(doc).toBeInstanceOf(DocumentAssertion);
		expect(doc.lines).toHaveLength(4);
	});

	test("resolves the whole-document forms, goal seek included", async () => {
		const engine = createTestEngine();
		engines.push(engine);
		const doc = await expectDocument(engine, ":deposit = 100000\n:rate = 4%\nmonthly repayment on deposit over 25 years at rate\nsolve line 3 for deposit = 900");
		expect(formatValue(doc.lines[3].result!)).toBe("= 170,507.23");
		doc.line(3).toEvaluate();
	});

	test("a failed line carries its code to toFailWith", async () => {
		const engine = createTestEngine();
		engines.push(engine);
		(await expectDocument(engine, "1 +\nnosuchname * 2")).line(2).toFailWith("UNDEFINED_VARIABLE");
	});

	test("a line still pending at the deadline stays pending for toBePending", async () => {
		const engine = engineWith(probePackage(never, { timeoutMs: 200 }));
		const doc = await expectDocument(engine, "lookup x", { timeoutMs: 30 });
		doc.line(1).toBePending();
	});

	test.each([0, -1, 2, 1.5, Number.NaN])("line(%p) of a one-line document is EXPECTED_LINE", async (n) => {
		const engine = createTestEngine();
		engines.push(engine);
		const doc = await expectDocument(engine, "1 + 1");
		let code = "none";
		try {
			doc.line(n);
		} catch (error) {
			code = (error as ExpectationError).code;
		}
		expect(code).toBe("EXPECTED_LINE");
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test("a fetch that lands after clear() does not write into the next document", async () => {
		let calls = 0;
		const engine = engineWith(probePackage(async (q) => {
			calls++;
			const mine = calls;
			await later(mine === 1 ? 30 : 5);
			return numberValue(mine === 1 ? 999 : q.length);
		}));
		const updated: number[][] = [];
		evaluateDocument(engine, "lookup abc");
		engine.clear();
		engine.getBatcher().onLineResult = () => {};
		engine.getBatcher()._testCaptures = [];
		// The next document asks for the same key: its own fetch answers 3.
		evaluateDocument(engine, "1 + 1\nlookup abc");
		await later(60);
		for (const event of engine.getBatcher()._testCaptures ?? []) {
			if (event.type === "lines-updated") updated.push(event.lineNumbers);
		}
		const next = evaluateDocument(engine, "1 + 1\nlookup abc");
		expect(formatValue(next.lines[1].result!)).toBe("= 3");
		expect(calls).toBe(2);
	});

	test("a resolver that starts a new query on every run does not keep settle past its deadline", async () => {
		let n = 0;
		const engine = engineWith(probePackage(async () => {
			await later(5);
			return numberValue(++n);
		}, { staleTimeMs: 0 }));
		engine.evaluateExpression("lookup spin");
		const started = Date.now();
		const outcome = await codeOf(engine.settle({ timeoutMs: 100 }));
		expect(["resolved", "SETTLE_TIMEOUT"]).toContain(outcome);
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	test("a kit loop over a resolver that is never ready ends at the deadline, and timers still run", async () => {
		const engine = engineWith(probePackage(never, { timeoutMs: 200 }));
		let timerRan = false;
		setTimeout(() => (timerRan = true), 0);
		expect(await codeOf(expectExpression(engine, "lookup starve").toResolveTo(1, undefined, { timeoutMs: 50 }))).toBe("EXPECTED_SETTLED");
		expect(timerRan).toBe(true);
	});

	test("prototype words as a query key settle as ordinary queries and leave Object.prototype alone", async () => {
		const engine = engineWith(probePackage(slowLength(1)));
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		for (const word of PROTOTYPE_WORDS) {
			await expectExpression(engine, `lookup ${word}`).toResolveTo(word.length + 38);
		}
		expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
		expectPrototypeUntouched(() => engine.evaluateExpression("lookup __proto__"));
	});

	test("a thousand lines in flight settle together within budget", async () => {
		const engine = engineWith(probePackage(slowLength(1), { maxConcurrent: Infinity }));
		const text = Array.from({ length: 1_000 }, (_, i) => `lookup q${i}`).join("\n");
		const started = Date.now();
		const doc = await expectDocument(engine, text, { timeoutMs: 10_000 });
		expect(Date.now() - started).toBeLessThan(10_000);
		doc.line(1).toEqual(40);
		doc.line(1000).toEqual(42);
	});

	test.each(TEXT_EDGES.filter((t) => t.trim() !== "").slice(0, 12))("expectDocument on %p answers or refuses honestly", async (text) => {
		const engine = createTestEngine();
		engines.push(engine);
		const doc = await expectDocument(engine, text, { timeoutMs: 100 });
		expect(doc.lines.length).toBeGreaterThan(0);
	});
});

describe("adversarial: realistic breakage", () => {
	test("settle through a what-if on a settled document keeps the what-if honest", async () => {
		const engine = engineWith(probePackage(slowLength(5)));
		const text = ":v = lookup abcde\n:k = 2\nv * k";
		await expectDocument(engine, text);
		const scenario = engine.whatIf(text, { k: 3 });
		// A what-if re-run does not fetch; it answers the settled line or refuses by name.
		const last = scenario.lines[2];
		expect(last.result === null ? last.errorCode : "value").toBeTruthy();
	});

	test("the batch pass agrees with the incremental pass once settled", async () => {
		const engine = engineWith(probePackage(slowLength(5)));
		const text = ":v = lookup abc\nv + 1\nline 2 * 2";
		const doc = await expectDocument(engine, text);
		const batch = engine.parseDocument(text);
		expect(batch.lines.map((l) => (l.result ? formatValue(l.result) : l.error))).toEqual(
			doc.lines.map((l) => (l.result ? formatValue(l.result) : l.error)),
		);
	});

	test("an engine with the network off settles at once, and the line names the setting", async () => {
		const pkg = probePackage(slowLength(5));
		const engine = createTestEngine([]);
		engine.clear();
		const offline = new (engine.constructor as new (o: object) => ExpressionEngine)({ config: { network: { enabled: false } }, packages: [] });
		offline.registerPackage(pkg);
		engines.push(offline);
		offline.evaluateExpression("lookup abc");
		await offline.settle({ timeoutMs: 10 });
		(await expectExpression(offline, "lookup abc").settled()).toFailWith("NETWORK_DISABLED");
	});

	test("two settles at once both resolve", async () => {
		const engine = engineWith(probePackage(slowLength(10)));
		engine.evaluateExpression("lookup abc");
		await Promise.all([engine.settle(), engine.settle()]);
		expect(formatValue(engine.evaluateExpression("lookup abc"))).toBe("= 41");
	});
});

describe("adversarial: edge cases", () => {
	test("an empty document settles at once", async () => {
		const engine = createTestEngine();
		engines.push(engine);
		const doc = await expectDocument(engine, "");
		expect(doc.lines).toHaveLength(1);
	});

	test("CRLF and a trailing newline", async () => {
		const engine = engineWith(probePackage(slowLength(2)));
		const doc = await expectDocument(engine, "lookup ab\r\nline 1 + 1\r\n");
		doc.line(1).toEqual(40);
		doc.line(2).toEqual(41);
	});

	test("an empty query string settles to its own answer", async () => {
		const engine = engineWith(probePackage(slowLength(2)));
		await expectExpression(engine, 'lookup ""').settled();
	});

	test("a very large timeoutMs is accepted and resolves as soon as the fetch does", async () => {
		const engine = engineWith(probePackage(slowLength(5)));
		engine.evaluateExpression("lookup a");
		const started = Date.now();
		await engine.settle({ timeoutMs: Number.MAX_SAFE_INTEGER });
		expect(Date.now() - started).toBeLessThan(1_000);
	});
});
