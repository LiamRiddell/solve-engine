import { afterEach, describe, expect, test } from "@jest/globals";
import {
	createLinkedTransports,
	createWorkerEngine,
	serializeExplanation,
	serializeLineTrace,
	serializeParsingResult,
	startWorkerRuntime,
	type WorkerEngine,
	type WorkerTransport,
} from "@solve-js/worker";
import { EngineError, WorkerErrorCodes, workerArgumentError } from "@solve-js/errors";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { LanguageService } from "@solve-js/language/LanguageService";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES } from "@tools/adversarial";

/**
 * Issue #770: the worker client proxied three methods (parseDocument,
 * evaluateLines, evaluateExpression), and parseDocument is the batch pass that
 * refuses goal seek, so a host that moved evaluation off the main thread lost
 * goal seek and could not reach whatIf, explainLine, traceLine or the language
 * service without a second engine on the main thread.
 *
 * The client now also proxies evaluateDocument (goal seek resolves), whatIf,
 * explainLine, traceLine and settle, and the language service's editor calls
 * (getSemanticTokens, getCompletions, findReferences, getDefinition, rename,
 * shiftLineReferences). Each returns a clone-safe DTO, and a call whose
 * arguments postMessage cannot copy is refused main-side with
 * WORKER_ARGUMENT_NOT_CLONEABLE rather than a raw DataCloneError.
 */

const GOAL_SEEK = [
	":deposit = 100000",
	":rate = 4%",
	"monthly repayment on deposit over 25 years at rate",
	"solve line 3 for deposit = 900",
].join("\n");

const disposers: Array<() => void> = [];

afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

/** A worker client and runtime linked on one thread. */
async function worker(): Promise<WorkerEngine> {
	const { client, host } = createLinkedTransports();
	const stop = startWorkerRuntime(host);
	const engine = await createWorkerEngine({ transport: client });
	disposers.push(() => {
		engine.terminate();
		stop();
	});
	return engine;
}

/** The same document through the main thread's evaluateDocument, as the worker's DTO. */
function mainThread(text: string) {
	const engine = newTrackedEngine();
	return serializeParsingResult(evaluateDocument(engine, text), engine.getFormattingSettings());
}

// ── The new methods, one by one ──────────────────────────────────────────

