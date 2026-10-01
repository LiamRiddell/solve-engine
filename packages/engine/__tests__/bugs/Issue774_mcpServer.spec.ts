import { afterAll, describe, expect, test } from "@jest/globals";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { ENGINE_VERSION } from "@solve-js/constants/version";
import { ExpressionEngine, type EngineOptions } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { Token } from "@solve-js/lexer/Token";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import { createQueryResolver, type QueryResolverOptions } from "@solve-js/resolvers/QueryResolver";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { numberValue, type Value } from "@solve-js/vm/Value";
import { DOCUMENT_EDGES, NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES } from "@tools/adversarial";
import { HELP, parseServerArguments } from "../../../mcp/src/options";
import { createSolveServer, PROTOCOL_VERSIONS, RpcErrorCodes, toCallResult } from "../../../mcp/src/server";
import { createLineReader, MAX_MESSAGE_CHARS, serveLines } from "../../../mcp/src/transport";
import {
	checkDocumentTool,
	DEFAULT_SETTINGS,
	engineOptionsFor,
	evaluateDocumentTool,
	evaluateExpressionTool,
	EXCLUDED_PACKAGES,
	ServerErrorCodes,
	type ServerKit,
	type ServerSettings,
	type ToolOutcome,
} from "../../../mcp/src/tools";

/**
 * Issue #774, the MCP half: a Model Context Protocol server (packages/mcp) on
 * the `solve` command's contract, so an AI tool can evaluate an expression, a
 * document or its checks. Its defaults are the issue's: the network is off, a
 * fresh engine is built for every call and cleared in a `finally`, and
 * `solve-global-variables` is left out, so one call cannot read what another
 * wrote. The result objects are the ones `solve --json` prints, with `ok`
 * for the exit code, and an input the engine refuses as a whole comes back as
 * a coded refusal (`isError`) that costs that call and nothing more.
 *
 * The tools are driven here as plain functions and as JSON-RPC messages
 * through the server's own protocol handler, which needs no SDK and no
 * runtime API; `scripts/smoke-mcp.mjs` makes the same calls over standard
 * input and output against the built server.
 */

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The resolvers that never answer are given a 200 ms fetch timeout; waiting
// past it lets those timers end before the file does.
afterAll(() => later(300));

let serial = 0;

/** A live-data package, `lookup <word>`, built with `createQueryResolver`. */
function probePackage(fetchQuery: QueryResolverOptions["fetchQuery"], options: Partial<QueryResolverOptions> = {}): IEnginePackage {
	const name = `probe774mcp-${++serial}`;
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
		lexerVocabulary: { keywords: { lookup: "PROBE774MCP_LOOKUP" } },
		prefixParselets: { PROBE774MCP_LOOKUP: new LookupParselet() },
		pluginFunctions: { [fn]: pluginFunction },
		asyncResolvers: [resolver],
		tokenCategories: { PROBE774MCP_LOOKUP: "function" },
	};
}

const slowLength = (ms: number) => async (query: string): Promise<Value> => {
	await later(ms);
	return numberValue(query.length + 38);
};
const never = (): Promise<Value> => new Promise<Value>(() => {});

/** A kit that records every engine it builds, the options it was given and how often it was cleared. */
function recordingKit(extra: IEnginePackage[] = [], packages: readonly IEnginePackage[] = BUILTIN_PACKAGES) {
	const built: { options: EngineOptions; clears: number }[] = [];
	const kit: ServerKit = {
		createEngine: (options) => {
			const record = { options, clears: 0 };
			built.push(record);
			const engine = new ExpressionEngine({ ...options, packages: [...(options.packages ?? []), ...extra] });
			const clear = engine.clear.bind(engine);
			engine.clear = () => {
				record.clears++;
				clear();
			};
			return engine;
		},
		packages,
		evaluateDocument: (engine, text) => evaluateDocument(engine, text),
		dateCalendarInZone,
		engineVersion: ENGINE_VERSION,
		serverVersion: "9.9.9",
	};
	return { kit, built };
}

const settings = (over: Partial<ServerSettings> = {}): ServerSettings => ({ ...DEFAULT_SETTINGS, ...over });

/** The body of a successful outcome, failing the test on a refusal. */
// eslint-disable-next-line typescript/no-explicit-any -- the shape is asserted field by field
function body(outcome: ToolOutcome): Record<string, any> {
	if (!outcome.ok) throw new Error(`refused: ${outcome.error.code} ${outcome.error.message}`);
	return outcome.body;
}

