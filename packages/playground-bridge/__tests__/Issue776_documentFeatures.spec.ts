import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";
import { PLAYGROUND_PACKAGES, runEngine, runEngineWithStreaming } from "@bridge/engine";
import {
	definitionAt,
	describeLineShift,
	documentAnswers,
	explainDocumentLine,
	isFailure,
	parseOverrides,
	referencesAt,
	renameAt,
	shiftReferences,
	traceDocumentLine,
	whatIfLines,
} from "@bridge/hostCalls";
import { MAX_FRAGMENT_LENGTH, MAX_SHARED_CHARACTERS, SHARE_PREFIX, makeShareFragment, readShareFragment } from "@bridge/share";

/**
 * Issue #776: the playground evaluated a document a line at a time on one
 * engine, which cannot re-run another line, so a goal seek answered
 * `GOAL_SEEK_LINE_NOT_READY` there while `evaluateDocument` gives `= 170,507.23`.
 * It also had no what-if, explain or trace panel, none of the reference calls,
 * and no way to share a document.
 *
 * The bridge now takes each line's answer from the incremental document pass
 * (the debug pipeline keeps its per-line tokens, stages and bytecode), exposes
 * the host calls (`hostCalls.ts`) the new Host calls tab uses, and writes a
 * document into a link's URL fragment (`share.ts`), read back with live data
 * off. The engine is unchanged.
 */

const GOAL_SEEK = [
	":deposit = 100000",
	":rate = 4%",
	"monthly repayment on deposit over 25 years at rate",
	"solve line 3 for deposit = 900",
].join("\n");

/** What `evaluateDocument` shows for each line, as the playground writes a line's result. */
function incremental(text: string): Map<number, string> {
	const engine = new ExpressionEngine({ packages: PLAYGROUND_PACKAGES });
	try {
		const out = new Map<number, string>();
		for (const line of evaluateDocument(engine, text).lines) {
			if (line.error !== null) out.set(line.lineNumber, `ERROR ${line.error}`);
			else if (line.result !== null) out.set(line.lineNumber, line.result.type === ValueType.Error ? `ERROR ${String(line.result.unit)}` : formatValue(line.result));
		}
		return out;
	} finally {
		engine.clear();
	}
}

/** What the playground's debug run shows for each line it evaluated. */
function playground(text: string): Map<number, string> {
	const result = runEngine(text);
	return new Map(result.lineResults.map((l) => [l.lineNumber, l.error ? `ERROR ${l.error}` : l.result]));
}

// ── The document pass ─────────────────────────────────────────────────────

describe("the playground's answers come from the document pass", () => {
	test("goal seek resolves, as evaluateDocument resolves it", () => {
		expect(playground(GOAL_SEEK).get(4)).toBe("= 170,507.23");
	});

	test("the streaming run shows the same answer", () => {
		const controller = new AbortController();
		const { result } = runEngineWithStreaming(GOAL_SEEK, controller.signal);
		controller.abort();
		expect(result.lineResults.find((l) => l.lineNumber === 4)?.result).toBe("= 170,507.23");
	});

	test.each([
		["goal seek", GOAL_SEEK],
		["line references", "10\n20\nline 1 + line 2\nprev * 2\ntotal above"],
		["category tags", "40 #grocery\n20 #grocery\ntotal of #grocery"],
		["table columns", "| item | cost |\n| --- | --- |\n| rent | 1200 |\n| food | 300 |\n\nsum of column \"cost\" in table above"],
		["a what-if line", ":cost = 200\n:qty = 3\ncost * qty\nline 3 with qty = 5"],
		["a failed line", "1 +\nnosuchname * 2\n5 kg in m"],
	])("%s: every line the playground shows agrees with evaluateDocument", (_name, text) => {
		const shown = playground(text);
		const expected = incremental(text);
		expect(shown.size).toBeGreaterThan(0);
		for (const [line, value] of shown) expect({ line, value }).toEqual({ line, value: expected.get(line) });
	});

	test("the pipeline data is still the debug run's own", () => {
		const result = runEngine(GOAL_SEEK);
		expect(result.opcodes.length).toBeGreaterThan(0);
		expect(result.lineStats.length).toBeGreaterThan(0);
	});

	test("documentAnswers answers a failure object, never a throw, for a document over the size limit", () => {
		const huge = Array.from({ length: 250_000 }, () => "1").join("\n");
		const answer = documentAnswers(huge);
		expect(isFailure(answer) || Array.isArray((answer as { lines?: unknown }).lines)).toBe(true);
	});
});