describe("the worker's new methods", () => {
	test("evaluateDocument resolves goal seek, where parseDocument refuses", async () => {
		const w = await worker();
		const doc = await w.evaluateDocument(GOAL_SEEK);
		expect(doc.lines[3].result?.text).toBe("= 170,507.23");
		const batch = await w.parseDocument(GOAL_SEEK);
		expect(batch.lines[3].result?.errorCode).toBe("GOAL_SEEK_NO_DOCUMENT");
	});

	test("evaluateDocument agrees with the main thread value for value", async () => {
		const w = await worker();
		expect(await w.evaluateDocument(GOAL_SEEK)).toEqual(mainThread(GOAL_SEEK));
	});

	test("whatIf re-runs the document with an input changed", async () => {
		const w = await worker();
		const text = ":price = 200\n:qty = 3\nprice * qty";
		const scenario = await w.whatIf(text, { qty: 5 });
		expect(scenario.lines[2].result?.text).toBe("= 1,000");
		const engine = newTrackedEngine();
		expect(scenario).toEqual(serializeParsingResult(engine.whatIf(text, { qty: 5 }), engine.getFormattingSettings()));
	});

	test("whatIf accepts text an override evaluates on its own", async () => {
		const w = await worker();
		const scenario = await w.whatIf(":price = $200\n:qty = 3\nprice * qty", { price: "$120" });
		expect(scenario.lines[2].result?.text).toBe("= $360.00");
	});

	test("explainLine returns the derivation as a DTO, as the main thread explains it", async () => {
		const w = await worker();
		const explanation = await w.explainLine("80 - 20% + 20%");
		expect(explanation.steps.length).toBeGreaterThan(0);
		const main = newTrackedEngine();
		expect(explanation.result.text).toBe(main.formatValue(main.evaluateExpression("80 - 20% + 20%")));
		const engine = newTrackedEngine();
		expect(explanation).toEqual(serializeExplanation(engine.explainLine("80 - 20% + 20%"), engine.getFormattingSettings()));
	});

	test("traceLine follows a line's inputs through the incremental pass", async () => {
		const w = await worker();
		const text = ":a = 5\n:b = a * 2\nb + 1";
		const trace = await w.traceLine(text, 3);
		expect(trace.line).toBe(3);
		expect(trace.inputs.map((i) => i.line)).toEqual([2]);
		expect(trace.inputs[0].inputs.map((i) => i.line)).toEqual([1]);
		const engine = newTrackedEngine();
		const document = evaluateDocument(engine, text);
		expect(trace).toEqual(serializeLineTrace(engine.traceLine(3, { document }), engine.getFormattingSettings()));
	});

	test("traceLine of the document just evaluated reads its answers, goal seek included", async () => {
		const w = await worker();
		await w.evaluateDocument(GOAL_SEEK);
		const trace = await w.traceLine(GOAL_SEEK, 4);
		expect(trace.value?.text).toBe("= 170,507.23");
	});

	test("settle resolves at once with nothing in flight", async () => {
		const w = await worker();
		await expect(w.settle({ timeoutMs: 100 })).resolves.toBeUndefined();
	});

	test("settle carries the engine's refusal of a bad timeout, coded", async () => {
		const w = await worker();
		await expect(w.settle({ timeoutMs: -1 })).rejects.toMatchObject({ code: "SETTLE_TIMEOUT_INVALID" });
	});

	test("the language service's calls answer as the main-thread service does", async () => {
		const w = await worker();
		const ls = new LanguageService(newTrackedEngine());
		const text = ":rate = 4%\n:base = 100\nbase * rate\nline 3 + 1";
		expect(await w.getSemanticTokens("sha256(\"abc\")", 1)).toEqual(ls.getSemanticTokens("sha256(\"abc\")", 1));
		expect(await w.getCompletions("sha", 3)).toEqual(ls.getCompletions("sha", 3));
		expect(await w.findReferences(text, { line: 1, character: 2 })).toEqual(ls.findReferences(text, { line: 1, character: 2 }));
		expect(await w.getDefinition(text, { line: 3, character: 8 })).toEqual(ls.getDefinition(text, { line: 3, character: 8 }));
		expect(await w.rename(text, { line: 1, character: 2 }, "interest")).toEqual(ls.rename(text, { line: 1, character: 2 }, "interest"));
		expect(await w.shiftLineReferences(text, { kind: "insert", line: 1, count: 1 })).toEqual(ls.shiftLineReferences(text, { kind: "insert", line: 1, count: 1 }));
	});

	test("a rename refusal crosses as the same coded refusal", async () => {
		const w = await worker();
		const refused = await w.rename(":x = 1\nx + 1", { line: 1, character: 1 }, "sqrt");
		expect(refused).toMatchObject({ ok: false, code: "RENAME_KEYWORD" });
	});

	test("the original three methods and their DTO shape are unchanged", async () => {
		const w = await worker();
		const expr = await w.evaluateExpression("2 + 2");
		expect(expr).toEqual({ type: expr.type, text: "= 4", number: 4 });
		const lines = await w.evaluateLines(["1", "line 1 + 1"]);
		expect(lines.map((l) => l.result?.text)).toEqual(["= 1", "= 2"]);
	});
});

// ── The parts ────────────────────────────────────────────────────────────

describe("serializeExplanation and serializeLineTrace", () => {
	test("an explanation with no steps keeps its result", () => {
		const engine = newTrackedEngine();
		const dto = serializeExplanation(engine.explainLine("42"), engine.getFormattingSettings());
		expect(dto).toEqual({ expression: "42", steps: [], result: expect.objectContaining({ text: "= 42", number: 42 }) });
	});

	test("a trace ten thousand levels deep crosses without exhausting the stack", () => {
		type Node = { line: number; name: string | null; value: null; via: string[]; inputs: Node[]; cycle: boolean; forward: boolean; truncated: boolean };
		const root: Node = { line: 1, name: null, value: null, via: [], inputs: [], cycle: false, forward: false, truncated: false };
		let at = root;
		for (let i = 2; i <= 10_000; i++) {
			const next: Node = { line: i, name: null, value: null, via: ["prev"], inputs: [], cycle: false, forward: false, truncated: false };
			at.inputs.push(next);
			at = next;
		}
		const dto = serializeLineTrace(root);
		let depth = 1;
		for (let node = dto; node.inputs.length > 0; node = node.inputs[0]) depth++;
		expect(depth).toBe(10_000);
	});

	test("a trace's lists are copies, so the DTO holds nothing the engine keeps", () => {
		const engine = newTrackedEngine();
		const document = evaluateDocument(engine, ":a = 1\na + 1");
		const trace = engine.traceLine(2, { document });
		const dto = serializeLineTrace(trace);
		expect(dto.via).not.toBe(trace.via);
		expect(dto.inputs[0]).not.toBe(trace.inputs[0]);
	});
});