/** A client that speaks JSON-RPC to the server's handler, as a transport would deliver it. */
async function connect(kit: ServerKit, s: ServerSettings = settings()) {
	const server = createSolveServer(kit, s);
	let nextId = 0;
	// eslint-disable-next-line typescript/no-explicit-any -- the shape is asserted field by field
	const request = async (method: string, params?: Record<string, unknown>): Promise<Record<string, any>> => {
		const id = ++nextId;
		const reply = await server.handle(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
		if (reply === undefined) throw new Error(`no answer to ${method}`);
		const message = JSON.parse(reply);
		expect(message.id).toBe(id);
		if (message.error) throw new Error(`${message.error.code} ${message.error.message}`);
		return message.result;
	};
	await request("initialize", { protocolVersion: PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: { name: "spec", version: "0" } });
	expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toBeUndefined();
	return {
		server,
		client: { listTools: () => request("tools/list") },
		call: async (name: string, args: Record<string, unknown>) => request("tools/call", { name, arguments: args }),
		close: async () => undefined,
	};
}

const LEAKS = ["[object Object]", "TypeError", "RangeError", "eval_failed", "at Object."];

function expectNoLeak(value: unknown): void {
	const text = JSON.stringify(value);
	for (const leak of LEAKS) expect(text).not.toContain(leak);
}

describe("#774 MCP, the parts: parseServerArguments", () => {
	test("the defaults are the network off and a ten-second wait", () => {
		expect(parseServerArguments([])).toEqual({ ok: true, command: "serve", settings: { network: false, waitMs: 10_000, maxInputChars: 1_000_000 } });
		expect(DEFAULT_SETTINGS.network).toBe(false);
	});

	test("--network and --wait, in both spellings", () => {
		expect(parseServerArguments(["--network", "on", "--wait=250"])).toEqual({ ok: true, command: "serve", settings: { network: true, waitMs: 250, maxInputChars: 1_000_000 } });
		expect(parseServerArguments(["--network=off"])).toMatchObject({ ok: true, settings: { network: false } });
		expect(parseServerArguments(["--wait", "0"])).toMatchObject({ ok: true, settings: { waitMs: 0 } });
		expect(parseServerArguments(["--wait", "600000"])).toMatchObject({ ok: true, settings: { waitMs: 600_000 } });
	});

	test("refuses anything else by name", () => {
		for (const bad of [["--network", "yes"], ["--network"], ["--wait", "-1"], ["--wait", "600001"], ["--wait", "1e3"], ["--bogus"], ["notes.md"], ...PROTOTYPE_WORDS.map((w) => [`--${w}`])]) {
			expect(parseServerArguments(bad).ok).toBe(false);
		}
		expect(parseServerArguments(["--bogus"])).toEqual({ ok: false, message: '"--bogus" is not an option solve-mcp knows. Run solve-mcp --help for the list.' });
	});

	test("help and version", () => {
		expect(parseServerArguments(["--help"])).toEqual({ ok: true, command: "help" });
		expect(parseServerArguments(["-V"])).toEqual({ ok: true, command: "version" });
		expect(HELP).toContain("evaluate_expression, evaluate_document, check_document");
	});
});

describe("#774 MCP, the parts: engineOptionsFor", () => {
	const { kit } = recordingKit();

	test("every engine leaves out solve-global-variables and has the network the server was started with", () => {
		const off = engineOptionsFor({}, settings(), kit);
		expect(off.ok && off.options.config).toEqual({ network: { enabled: false } });
		expect(off.ok && off.options.packages!.map((p) => p.name)).not.toContain("solve-global-variables");
		expect(off.ok && off.options.packages!.length).toBe(BUILTIN_PACKAGES.length - 1);
		const on = engineOptionsFor({}, settings({ network: true }), kit);
		expect(on.ok && on.options.config).toEqual({ network: { enabled: true } });
		expect(EXCLUDED_PACKAGES).toEqual(["solve-global-variables"]);
	});

	test("a seed as a number or as text", () => {
		expect(engineOptionsFor({ seed: 42 }, settings(), kit)).toMatchObject({ ok: true, options: { random: { seed: 42 } } });
		expect(engineOptionsFor({ seed: "42" }, settings(), kit)).toMatchObject({ ok: true, options: { random: { seed: 42 } } });
		expect(engineOptionsFor({ seed: "seven" }, settings(), kit)).toMatchObject({ ok: true, options: { random: { seed: "seven" } } });
		for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, ""]) {
			expect(engineOptionsFor({ seed: bad }, settings(), kit)).toMatchObject({ ok: false, outcome: { ok: false, error: { code: "INPUT_INVALID" } } });
		}
	});

	test("a zone and a clock, and their refusals", () => {
		const pinned = engineOptionsFor({ tz: "Asia/Tokyo", now: "2026-01-01T09:00:00Z" }, settings(), kit);
		expect(pinned.ok && pinned.options.calendar).toBeDefined();
		expect(engineOptionsFor({ now: 0 }, settings(), kit).ok).toBe(true);
		for (const pins of [{ tz: "Europe/Atlantis" }, { tz: "" }, { now: "tomorrow" }, { now: "2026-01-01T09:00" }, { now: 9e15 }, ...PROTOTYPE_WORDS.map((tz) => ({ tz }))]) {
			expect(engineOptionsFor(pins, settings(), kit)).toMatchObject({ ok: false, outcome: { error: { code: ServerErrorCodes.INPUT_INVALID } } });
		}
	});
});

describe("#774 MCP, the parts: toCallResult", () => {
	test("an answer is structured content and text, and a refusal is marked as an error", () => {
		expect(toCallResult({ ok: true, body: { ok: true, n: 1 } })).toEqual({ content: [{ type: "text", text: '{"ok":true,"n":1}' }], structuredContent: { ok: true, n: 1 }, isError: false });
		expect(toCallResult({ ok: false, error: { code: "X", message: "m" } })).toEqual({
			content: [{ type: "text", text: '{"error":{"code":"X","message":"m"}}' }],
			structuredContent: { error: { code: "X", message: "m" } },
			isError: true,
		});
	});
});