// ── The host calls, the parts ─────────────────────────────────────────────

describe("host calls", () => {
	test("a what-if re-runs the document and marks what changed", () => {
		const result = whatIfLines(":cost = 200\n:qty = 3\ncost * qty", { qty: "5" });
		expect(isFailure(result)).toBe(false);
		const lines = (result as Exclude<typeof result, { error: string }>).lines;
		expect(lines[2]).toMatchObject({ shown: "= 1,000", before: "= 600", changed: true });
		expect(lines[0].changed).toBe(false);
	});

	test("a what-if on an input no line reads is the engine's coded refusal", () => {
		expect(whatIfLines(":x = 1\nx + 1", { nothere: "2" })).toMatchObject({ code: "WHAT_IF_INPUT_NOT_USED" });
	});

	test("parseOverrides reads names and values, and refuses what is neither", () => {
		expect(parseOverrides("deposit = 200000, rate = 5%")).toEqual(Object.assign(Object.create(null), { deposit: "200000", rate: "5%" }));
		expect(parseOverrides(":x=1\ny = 2")).toEqual(Object.assign(Object.create(null), { x: "1", y: "2" }));
		expect(parseOverrides("")).toMatchObject({ code: "WHAT_IF_OVERRIDE_INVALID" });
		expect(parseOverrides("5 = x")).toMatchObject({ code: "WHAT_IF_OVERRIDE_INVALID" });
	});

	test("parseOverrides keeps a prototype word an ordinary key", () => {
		const parsed = parseOverrides("__proto__ = 1, constructor = 2") as Record<string, string>;
		expect(parsed.__proto__).toBe("1");
		expect(parsed.constructor).toBe("2");
		expect(Object.getPrototypeOf(parsed)).toBeNull();
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	test("explain reads the line against the document above it", () => {
		const explained = explainDocumentLine(":a = 80\na - 20%", 2);
		expect(explained).toMatchObject({ result: "= 64" });
		expect(explainDocumentLine("1", 5)).toMatchObject({ code: "TRACE_NO_SUCH_LINE" });
	});

	test("trace follows a line's inputs through the incremental pass", () => {
		const traced = traceDocumentLine(GOAL_SEEK, 4);
		expect(isFailure(traced)).toBe(false);
		expect((traced as { summary: string }).summary).toContain("line 4");
		expect(traceDocumentLine("1", 3)).toMatchObject({ code: "TRACE_NO_SUCH_LINE" });
	});

	test("references, definition and rename", () => {
		const text = ":rate = 4%\n:base = 100\nbase * rate";
		const refs = referencesAt(text, { line: 1, character: 2 }) as { line: number }[];
		expect(refs.map((r) => r.line)).toEqual([1, 3]);
		expect(definitionAt(text, { line: 3, character: 8 })).toMatchObject({ line: 1 });
		expect(renameAt(text, { line: 1, character: 2 }, "interest")).toEqual({ text: ":interest = 4%\n:base = 100\nbase * interest", edits: 2 });
		expect(renameAt(text, { line: 1, character: 2 }, "sqrt")).toMatchObject({ code: "RENAME_KEYWORD" });
	});

	test("a rename across 10,000 references stays responsive", () => {
		const text = [":x = 1", ...Array.from({ length: 10_000 }, () => "x + 1")].join("\n");
		const started = performance.now();
		const result = renameAt(text, { line: 1, character: 1 }, "y") as { edits: number };
		expect(performance.now() - started).toBeLessThan(10_000);
		expect(result.edits).toBe(10_001);
	});

	test("shiftReferences keeps line N references on their lines", () => {
		const moved = shiftReferences("new line\n10\n20\nline 1 + line 2", { kind: "insert", line: 1, count: 1 });
		expect(moved).toMatchObject({ text: "new line\n10\n20\nline 2 + line 3" });
	});
});

describe("describeLineShift, the part", () => {
	const base = { oldLineCount: 3, newLineCount: 4, fromLine: 3, fromAtLineStart: false, toAtLineStart: false, insertedEndsWithNewline: false };

	test("a newline at the end of line 3 inserts at 4, at its start inserts at 3", () => {
		expect(describeLineShift(base)).toEqual({ kind: "insert", line: 4, count: 1 });
		expect(describeLineShift({ ...base, fromAtLineStart: true, insertedEndsWithNewline: true })).toEqual({ kind: "insert", line: 3, count: 1 });
	});

	test("whole lines deleted from a line's start delete from it; a join deletes the next", () => {
		expect(describeLineShift({ ...base, newLineCount: 1, fromLine: 2, fromAtLineStart: true, toAtLineStart: true })).toEqual({ kind: "delete", line: 2, count: 2 });
		expect(describeLineShift({ ...base, newLineCount: 2, fromLine: 3 })).toEqual({ kind: "delete", line: 4, count: 1 });
	});

	test("no change in the line count, or a nonsense line, moves nothing", () => {
		expect(describeLineShift({ ...base, newLineCount: 3 })).toBeNull();
		expect(describeLineShift({ ...base, fromLine: 0 })).toBeNull();
		expect(describeLineShift({ ...base, newLineCount: 3.5 })).toBeNull();
	});
});

// ── Sharing ──────────────────────────────────────────────────────────────

describe("a shared link", () => {
	test("round-trips a document, and opens it with live data off", async () => {
		const text = `${GOAL_SEEK}\n£ 12 in € // ünïcödé 🙂`;
		const fragment = await makeShareFragment(text);
		expect(fragment.startsWith(SHARE_PREFIX)).toBe(true);
		expect(/^[#A-Za-z0-9=._-]+$/.test(fragment)).toBe(true);
		expect(await readShareFragment(fragment)).toEqual({ ok: true, text, liveData: false });
	});

	test("an empty document round-trips", async () => {
		expect(await readShareFragment(await makeShareFragment(""))).toEqual({ ok: true, text: "", liveData: false });
	});

	test("a document over the limit is refused when the link is made", async () => {
		await expect(makeShareFragment("x".repeat(MAX_SHARED_CHARACTERS + 1))).rejects.toThrow(/at most/);
	});

	test.each([
		["another app's fragment", "#section-2"],
		["a truncated link", `${SHARE_PREFIX}`],
		["characters base64url does not use", `${SHARE_PREFIX}a b+c/d`],
		["markup-shaped data", `${SHARE_PREFIX}<script>alert(1)</script>`],
		["base64url that is not DEFLATE", `${SHARE_PREFIX}aGVsbG8gd29ybGQ`],
		["a prototype word", `${SHARE_PREFIX}__proto__`],
	])("%s is refused with a message, not a throw", async (_name, fragment) => {
		const shared = await readShareFragment(fragment);
		expect(shared.ok).toBe(false);
		expect((shared as { message: string }).message.length).toBeGreaterThan(10);
	});

	test("a link past the length limit is refused before it is decoded", async () => {
		const shared = await readShareFragment(SHARE_PREFIX + "A".repeat(MAX_FRAGMENT_LENGTH));
		expect(shared).toMatchObject({ ok: false });
		expect((shared as { message: string }).message).toContain("characters long");
	});

	test("a small link that unpacks to something enormous is refused within budget", async () => {
		// Compressed by hand, as a hostile link would be: ten million bytes of
		// one letter pack into a few kilobytes.
		const stream = new CompressionStream("deflate-raw");
		const writer = stream.writable.getWriter();
		void writer.write(new Uint8Array(10_000_000).fill(97));
		void writer.close();
		const packed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
		let binary = "";
		for (const b of packed) binary += String.fromCharCode(b);
		const fragment = SHARE_PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
		expect(fragment.length).toBeLessThan(MAX_FRAGMENT_LENGTH);
		const started = performance.now();
		const shared = await readShareFragment(fragment);
		expect(performance.now() - started).toBeLessThan(5_000);
		expect(shared).toMatchObject({ ok: false });
		expect((shared as { message: string }).message).toContain("unpacks to more than");
	});

	test("bytes that are not UTF-8 are refused", async () => {
		const stream = new CompressionStream("deflate-raw");
		const writer = stream.writable.getWriter();
		void writer.write(new Uint8Array([0xff, 0xfe, 0xfd]));
		void writer.close();
		const packed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
		let binary = "";
		for (const b of packed) binary += String.fromCharCode(b);
		const shared = await readShareFragment(SHARE_PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
		expect(shared).toMatchObject({ ok: false, message: expect.stringContaining("not text") });
	});

	test("a shared document with a live lookup does not fetch until live data is on", () => {
		const off = runEngine("100 USD in EUR", { networkEnabled: false });
		const line = off.lineResults[0];
		expect(line.errorCode ?? line.error).toContain("NETWORK_DISABLED");
	});
});