describe("workerArgumentError", () => {
	test("names the method and the reason, with its code and a validation category", () => {
		const error = workerArgumentError("whatIf", "() => 1 could not be cloned");
		expect(error.code).toBe(WorkerErrorCodes.WORKER_ARGUMENT_NOT_CLONEABLE);
		expect(error.message).toContain('"whatIf"');
		expect(error.message).toContain("could not be cloned");
		expect(error.recoverable).toBe(true);
	});

	test("an empty detail and a markup-shaped method stay text", () => {
		expect(workerArgumentError("<b>x</b>", "").message).toContain("<b>x</b>");
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test("a what-if override that cannot be copied is refused main-side with a code", async () => {
		const w = await worker();
		const overrides = { x: (() => 1) as unknown as number };
		await expect(w.whatIf(":x = 1\nx + 1", overrides)).rejects.toMatchObject({ code: WorkerErrorCodes.WORKER_ARGUMENT_NOT_CLONEABLE });
		// The client is still usable afterwards.
		expect((await w.evaluateExpression("1 + 1")).text).toBe("= 2");
	});

	test("a Value-shaped override arrives as a plain object and is refused by the engine's own code", async () => {
		const w = await worker();
		const overrides = { x: { type: 0, value: 5 } as unknown as number };
		await expect(w.whatIf(":x = 1\nx + 1", overrides)).rejects.toMatchObject({ code: "WHAT_IF_OVERRIDE_INVALID" });
	});

	test("a symbol argument is refused, not thrown raw", async () => {
		const w = await worker();
		const bad = Symbol("x") as unknown as string;
		const outcome = await w.explainLine(bad).then(() => "resolved", (e: unknown) => (e instanceof EngineError ? e.code : `raw ${String(e)}`));
		expect(outcome).toBe(WorkerErrorCodes.WORKER_ARGUMENT_NOT_CLONEABLE);
	});

	test("prototype words through every language call leave Object.prototype alone", async () => {
		const w = await worker();
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		for (const word of PROTOTYPE_WORDS) {
			const text = `:${word} = 1\n${word} + 1`;
			await w.findReferences(text, { line: 2, character: 1 });
			await w.getCompletions(word, word.length);
			await w.rename(text, { line: 1, character: 2 }, "renamed");
			await w.whatIf(":x = 1\nx + 1", { x: 2 });
		}
		expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
	});

	test("a hostile document that meets the engine's limits gets the same coded refusal through the worker", async () => {
		const w = await worker();
		const long = RESOURCE_PROBES.longSum(20_000);
		const engine = newTrackedEngine();
		const main = serializeParsingResult(evaluateDocument(engine, long), engine.getFormattingSettings());
		const off = await w.evaluateDocument(long);
		expect(off.lines[0].errorCode ?? off.lines[0].result?.errorCode).toBe(main.lines[0].errorCode ?? main.lines[0].result?.errorCode);
		expect(off).toEqual(main);
	});

	test("an explanation of a very long sum crosses without a raw error", async () => {
		const w = await worker();
		const outcome = await w.explainLine(RESOURCE_PROBES.longSum(3_000)).then(
			(e) => e.result.text.length > 0,
			(e: unknown) => e instanceof EngineError,
		);
		expect(outcome).toBe(true);
	});

	test.each(TEXT_EDGES)("text edge %p through evaluateDocument agrees with the main thread", async (text) => {
		const w = await worker();
		expect(await w.evaluateDocument(text)).toEqual(mainThread(text));
	});
});

describe("adversarial: realistic breakage", () => {
	test("an AbortSignal fired mid goal seek rejects WORKER_CANCELLED, and the next call answers", async () => {
		const w = await worker();
		const controller = new AbortController();
		const pending = w.evaluateDocument(GOAL_SEEK, { signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: WorkerErrorCodes.WORKER_CANCELLED });
		expect((await w.evaluateDocument(GOAL_SEEK)).lines[3].result?.text).toBe("= 170,507.23");
	});

	test("a signal already aborted rejects without posting", async () => {
		const w = await worker();
		const controller = new AbortController();
		controller.abort();
		await expect(w.whatIf(":x = 1\nx", { x: 2 }, { signal: controller.signal })).rejects.toMatchObject({ code: WorkerErrorCodes.WORKER_CANCELLED });
	});

	test("the worker terminated with a request in flight rejects WORKER_TERMINATED", async () => {
		const w = await worker();
		const pending = w.traceLine(GOAL_SEEK, 4);
		w.terminate();
		await expect(pending).rejects.toMatchObject({ code: WorkerErrorCodes.WORKER_TERMINATED });
		await expect(w.getCompletions("sha", 3)).rejects.toMatchObject({ code: WorkerErrorCodes.WORKER_TERMINATED });
	});

	test("a what-if does not replace the worker's current document", async () => {
		const w = await worker();
		await w.evaluateDocument(":x = 1\nx + 1");
		await w.whatIf(":y = 1\ny * 10", { y: 3 });
		const trace = await w.traceLine(":x = 1\nx + 1", 2);
		expect(trace.value?.text).toBe("= 2");
	});

	test("trace of a line past the end is refused by the engine's code", async () => {
		const w = await worker();
		await expect(w.traceLine("1 + 1", 5)).rejects.toMatchObject({ code: "TRACE_NO_SUCH_LINE" });
	});

	test("explaining a line that does not evaluate is refused by the engine's code", async () => {
		const w = await worker();
		await expect(w.explainLine("2 +")).rejects.toBeInstanceOf(EngineError);
	});

	test("a transport whose postMessage throws for another reason is still a coded refusal", async () => {
		const { client, host } = createLinkedTransports();
		const stop = startWorkerRuntime(host);
		let broken = false;
		const flaky: WorkerTransport = {
			postMessage: (m) => {
				if (broken) throw new Error("channel closed");
				client.postMessage(m);
			},
			onMessage: (h) => client.onMessage(h),
			terminate: () => client.terminate(),
		};
		const w = await createWorkerEngine({ transport: flaky });
		disposers.push(() => {
			w.terminate();
			stop();
		});
		broken = true;
		await expect(w.evaluateDocument("1")).rejects.toMatchObject({ code: WorkerErrorCodes.WORKER_ARGUMENT_NOT_CLONEABLE });
	});
});

describe("adversarial: edge cases", () => {
	test("an empty document and a CRLF document agree with the main thread", async () => {
		const w = await worker();
		for (const text of ["", "\n", "1\r\n2\r\nline 1 + line 2\r\n"]) {
			expect(await w.evaluateDocument(text)).toEqual(mainThread(text));
		}
	});

	test("negative zero crosses as zero through a what-if", async () => {
		const w = await worker();
		const scenario = await w.whatIf(":x = 1\nx * 0", { x: -1 });
		expect(scenario.lines[1].result?.number).toBe(0);
		expect(Object.is(scenario.lines[1].result?.number, -0)).toBe(false);
	});

	test("a non-finite what-if override is refused by the engine's code", async () => {
		const w = await worker();
		await expect(w.whatIf(":x = 1\nx + 1", { x: Number.POSITIVE_INFINITY })).rejects.toMatchObject({ code: "WHAT_IF_OVERRIDE_INVALID" });
	});

	test("a trace bounded to depth one is marked truncated", async () => {
		const w = await worker();
		const trace = await w.traceLine(":a = 1\n:b = a + 1\n:c = b + 1\nc + 1", 4, { maxDepth: 1 });
		expect(JSON.stringify(trace)).toContain('"truncated":true');
	});

	test("every DTO survives structuredClone and JSON", async () => {
		const w = await worker();
		const results: unknown[] = [
			await w.evaluateDocument(GOAL_SEEK),
			await w.explainLine("80 - 20%"),
			await w.traceLine(GOAL_SEEK, 4),
			await w.getCompletions("net pres", 8),
			await w.findReferences(":x = 1\nx", { line: 2, character: 0 }),
		];
		for (const dto of results) {
			expect(structuredClone(dto)).toEqual(dto);
			expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
		}
	});
});