describe("#774 MCP, the tools", () => {
	test("evaluate_expression answers with the value as Value.toJSON writes it", async () => {
		const { kit, built } = recordingKit();
		expect(body(await evaluateExpressionTool({ expression: "5 km in miles" }, settings(), kit))).toEqual({
			expression: "5 km in miles",
			status: "answered",
			display: "= 3.11 miles",
			code: null,
			value: { type: 6, value: 3.1068559611866697, unit: "miles" },
			ok: true,
		});
		expect(body(await evaluateExpressionTool({ expression: "check 1 == 2" }, settings(), kit))).toMatchObject({ status: "failed", code: "CHECK_FAILED", ok: false });
		expect(body(await evaluateExpressionTool({ expression: "hello there" }, settings(), kit))).toMatchObject({ status: "not-read", code: "UNEXPECTED_TRAILING_TOKEN", ok: false });
		expect(built.map((b) => b.clears)).toEqual([1, 1, 1]);
	});

	test("evaluate_document gives every line, and the cross-line forms resolve", async () => {
		const { kit } = recordingKit();
		const note = "# Budget\n\nThe rent went up.\n:price = 100\nprice * 1.25\nsolve line 5 for price = 150\nlunch $12 #food\ndinner $30 #food\ntotal of #food\n";
		const b = body(await evaluateDocumentTool({ document: note }, settings(), kit));
		expect(b.lines.map((l: { display: string }) => l.display)).toEqual([
			'Expected an operator or the end of the line, but found "rent"',
			"= 100",
			"= 125",
			"= 120",
			"= $12.00",
			"= $30.00",
			"= $42.00",
		]);
		expect(b).toMatchObject({ failed: 0, ok: true });
		expect(body(await evaluateDocumentTool({ document: note, strict: true }, settings(), kit))).toMatchObject({ failed: 1, ok: false });
	});

	test("check_document: a passing, a failing and an approximate check", async () => {
		const { kit } = recordingKit();
		const b = body(await checkDocumentTool({ document: ":price = 4\n:qty = 3\ncheck price * qty == 12\ncheck price == 5\ncheck 22/7 \u2248 pi within 0.1%\n" }, settings(), kit));
		expect(b).toMatchObject({ passed: 2, failed: 1, unevaluated: 0, pending: 0, ok: false });
		expect(b.checks[1]).toEqual({ line: 4, text: "check price == 5", status: "failed", display: "check failed: 4 is not equal to 5", code: "CHECK_FAILED" });
		expect(body(await checkDocumentTool({ document: "check 1 == 1\n" }, settings(), kit)).ok).toBe(true);
		expect(body(await checkDocumentTool({ document: "1 + 1\n" }, settings(), kit))).toMatchObject({ checks: [], ok: true });
	});

	test("pins: --now and tz, and a seed that repeats", async () => {
		const { kit } = recordingKit();
		expect(body(await evaluateExpressionTool({ expression: "today", tz: "Asia/Tokyo", now: "2026-01-01T09:00:00Z" }, settings(), kit)).display).toBe("= Thursday, January 1, 2026, 6:00:00 PM");
		expect(body(await evaluateExpressionTool({ expression: "now", now: "2026-03-29T01:00:00Z", tz: "Europe/London" }, settings(), kit)).display).toBe("= Sunday, March 29, 2026, 2:00:00 AM");
		const a = body(await evaluateExpressionTool({ expression: "roll(1, 1000000)", seed: 42 }, settings(), kit));
		const b = body(await evaluateExpressionTool({ expression: "roll(1, 1000000)", seed: "42" }, settings(), kit));
		expect(a.display).toBe(b.display);
	});

	test("the network is off unless the server was started with it on", async () => {
		const { kit } = recordingKit();
		expect(body(await evaluateExpressionTool({ expression: "weather in London" }, settings(), kit))).toMatchObject({ status: "failed", code: "NETWORK_DISABLED", ok: false });
	});
});

describe("#774 MCP, one call cannot read what another wrote", () => {
	test("a variable, a user unit and a live answer do not survive the call that made them", async () => {
		const { kit, built } = recordingKit();
		body(await evaluateDocumentTool({ document: ":secret = 42\n1 sprint = 2 weeks\n" }, settings(), kit));
		expect(body(await evaluateExpressionTool({ expression: "secret" }, settings(), kit))).toMatchObject({ status: "not-read", code: "UNDEFINED_VARIABLE" });
		expect(body(await evaluateExpressionTool({ expression: "3 sprints in days" }, settings(), kit)).display).not.toBe("= 42 days");
		expect(new Set(built.map((b) => b.options)).size).toBe(built.length);
		expect(built.every((b) => b.clears === 1)).toBe(true);
	});

	test("global variables are refused as syntax, where an engine with the package would read them back", async () => {
		const { kit } = recordingKit();
		const write = body(await evaluateDocumentTool({ document: "global :mcp774 = 42\n" }, settings(), kit));
		expect(write.lines[0]).toMatchObject({ status: "not-read", code: "NO_PREFIX_PARSELET" });
		const read = body(await evaluateExpressionTool({ expression: "global :mcp774" }, settings(), kit));
		expect(read).toMatchObject({ status: "not-read", code: "NO_PREFIX_PARSELET" });

		// The control: two engines with the package share the store, which is
		// exactly what the server's engines must not.
		const writer = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		writer.parseDocument("global :mcp774control = 42");
		const reader = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		expect(reader.formatValue(reader.evaluateExpression("global :mcp774control"))).toBe("= 42");
		writer.clear();
		reader.clear();
	});
});

describe("#774 MCP, over the protocol", () => {
	test("lists the three tools with their schemas and read-only hints", async () => {
		const { kit } = recordingKit();
		const { client, close } = await connect(kit);
		const { tools } = await client.listTools();
		expect(tools.map((t: { name: string }) => t.name)).toEqual(["evaluate_expression", "evaluate_document", "check_document"]);
		expect(tools[0].inputSchema.required).toEqual(["expression"]);
		expect(tools[1].inputSchema.required).toEqual(["document"]);
		expect(tools[0].annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
		await close();
	});

	test("a call answers with structured content", async () => {
		const { kit } = recordingKit();
		const { call, close } = await connect(kit);
		const r = await call("evaluate_expression", { expression: "20% of $85" });
		expect(r.isError).toBe(false);
		expect(r.structuredContent).toMatchObject({ display: "= $17.00", ok: true });
		expect(JSON.parse((r.content as { text: string }[])[0].text)).toEqual(r.structuredContent);
		await close();
	});

	test("a hostile document that hits the engine's limits is a coded refusal, and the next call is unaffected", async () => {
		const { kit, built } = recordingKit();
		const { call, close } = await connect(kit);
		const big = await call("evaluate_document", { document: "1\n".repeat(100_001) });
		expect(big.isError).toBe(true);
		expect(big.structuredContent).toMatchObject({ error: { code: "DOCUMENT_TOO_LARGE" } });
		const next = await call("evaluate_expression", { expression: "2 + 2" });
		expect(next.structuredContent).toMatchObject({ display: "= 4", ok: true });
		const deep = await call("evaluate_expression", { expression: RESOURCE_PROBES.deepParens() });
		expect(deep.structuredContent).toMatchObject({ ok: false });
		expect((deep.structuredContent as { code: string }).code).toMatch(/^[A-Z_]+$/);
		expect((await call("check_document", { document: "check 1 == 1" })).structuredContent).toMatchObject({ ok: true });
		expect(built.every((b) => b.clears === 1)).toBe(true);
		await close();
	}, 30_000);

	test("an input past the server's size limit is refused before an engine is built", async () => {
		const { kit, built } = recordingKit();
		const { call, close } = await connect(kit, settings({ maxInputChars: 1000 }));
		const r = await call("evaluate_document", { document: "1\n".repeat(600) });
		expect(r.structuredContent).toEqual({ error: { code: "INPUT_TOO_LARGE", message: "The document is 1200 characters, and this server accepts at most 1000." } });
		expect(built).toEqual([]);
		await close();
	});

	test("arguments of the wrong type are refused by the protocol, and the server keeps answering", async () => {
		const { kit } = recordingKit();
		const { call, close } = await connect(kit);
		for (const args of [{ expression: 5 }, {}, { expression: "1", tz: 5 }, { document: null }]) {
			const r = await call("evaluate_expression", args as Record<string, unknown>);
			expect(r.isError).toBe(true);
		}
		expect((await call("evaluate_expression", { expression: "1 + 1" })).structuredContent).toMatchObject({ ok: true });
		await close();
	});
});

describe("#774 MCP, live data under --network on", () => {
	test("a live line is waited for", async () => {
		const { kit } = recordingKit([probePackage(slowLength(20))]);
		expect(body(await evaluateExpressionTool({ expression: "lookup abcde" }, settings({ network: true }), kit))).toMatchObject({ display: "= 43", ok: true });
	});

	test("a live line that never answers ends within the wait, as pending", async () => {
		const { kit, built } = recordingKit([probePackage(never, { timeoutMs: 200 })]);
		const started = Date.now();
		const b = body(await evaluateDocumentTool({ document: "1 + 1\nlookup abcde\n" }, settings({ network: true, waitMs: 150 }), kit));
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(b.lines.map((l: { status: string }) => l.status)).toEqual(["answered", "pending"]);
		expect(b.lines[1].display).toBe("no answer from live data within 150 ms");
		expect(b.ok).toBe(false);
		expect(built[0].clears).toBe(1);
	});

	test("calls in flight at once each have their own engine", async () => {
		const { kit, built } = recordingKit([probePackage(slowLength(30))]);
		const s = settings({ network: true });
		const [a, b, c] = await Promise.all([
			evaluateExpressionTool({ expression: "lookup ab" }, s, kit),
			evaluateExpressionTool({ expression: "lookup abcd" }, s, kit),
			evaluateDocumentTool({ document: ":x = 1\nx + lookup a" }, s, kit),
		]);
		expect([body(a).display, body(b).display, body(c).lines[1].display]).toEqual(["= 40", "= 42", "= 40"]);
		expect(built.length).toBe(3);
	});
});

describe("#774 engine.clear() with a fetch still in flight", () => {
	/**
	 * Run `body` with every timer it starts recorded, and return those still
	 * pending with a hold on the event loop. Counting the process's timers
	 * instead let one left by another suite in the same serial run move the
	 * count by one while this test ran, which failed it on CI with nothing wrong.
	 */
	async function timersHeldAfter(body: () => Promise<void>): Promise<NodeJS.Timeout[]> {
		const started: NodeJS.Timeout[] = [];
		const realSetTimeout = globalThis.setTimeout;
		globalThis.setTimeout = ((handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
			const t = realSetTimeout(handler, ms, ...args);
			started.push(t);
			return t;
		}) as typeof setTimeout;
		try {
			await body();
		} finally {
			globalThis.setTimeout = realSetTimeout;
		}
		return started.filter((t) => !(t as unknown as { _destroyed?: boolean })._destroyed && t.hasRef());
	}

	/** An engine with the probe, its batcher hook wired. */
	function probeEngine(pkg: IEnginePackage): ExpressionEngine {
		const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, pkg] });
		engine.getBatcher().onLineResult = () => {};
		return engine;
	}

	test("a fetch that times out after clear() leaves no collection timer behind", async () => {
		const held = await timersHeldAfter(async () => {
			const engine = probeEngine(probePackage(never, { timeoutMs: 40 }));
			expect(engine.evaluateExpression("lookup abcde").isPending()).toBe(true);
			engine.clear();
			// Past the fetch's own timeout: before the fix its settling armed a
			// ten-minute timer on a query the cleared cache no longer held.
			await later(120);
		});
		expect(held).toHaveLength(0);
	});

	test("a fetch that fails after clear() is not retried", async () => {
		let calls = 0;
		const failing = async (): Promise<Value> => {
			calls++;
			await later(20);
			throw new Error("upstream down");
		};
		const engine = probeEngine(probePackage(failing));
		engine.evaluateExpression("lookup abcde");
		engine.clear();
		await later(1_500);
		expect(calls).toBe(1);
	});

	test("a fetch that answers after clear() does not reach the next document, and holds no timer", async () => {
		const engine = probeEngine(probePackage(slowLength(30)));
		const held = await timersHeldAfter(async () => {
			engine.evaluateExpression("lookup abcde");
			engine.clear();
			expect(engine.formatValue(engine.evaluateExpression("2 + 2"))).toBe("= 4");
			await later(100);
		});
		expect(held).toHaveLength(0);
		engine.clear();
	});

	test("the recorder sees a held timer: an engine nobody clears keeps its query's collection timer", async () => {
		const engine = probeEngine(probePackage(slowLength(5)));
		const held = await timersHeldAfter(async () => {
			engine.evaluateExpression("lookup abcde");
			await engine.settle();
		});
		expect(held.length).toBeGreaterThan(0);
		engine.clear();
		await later(20);
		expect(held.filter((t) => !(t as unknown as { _destroyed?: boolean })._destroyed && t.hasRef())).toHaveLength(0);
	});

	test("clear() on an engine that never fetched, and twice in a row", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		expect(() => {
			engine.clear();
			engine.clear();
		}).not.toThrow();
		expect(engine.formatValue(engine.evaluateExpression("1 + 1"))).toBe("= 2");
		engine.clear();
	});
});

describe("#774 MCP, adversarial", () => {
	test("prototype words as expressions, documents, zones and seeds leave Object.prototype alone", async () => {
		const { kit } = recordingKit();
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		for (const word of PROTOTYPE_WORDS) {
			for (const outcome of [
				await evaluateExpressionTool({ expression: word }, settings(), kit),
				await evaluateDocumentTool({ document: `${word}\n:${word} = 5\n${word} * 2\n` }, settings(), kit),
				await checkDocumentTool({ document: `check ${word} == 5` }, settings(), kit),
				await evaluateExpressionTool({ expression: "roll(1, 6)", seed: word }, settings(), kit),
			]) {
				expect(outcome.ok).toBe(true);
				expectNoLeak(outcome);
			}
			expect((await evaluateExpressionTool({ expression: "today", tz: word }, settings(), kit)).ok).toBe(false);
		}
		expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
	});

	test("the resource probes end within their budget", async () => {
		const { kit } = recordingKit();
		for (const probe of [RESOURCE_PROBES.longSum(), RESOURCE_PROBES.deepParens(), RESOURCE_PROBES.hugePower(), RESOURCE_PROBES.hugeRange(), RESOURCE_PROBES.longText(), RESOURCE_PROBES.longIdentifier()]) {
			const started = Date.now();
			const outcome = await evaluateExpressionTool({ expression: probe }, settings(), kit);
			expect(Date.now() - started).toBeLessThan(5_000);
			expectNoLeak(outcome);
		}
		const many = body(await evaluateDocumentTool({ document: RESOURCE_PROBES.manyLines() }, settings(), kit));
		expect(many.lines[many.lines.length - 1].display).toBe("= 2,001");
	}, 60_000);

	test("the numeric, text and document edges end honestly", async () => {
		const { kit } = recordingKit();
		for (const edge of NUMERIC_EDGES) {
			const outcome = await evaluateExpressionTool({ expression: edge }, settings(), kit);
			expect(outcome.ok).toBe(true);
			expectNoLeak(outcome);
		}
		for (const edge of TEXT_EDGES) {
			const outcome = await evaluateExpressionTool({ expression: edge }, settings(), kit);
			if (edge.trim() === "") expect(outcome).toMatchObject({ ok: false, error: { code: "INPUT_INVALID" } });
			else expect(outcome.ok).toBe(true);
			expectNoLeak(outcome);
		}
		for (const edge of DOCUMENT_EDGES) {
			const outcome = await evaluateDocumentTool({ document: edge }, settings(), kit);
			expect(outcome.ok).toBe(true);
			expectNoLeak(outcome);
		}
	});

	test("escape sequences and direction overrides come back as data, unchanged", async () => {
		const { kit } = recordingKit();
		const note = "\u001b[2J:a = 5\n\u202ea * 2\n<script>alert(1)</script>\n";
		const b = body(await evaluateDocumentTool({ document: note }, settings(), kit));
		expect(b.lines[0].text).toBe("\u001b[2J:a = 5");
		expect(b.lines.map((l: { text: string }) => l.text)).toEqual(["\u001b[2J:a = 5", "\u202ea * 2", "<script>alert(1)</script>"]);
	});

	test("realistic breakage: a typo, a unit that does not fit, CRLF, a check over a line reference", async () => {
		const { kit } = recordingKit();
		const b = body(await evaluateDocumentTool({ document: ":d = 5 km\r\nd in mlies\r\nd + 3 kg\r\nd in miles\r\ncheck line 4 > 3 miles\r\n" }, settings(), kit));
		expect(b.lines.map((l: { status: string }) => l.status)).toEqual(["answered", b.lines[1].status, "failed", "answered", "answered"]);
		expect(b.lines[3].display).toBe("= 3.11 miles");
		expect(b.lines[4].display).toBe("= \u2713");
	});

	test("an empty expression is refused rather than answered 0", async () => {
		const { kit, built } = recordingKit();
		expect(await evaluateExpressionTool({ expression: "   " }, settings(), kit)).toEqual({ ok: false, error: { code: "INPUT_INVALID", message: "The expression is empty." } });
		expect(built).toEqual([]);
		expect(body(await evaluateDocumentTool({ document: "" }, settings(), kit))).toEqual({ lines: [], failed: 0, ok: true });
	});
});

/** The words a hostile client could send where the server looks a name up. */
const PROTOCOL_WORDS = [...PROTOTYPE_WORDS, "hasOwnProperty", "valueOf"];

/** The parsed answer to one raw message, or `undefined` when none came back. */
async function raw(server: ReturnType<typeof createSolveServer>, text: string) {
	const reply = await server.handle(text);
	return reply === undefined ? undefined : JSON.parse(reply);
}

describe("#774 MCP, the parts: the protocol handler", () => {
	test("initialize answers with the client's protocol version when it is one the server speaks, and its newest otherwise", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		for (const version of PROTOCOL_VERSIONS) {
			const m = await raw(server, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version } }));
			expect(m.result).toEqual({ protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "solve", version: "9.9.9" } });
		}
		for (const asked of ["1999-01-01", 5, undefined, "constructor"]) {
			const m = await raw(server, JSON.stringify({ jsonrpc: "2.0", id: "a", method: "initialize", params: { protocolVersion: asked } }));
			expect(m.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
		}
	});

	test("ping answers with an empty object, under the request's own id, string or number", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		expect(await raw(server, '{"jsonrpc":"2.0","id":7,"method":"ping"}')).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
		expect(await raw(server, '{"jsonrpc":"2.0","id":"x-1","method":"ping"}')).toEqual({ jsonrpc: "2.0", id: "x-1", result: {} });
		expect(await raw(server, '{"jsonrpc":"2.0","id":0,"method":"ping"}')).toEqual({ jsonrpc: "2.0", id: 0, result: {} });
	});

	test("notifications and the client's own answers get nothing back", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		for (const text of [
			'{"jsonrpc":"2.0","method":"notifications/initialized"}',
			'{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}',
			'{"jsonrpc":"2.0","method":"no/such/notification"}',
			'{"jsonrpc":"2.0","id":3,"result":{}}',
		]) {
			expect(await server.handle(text)).toBeUndefined();
		}
	});

	test("an unknown method and an unknown tool are JSON-RPC errors, with the name quoted and capped", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		const method = await raw(server, '{"jsonrpc":"2.0","id":1,"method":"resources/list"}');
		expect(method.error).toEqual({ code: RpcErrorCodes.METHOD_NOT_FOUND, message: 'This server does not offer "resources/list".' });
		const tool = await raw(server, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "x".repeat(10_000) } }));
		expect(tool.error.code).toBe(RpcErrorCodes.INVALID_PARAMS);
		expect(tool.error.message.length).toBeLessThan(300);
		const unnamed = await raw(server, '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{}}');
		expect(unnamed.error).toEqual({ code: RpcErrorCodes.INVALID_PARAMS, message: "tools/call needs the name of a tool." });
	});

	test("text that is not a JSON-RPC request is refused under id null, or under its id when it has one", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		expect((await raw(server, "not json")).error.code).toBe(RpcErrorCodes.PARSE_ERROR);
		expect((await raw(server, "{")).error.code).toBe(RpcErrorCodes.PARSE_ERROR);
		for (const text of ["[]", '[{"jsonrpc":"2.0","id":1,"method":"ping"}]', "5", '"ping"', "null"]) {
			const m = await raw(server, text);
			expect(m).toEqual({ jsonrpc: "2.0", id: null, error: { code: RpcErrorCodes.INVALID_REQUEST, message: "The message must be one JSON-RPC object." } });
		}
		expect((await raw(server, '{"id":1,"method":"ping"}')).error.code).toBe(RpcErrorCodes.INVALID_REQUEST);
		expect((await raw(server, '{"jsonrpc":"1.0","id":1,"method":"ping"}')).id).toBe(1);
		expect((await raw(server, '{"jsonrpc":"2.0","id":1,"method":5}')).error.code).toBe(RpcErrorCodes.INVALID_REQUEST);
		expect((await raw(server, '{"jsonrpc":"2.0","id":1,"method":"ping","params":[1]}')).error.code).toBe(RpcErrorCodes.INVALID_REQUEST);
		expect((await raw(server, '{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}')).error.code).toBe(RpcErrorCodes.INVALID_REQUEST);
		expect((await raw(server, '{"jsonrpc":"2.0","id":null,"method":"ping"}')).error.code).toBe(RpcErrorCodes.INVALID_REQUEST);
		expect((await raw(server, '{"jsonrpc":"2.0"}')).error.code).toBe(RpcErrorCodes.INVALID_REQUEST);
	});

	test("arguments that are not an object, or absent, are a coded refusal rather than a protocol error", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		for (const args of [5, "1 + 1", [1], null]) {
			const r = await server.callTool("evaluate_expression", args);
			expect(r).toMatchObject({ isError: true, structuredContent: { error: { code: "INPUT_INVALID" } } });
		}
		expect(await server.callTool("evaluate_expression", undefined)).toMatchObject({ isError: true, structuredContent: { error: { message: "expression must be text." } } });
		expect(await server.callTool("no_such_tool", {})).toBeUndefined();
	});

	test("each pin is checked against its schema: tz text, now and seed a finite number or short text, strict a boolean", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		const refused = async (name: string, args: Record<string, unknown>) => (await server.callTool(name, args))?.structuredContent;
		expect(await refused("evaluate_expression", { expression: "1", tz: 5 })).toMatchObject({ error: { code: "INPUT_INVALID" } });
		expect(await refused("evaluate_expression", { expression: "1", tz: "x".repeat(201) })).toMatchObject({ error: { code: "INPUT_INVALID" } });
		expect(await refused("evaluate_expression", { expression: "1", now: true })).toMatchObject({ error: { code: "INPUT_INVALID" } });
		expect(await refused("evaluate_expression", { expression: "1", seed: { a: 1 } })).toMatchObject({ error: { code: "INPUT_INVALID" } });
		expect(await refused("evaluate_document", { document: "1", strict: "yes" })).toMatchObject({ error: { message: "strict must be true or false." } });
		expect(await refused("evaluate_expression", { expression: "1", tz: "UTC", now: "2026-01-01T09:00:00Z", seed: 4 })).toMatchObject({ ok: true });
		// An argument the tool does not read is ignored, as a schema without additionalProperties allows.
		expect(await refused("evaluate_expression", { expression: "1", colour: "red" })).toMatchObject({ ok: true });
	});

	test("tools/list gives each tool a JSON Schema object with its required argument and the shared pins", () => {
		const { tools } = createSolveServer(recordingKit().kit, settings({ network: true })).listTools() as { tools: Record<string, any>[] };
		for (const tool of tools) {
			expect(tool.inputSchema.type).toBe("object");
			expect(Object.keys(tool.inputSchema.properties)).toEqual(expect.arrayContaining(["tz", "now", "seed"]));
			expect(tool.annotations).toEqual({ readOnlyHint: true, idempotentHint: false, openWorldHint: true });
		}
		expect(tools[2].inputSchema.required).toEqual(["document"]);
	});
});

describe("#774 MCP, the parts: the line framing", () => {
	const collect = (maxChars?: number) => {
		const lines: string[] = [];
		let overflows = 0;
		const reader = createLineReader((line) => lines.push(line), () => overflows++, maxChars);
		return { reader, lines, overflows: () => overflows };
	};

	test("splits on newlines, drops a trailing carriage return and skips blank lines", () => {
		const { reader, lines } = collect();
		reader.push("a\nb\r\n\n   \r\nc");
		expect(lines).toEqual(["a", "b"]);
		reader.end();
		expect(lines).toEqual(["a", "b", "c"]);
	});

	test("joins a line, and a character, split across chunks", () => {
		const { reader, lines } = collect();
		const bytes = new TextEncoder().encode('{"t":"£ 😀"}\n');
		for (const byte of bytes) reader.push(new Uint8Array([byte]));
		expect(lines).toEqual(['{"t":"£ 😀"}']);
	});

	test("a line past the limit is dropped and reported once, and the next line reads normally", () => {
		const { reader, lines, overflows } = collect(10);
		reader.push("x".repeat(6));
		reader.push("x".repeat(6));
		reader.push("x".repeat(100));
		reader.push("\nok\n");
		expect(overflows()).toBe(1);
		expect(lines).toEqual(["ok"]);
		reader.push("y".repeat(11) + "\nfine\n");
		expect(overflows()).toBe(2);
		expect(lines).toEqual(["ok", "fine"]);
		const exact = collect(10);
		exact.reader.push("z".repeat(10) + "\n");
		expect(exact.lines).toEqual(["z".repeat(10)]);
	});

	test("the limit is large enough for the server's largest input written as escapes", () => {
		expect(MAX_MESSAGE_CHARS).toBeGreaterThan(DEFAULT_SETTINGS.maxInputChars * 6);
	});

	test("serveLines answers each request on its own line and stays quiet for notifications", async () => {
		const out: string[] = [];
		const lines = serveLines(createSolveServer(recordingKit().kit, settings()), (line) => out.push(line));
		lines.push('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
		lines.push(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "evaluate_expression", arguments: { expression: "2 + 2" } } }));
		lines.end();
		await lines.settled();
		expect(out.every((line) => line.endsWith("\n") && !line.slice(0, -1).includes("\n"))).toBe(true);
		const byId = new Map(out.map((line) => JSON.parse(line)).map((m) => [m.id, m]));
		expect(out).toHaveLength(2);
		expect(byId.get(1).result).toEqual({});
		expect(byId.get(2).result.structuredContent).toMatchObject({ display: "= 4", ok: true });
	});

	test("serveLines answers an overlong line with an error under id null and keeps serving", async () => {
		const out: string[] = [];
		const lines = serveLines(createSolveServer(recordingKit().kit, settings()), (line) => out.push(line));
		lines.push("x".repeat(MAX_MESSAGE_CHARS + 1));
		lines.push('\n{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
		await lines.settled();
		expect(JSON.parse(out[0])).toMatchObject({ id: null, error: { code: RpcErrorCodes.INVALID_REQUEST } });
		expect(JSON.parse(out[1])).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
	});
});

describe("#774 MCP, portable", () => {
	test("only bin.ts touches a Node API; the protocol and the framing use web standards", () => {
		const fs = require("node:fs") as typeof import("node:fs");
		const path = require("node:path") as typeof import("node:path");
		const dir = path.join(__dirname, "..", "..", "..", "mcp", "src");
		const files = fs.readdirSync(dir).filter((name) => name.endsWith(".ts") && name !== "bin.ts");
		expect(files).toEqual(expect.arrayContaining(["server.ts", "transport.ts", "tools.ts", "options.ts"]));
		for (const name of files) {
			const code = fs.readFileSync(path.join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
			expect([name, /from\s+["']node:|require\(|\bprocess\.|\bBuffer\b|__dirname/.test(code)]).toEqual([name, false]);
		}
	});

	test("the server's package depends on the engine and nothing else", () => {
		const fs = require("node:fs") as typeof import("node:fs");
		const path = require("node:path") as typeof import("node:path");
		const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "mcp", "package.json"), "utf8"));
		expect(Object.keys(pkg.dependencies)).toEqual(["solve-engine"]);
	});
});

describe("#774 MCP, adversarial: the protocol", () => {
	test("prototype words as methods, tool names, ids and argument keys leave Object.prototype alone and are refused by name", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		for (const word of PROTOCOL_WORDS) {
			expect((await raw(server, JSON.stringify({ jsonrpc: "2.0", id: 1, method: word }))).error.code).toBe(RpcErrorCodes.METHOD_NOT_FOUND);
			expect((await raw(server, JSON.stringify({ jsonrpc: "2.0", id: word, method: "tools/call", params: { name: word } }))).error.code).toBe(RpcErrorCodes.INVALID_PARAMS);
		}
		// Arguments whose only keys are inherited names: the expression is missing, not read off the prototype.
		const inherited = await raw(server, '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"evaluate_expression","arguments":{"__proto__":{"expression":"6 * 7"}}}}');
		expect(inherited.result).toMatchObject({ isError: true, structuredContent: { error: { code: "INPUT_INVALID" } } });
		const protoParams = await raw(server, '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"__proto__":{"name":"evaluate_expression"}}}');
		expect(protoParams.error.code).toBe(RpcErrorCodes.INVALID_PARAMS);
		expect(await server.handle('{"__proto__":{"jsonrpc":"2.0","id":4,"method":"ping"}}')).toContain('"code":-32600');
		expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
	});

	test("markup, escapes and direction overrides in method names come back as quoted text", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		const m = await raw(server, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "<script>‮\u001b[2J" }));
		expect(m.error.message).toBe(`This server does not offer ${JSON.stringify("<script>‮\u001b[2J")}.`);
	});

	test("a thousand requests at once are each answered once, under their own id", async () => {
		const out: string[] = [];
		const lines = serveLines(createSolveServer(recordingKit().kit, settings()), (line) => out.push(line));
		let text = "";
		for (let id = 0; id < 1000; id++) text += JSON.stringify({ jsonrpc: "2.0", id, method: id % 2 ? "ping" : "tools/list" }) + "\n";
		lines.push(text);
		await lines.settled();
		const ids = out.map((line) => JSON.parse(line).id).sort((a, b) => a - b);
		expect(ids).toEqual(Array.from({ length: 1000 }, (_, i) => i));
	});

	test("numeric edges as ids are echoed back as JSON writes them", async () => {
		const server = createSolveServer(recordingKit().kit, settings());
		for (const id of [-0, -1, 2 ** 53, Number.MAX_VALUE, Number.MIN_VALUE, 1.5]) {
			expect((await raw(server, JSON.stringify({ jsonrpc: "2.0", id, method: "ping" }))).id).toBe(JSON.parse(JSON.stringify(id)));
		}
	});
});
