import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { closeSync, mkdtempSync, mkdirSync, openSync, rmSync, statSync, writeFileSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { createEngine } from "@solve-js/api/createEngine";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { ENGINE_VERSION } from "@solve-js/constants/version";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { isWrittenAsCheck } from "@solve-js/packages/conditionals/CheckFunctions";
import { createQueryResolver, type QueryResolverOptions } from "@solve-js/resolvers/QueryResolver";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { numberValue, type Value } from "@solve-js/vm/Value";
import { DOCUMENT_EDGES, NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES } from "@tools/adversarial";
import { DEFAULT_WAIT_MS, EXIT, MAX_WAIT_MS, parseArguments, parseNow, parseSeed } from "../../../cli/src/arguments";
import { classifyInput, decodeDocument, readBounded, readDocumentFile, tooLarge, MAX_INPUT_BYTES } from "../../../cli/src/input";
import {
	CHECK_LINE,
	checkSummary,
	documentAnswers,
	documentChecks,
	expressionDisplay,
	hasPending,
	isFailure,
	plural,
	renderRows,
	statusOf,
	type ReportedAnswer,
} from "../../../cli/src/report";
import { HELP, isKnownZone, run, type CliIO, type EngineKit } from "../../../cli/src/run";
import { escapeForTerminal, quoted } from "../../../cli/src/terminal";

/**
 * Issue #774: there was no way to run the engine from a shell. A CI job could
 * not fail on a document whose `check` lines fail, and a script that made one
 * live lookup on a default engine held Node open for the query cache's
 * ten-minute collection timer unless it called `clear()`.
 *
 * `packages/cli` is the `solve` command, a workspace package of its own so the
 * engine keeps its promises (it reads no files, and has one runtime
 * dependency). `solve "<expression>"`, `solve <file>` and `solve -` evaluate;
 * `solve check <file>` reports the check lines and exits 1 when one does not
 * pass. `--json`, `--tz`, `--now`, `--seed`, `--network`, `--wait` and
 * `--strict` shape the run; the exit codes are 0 (answered), 1 (a line or a
 * check failed) and 2 (the command could not run as asked). Every run clears
 * its engine, and the bin entry exits explicitly.
 *
 * The run is driven in-process here through `run(argv, io, kit)`, with the
 * engine built from source and a stub data source for the live cases, so
 * nothing reaches the network. `scripts/smoke-cli.mjs` runs the built command
 * as a real process.
 */

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let dir = "";
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "solve-cli-774-"));
});
afterAll(async () => {
	rmSync(dir, { recursive: true, force: true });
	// The resolvers that never answer are given a short fetch timeout; waiting
	// it out lets their timers end before the file does.
	await later(250);
});

/** Writes a file into the test directory and returns its path. */
function file(name: string, content: string | Uint8Array): string {
	const path = join(dir, name);
	writeFileSync(path, content);
	return path;
}

let serial = 0;

/**
 * A live-data package: `lookup <word>` fetches through `fetchQuery`, built
 * with `createQueryResolver` as a real live-data package is.
 */
function probePackage(fetchQuery: QueryResolverOptions["fetchQuery"], options: Partial<QueryResolverOptions> = {}): IEnginePackage {
	const name = `probe774-${++serial}`;
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
		lexerVocabulary: { keywords: { lookup: "PROBE774_LOOKUP" } },
		prefixParselets: { PROBE774_LOOKUP: new LookupParselet() },
		pluginFunctions: { [fn]: pluginFunction },
		asyncResolvers: [resolver],
		tokenCategories: { PROBE774_LOOKUP: "function" },
	};
}

/** Answers the subject's length plus 38 after `ms`: `lookup abcde` is 43. */
const slowLength = (ms: number) => async (query: string): Promise<Value> => {
	await later(ms);
	return numberValue(query.length + 38);
};

/** A fetch that never answers. */
const never = (): Promise<Value> => new Promise<Value>(() => {});

/** What one run wrote and returned. */
interface RunOutcome {
	code: number;
	out: string;
	err: string;
	/** How many times each engine the run built was cleared. */
	clears: number[];
	ms: number;
}

/** Runs the command in-process, collecting what it writes. */
async function solve(
	argv: string[],
	options: { stdin?: string | Uint8Array; packages?: IEnginePackage[]; zone?: string } = {},
): Promise<RunOutcome> {
	let out = "";
	let err = "";
	const clears: number[] = [];
	const kit: EngineKit = {
		createEngine: (engineOptions) => {
			const engine: ExpressionEngine = createEngine({ ...engineOptions, extraPackages: options.packages ?? [] });
			const index = clears.push(0) - 1;
			const clear = engine.clear.bind(engine);
			engine.clear = () => {
				clears[index]++;
				clear();
			};
			return engine;
		},
		evaluateDocument: (engine, text) => evaluateDocument(engine, text),
		dateCalendarInZone,
		engineVersion: ENGINE_VERSION,
		cliVersion: "9.9.9",
	};
	const io: CliIO = {
		out: (text) => {
			out += text;
		},
		err: (text) => {
			err += text;
		},
		readStdin: async () => (typeof options.stdin === "string" ? new TextEncoder().encode(options.stdin) : (options.stdin ?? new Uint8Array())),
		systemZone: () => options.zone ?? "UTC",
	};
	const started = Date.now();
	const code = await run(argv, io, kit);
	return { code, out, err, clears, ms: Date.now() - started };
}

/** The last row a run printed. */
function lastRow(out: string): string {
	const rows = out.trimEnd().split("\n");
	return rows[rows.length - 1];
}

/** Parses the JSON a `--json` run printed. */
// eslint-disable-next-line typescript/no-explicit-any -- the shape is asserted field by field
function json(outcome: RunOutcome): any {
	return JSON.parse(outcome.out);
}

const unitEngines: ExpressionEngine[] = [];
afterAll(() => {
	for (const e of unitEngines.splice(0)) e.clear();
});

/** An engine for the unit tests of the report functions, cleared after the file. */
function engine(): ExpressionEngine {
	const e = createEngine({ config: { network: { enabled: false } } });
	unitEngines.push(e);
	return e;
}

/** Text a person reads must not show an internal detail. */
const LEAKS = ["[object Object]", "TypeError", "RangeError", "at run (", "at Object.", "eval_failed", "undefined\n"];

function expectNoLeak(text: string): void {
	for (const leak of LEAKS) expect(text).not.toContain(leak);
}

/** The prototype's own names, to compare before and after. */
function prototypeNames(): string[] {
	return Object.getOwnPropertyNames(Object.prototype).sort();
}

const BUDGET = `# Budget

The rent went up this year.
:price = 4
:qty = 3
price * qty
check price * qty == 12
check price == 5
check 22/7 \u2248 pi within 0.1%
`;

describe("#774 the parts: parseArguments", () => {
	test("reads each option in both spellings", () => {
		const parsed = parseArguments(["--json", "--tz=Asia/Tokyo", "--now", "2026-01-01T09:00:00Z", "--seed", "42", "--network", "off", "--wait=250", "--strict", "notes.md"]);
		expect(parsed).toEqual({
			ok: true,
			options: {
				command: "run",
				positionals: ["notes.md"],
				forceExpression: false,
				json: true,
				strict: true,
				tz: "Asia/Tokyo",
				now: Date.UTC(2026, 0, 1, 9),
				seed: 42,
				network: false,
				waitMs: 250,
			},
		});
	});

	test("the defaults: run, text, the engine's network, a ten-second wait", () => {
		const parsed = parseArguments(["2 + 2"]);
		expect(parsed.ok && parsed.options).toMatchObject({ command: "run", json: false, strict: false, waitMs: DEFAULT_WAIT_MS });
		expect(parsed.ok && parsed.options.network).toBeUndefined();
		expect(DEFAULT_WAIT_MS).toBe(10_000);
	});

	test("check selects the command only when a document follows it", () => {
		expect(parseArguments(["check", "notes.md"])).toMatchObject({ ok: true, options: { command: "check", positionals: ["notes.md"] } });
		expect(parseArguments(["check", "-"])).toMatchObject({ ok: true, options: { command: "check", positionals: ["-"] } });
		expect(parseArguments(["check"])).toMatchObject({ ok: true, options: { command: "run", positionals: ["check"] } });
		expect(parseArguments(["-e", "check", "1", "==", "1"])).toMatchObject({ ok: true, options: { command: "run", forceExpression: true } });
		expect(parseArguments(["check", "a.md", "b.md"])).toEqual({ ok: false, message: "solve check reads one document. Give one file, or - for standard input." });
	});

	test("a word starting with a minus and a digit is an expression, and -- ends the options", () => {
		expect(parseArguments(["-5", "+", "3"])).toMatchObject({ ok: true, options: { positionals: ["-5", "+", "3"] } });
		expect(parseArguments(["-(2)"])).toMatchObject({ ok: true, options: { positionals: ["-(2)"] } });
		expect(parseArguments(["-.5"])).toMatchObject({ ok: true, options: { positionals: ["-.5"] } });
		expect(parseArguments(["--", "--json", "-x"])).toMatchObject({ ok: true, options: { json: false, positionals: ["--json", "-x"] } });
		expect(parseArguments(["-"])).toMatchObject({ ok: true, options: { positionals: ["-"] } });
	});

	test("help and version win over everything else", () => {
		expect(parseArguments(["--json", "-h", "2"])).toMatchObject({ ok: true, options: { command: "help" } });
		expect(parseArguments(["-V"])).toMatchObject({ ok: true, options: { command: "version" } });
	});

	test("refuses an unknown option, a switch given a value, and an option with no value", () => {
		expect(parseArguments(["--bogus"])).toEqual({ ok: false, message: '"--bogus" is not an option solve knows. Run solve --help for the list.' });
		expect(parseArguments(["-x"])).toMatchObject({ ok: false });
		expect(parseArguments(["--json=yes"])).toEqual({ ok: false, message: "--json takes no value." });
		expect(parseArguments(["--tz"])).toEqual({ ok: false, message: "--tz needs a value after it." });
		expect(parseArguments(["--tz", " "])).toMatchObject({ ok: false });
		expect(parseArguments(["--seed="])).toEqual({ ok: false, message: "--seed needs a value, such as 42." });
	});

	test("--network takes on or off only", () => {
		expect(parseArguments(["--network", "on", "1"])).toMatchObject({ ok: true, options: { network: true } });
		for (const bad of ["yes", "true", "ON", "", "1"]) expect(parseArguments(["--network", bad, "1"]).ok).toBe(false);
	});

	test("--wait takes whole milliseconds from 0 to ten minutes", () => {
		expect(parseArguments(["--wait", "0", "1"])).toMatchObject({ ok: true, options: { waitMs: 0 } });
		expect(parseArguments(["--wait", String(MAX_WAIT_MS), "1"])).toMatchObject({ ok: true, options: { waitMs: MAX_WAIT_MS } });
		for (const bad of [String(MAX_WAIT_MS + 1), "-1", "1e3", "1.5", "abc", "", "99999999999"]) {
			expect(parseArguments(["--wait", bad, "1"])).toMatchObject({ ok: false });
		}
	});

	test("hostile option names are unknown, not matched on Object.prototype", () => {
		const before = prototypeNames();
		for (const word of PROTOTYPE_WORDS) {
			const parsed = parseArguments([`--${word}`, "1"]);
			expect(parsed.ok).toBe(false);
			expect(parseArguments([`--${word}=1`]).ok).toBe(false);
		}
		expect(prototypeNames()).toEqual(before);
	});

	test("a value longer than 200 characters is refused by name", () => {
		expect(parseArguments(["--tz", "a".repeat(201), "1"])).toEqual({ ok: false, message: "--tz is longer than 200 characters." });
		expect(parseArguments(["--seed", "a".repeat(200), "1"]).ok).toBe(true);
	});

	test("an option's value is quoted with its control characters escaped", () => {
		const parsed = parseArguments(["--network", "\u001b[2Joff"]);
		expect(parsed).toEqual({ ok: false, message: '--network takes on or off, not "\\u{1b}[2Joff".' });
	});
});

describe("#774 the parts: parseNow and parseSeed", () => {
	test("an instant with Z or an offset, or epoch milliseconds", () => {
		expect(parseNow("2026-01-01T09:00:00Z")).toBe(Date.UTC(2026, 0, 1, 9));
		expect(parseNow("2026-01-01T09:00Z")).toBe(Date.UTC(2026, 0, 1, 9));
		expect(parseNow("2026-01-01T09:00:00.250+09:00")).toBe(Date.UTC(2026, 0, 1, 0, 0, 0, 250));
		expect(parseNow("0")).toBe(0);
		expect(parseNow("-86400000")).toBe(-86_400_000);
		expect(parseNow("1767225600000")).toBe(Date.UTC(2026, 0, 1));
	});

	test("a leap day in a leap year, and nothing that is not a day", () => {
		expect(parseNow("2028-02-29T12:00:00Z")).toBe(Date.UTC(2028, 1, 29, 12));
		expect(parseNow("2027-02-29T12:00:00Z")).toBeNull();
		expect(parseNow("2026-04-31T00:00:00Z")).toBeNull();
		expect(parseNow("2026-13-01T00:00:00Z")).toBeNull();
		expect(parseNow("2026-00-10T00:00:00Z")).toBeNull();
		expect(parseNow("2026-01-01T25:00:00Z")).toBeNull();
	});

	test("refuses a time with no offset, a bare date, and anything else", () => {
		for (const bad of ["2026-01-01T09:00:00", "2026-01-01", "tomorrow", "", " ", "NaN", "Infinity", "1e12", "2026-01-01 09:00Z", "0x10"]) {
			expect(parseNow(bad)).toBeNull();
		}
	});

	test("the edges of what Date can hold", () => {
		expect(parseNow("8640000000000000")).toBe(8.64e15);
		expect(parseNow("-8640000000000000")).toBe(-8.64e15);
		expect(parseNow("8640000000000001")).toBeNull();
		expect(parseNow("-0")).toBe(-0);
	});

	test("a safe whole number seed is a number, anything else is text", () => {
		expect(parseSeed("42")).toBe(42);
		expect(parseSeed("-7")).toBe(-7);
		expect(parseSeed("0")).toBe(0);
		expect(parseSeed("9007199254740993")).toBe("9007199254740993");
		expect(parseSeed("seven")).toBe("seven");
		expect(parseSeed("4.2")).toBe("4.2");
		expect(parseSeed("__proto__")).toBe("__proto__");
	});
});

describe("#774 the parts: escapeForTerminal and quoted", () => {
	test("escape sequences, direction overrides and zero-width characters become visible escapes", () => {
		expect(escapeForTerminal("\u001b[2J1 + 1")).toBe("\\u{1b}[2J1 + 1");
		expect(escapeForTerminal("\u001b]0;title\u0007")).toBe("\\u{1b}]0;title\\u{7}");
		expect(escapeForTerminal("\u202e5 + 1")).toBe("\\u{202e}5 + 1");
		expect(escapeForTerminal("5\u200b")).toBe("5\\u{200b}");
		expect(escapeForTerminal("\ufeff5")).toBe("\\u{feff}5");
		expect(escapeForTerminal("a\nb\r")).toBe("a\\u{a}b\\u{d}");
		expect(escapeForTerminal("\u0085\u009b")).toBe("\\u{85}\\u{9b}");
		expect(escapeForTerminal("\u2066x\u2069")).toBe("\\u{2066}x\\u{2069}");
		expect(escapeForTerminal("\u2028")).toBe("\\u{2028}");
	});

	test("a tab becomes a space, and ordinary text is unchanged", () => {
		expect(escapeForTerminal("a\tb")).toBe("a b");
		for (const text of ["5 km in miles", "caf\u00e9 \u2248 \u2713", "\u00a3 12.50", "\u0665", "5 \u{1f642}", "<script>alert(1)</script>", ""]) {
			expect(escapeForTerminal(text)).toBe(text);
		}
	});

	test("quoted wraps the escaped text in double quotes", () => {
		expect(quoted("notes.md")).toBe('"notes.md"');
		expect(quoted("\u001bx")).toBe('"\\u{1b}x"');
	});
});

describe("#774 the parts: classifyInput", () => {
	const fake = (kind: "file" | "dir" | "device" | "missing") => (): Stats => {
		if (kind === "missing") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		return { isFile: () => kind === "file", isDirectory: () => kind === "dir" } as unknown as Stats;
	};

	test("one word naming a file is a document, and anything else an expression", () => {
		expect(classifyInput(["notes.md"], false, fake("file"))).toEqual({ kind: "file", path: "notes.md" });
		expect(classifyInput(["5 km in miles"], false, fake("missing"))).toEqual({ kind: "expression", text: "5 km in miles" });
		expect(classifyInput(["5", "km", "in", "miles"], false, fake("file"))).toEqual({ kind: "expression", text: "5 km in miles" });
		expect(classifyInput(["-"], false, fake("missing"))).toEqual({ kind: "stdin" });
	});

	test("-e reads a word as an expression even when it names a file", () => {
		expect(classifyInput(["notes.md"], true, fake("file"))).toEqual({ kind: "expression", text: "notes.md" });
	});

	test("a directory, a device, and a missing document are refused by name", () => {
		expect(classifyInput(["notes"], false, fake("dir"))).toEqual({ kind: "refused", message: '"notes" is a directory. Give a document inside it.' });
		expect(classifyInput(["/dev/zero"], false, fake("device"))).toMatchObject({ kind: "refused", message: expect.stringContaining("is not a regular file") });
		for (const name of ["notes.md", "a.markdown", "b.TXT", "c.solve", "d.mdx"]) {
			expect(classifyInput([name], false, fake("missing"))).toEqual({ kind: "refused", message: `There is no file "${name}".` });
		}
	});

	test("nothing, an empty word and whitespace are refused rather than answered 0", () => {
		expect(classifyInput([], false, fake("missing"))).toMatchObject({ kind: "refused" });
		expect(classifyInput([""], false, fake("missing"))).toMatchObject({ kind: "refused", message: expect.stringContaining("empty") });
		expect(classifyInput(["  ", "\t"], false, fake("missing"))).toMatchObject({ kind: "refused" });
		expect(classifyInput([""], true, fake("missing"))).toMatchObject({ kind: "refused" });
	});

	test("a stat that throws anything is read as a missing file", () => {
		const hostile = (): Stats => {
			throw new TypeError("path must be a string without null bytes");
		};
		expect(classifyInput(["a\u0000b"], false, hostile)).toEqual({ kind: "expression", text: "a\u0000b" });
		for (const word of PROTOTYPE_WORDS) expect(classifyInput([word], false, fake("missing"))).toEqual({ kind: "expression", text: word });
	});

	test("the real file system: a directory, /dev/null, and a file", () => {
		expect(classifyInput([dir], false)).toMatchObject({ kind: "refused", message: expect.stringContaining("is a directory") });
		expect(classifyInput(["/dev/null"], false)).toMatchObject({ kind: "refused", message: expect.stringContaining("not a regular file") });
		const path = file("classify.md", "1 + 1\n");
		expect(classifyInput([path], false)).toEqual({ kind: "file", path });
	});
});

describe("#774 the parts: readDocumentFile and decodeDocument", () => {
	test("reads UTF-8, drops a byte-order mark, and keeps CRLF for the engine", () => {
		expect(readDocumentFile(file("plain.md", "1 + 1\n"))).toEqual({ ok: true, text: "1 + 1\n" });
		expect(readDocumentFile(file("bom.md", "\ufeff2 + 2"))).toEqual({ ok: true, text: "2 + 2" });
		expect(readDocumentFile(file("crlf.md", "1\r\n2\r\n"))).toEqual({ ok: true, text: "1\r\n2\r\n" });
		expect(readDocumentFile(file("empty.md", ""))).toEqual({ ok: true, text: "" });
	});

	test("refuses a file past the limit before reading it", () => {
		const path = file("big.md", "1\n".repeat(600));
		expect(readDocumentFile(path, 1000)).toEqual({ ok: false, message: `"${path}" is larger than 0 MiB, the most solve reads.` });
		expect(readDocumentFile(path, 1200)).toMatchObject({ ok: true });
		expect(MAX_INPUT_BYTES).toBe(16 * 1024 * 1024);
		expect(tooLarge("standard input", MAX_INPUT_BYTES)).toBe("standard input is larger than 16 MiB, the most solve reads.");
	});

	test("refuses bytes that are not UTF-8, and a NUL byte", () => {
		expect(readDocumentFile(file("latin1.md", new Uint8Array([0x63, 0x61, 0x66, 0xe9])))).toMatchObject({ ok: false, message: expect.stringContaining("is not UTF-8 text") });
		expect(readDocumentFile(file("nul.md", "1 + 1\u00002"))).toMatchObject({ ok: false, message: expect.stringContaining("NUL byte") });
		expect(decodeDocument(new Uint8Array([0xff, 0xfe]), "x")).toEqual({ ok: false, message: "x is not UTF-8 text." });
		expect(decodeDocument(new Uint8Array(), "x")).toEqual({ ok: true, text: "" });
	});

	test("a directory or a missing path is named, never thrown", () => {
		expect(readDocumentFile(dir)).toMatchObject({ ok: false });
		expect(readDocumentFile(join(dir, "nope.md"))).toEqual({ ok: false, message: `"${join(dir, "nope.md")}" cannot be read.` });
	});

	test("the file is read through the descriptor it was checked on: a directory and a device are refused by kind", () => {
		expect(readDocumentFile(dir)).toEqual({ ok: false, message: `"${dir}" is a directory. Give a document inside it.` });
		if (process.platform !== "win32") {
			expect(readDocumentFile("/dev/null")).toMatchObject({ ok: false, message: expect.stringContaining("is not a regular file") });
		}
	});

	test("a file exactly at the limit is read, one byte past it is refused", () => {
		expect(readDocumentFile(file("at-limit.md", "x".repeat(64)), 64)).toEqual({ ok: true, text: "x".repeat(64) });
		expect(readDocumentFile(file("past-limit.md", "x".repeat(65)), 64)).toMatchObject({ ok: false, message: expect.stringContaining("is larger than") });
		expect(readDocumentFile(file("zero-limit.md", "x"), 0)).toMatchObject({ ok: false });
	});

	test("readBounded reads to the end or to the bound, whichever comes first", () => {
		const path = file("bounded.md", "abcdefghij".repeat(10_000));
		const fd = openSync(path, "r");
		try {
			expect(readBounded(fd, 5).length).toBe(5);
			// The descriptor's position moved on, so the next read continues.
			expect(Buffer.from(readBounded(fd, 5)).toString()).toBe("fghij");
			expect(readBounded(fd, 1_000_000).length).toBe(100_000 - 10);
			expect(readBounded(fd, 10).length).toBe(0);
		} finally {
			closeSync(fd);
		}
		const empty = openSync(file("bounded-empty.md", ""), "r");
		try {
			expect(readBounded(empty, 10).length).toBe(0);
			expect(readBounded(empty, 0).length).toBe(0);
		} finally {
			closeSync(empty);
		}
	});
});

describe("#774 the parts: the report", () => {
	test("statusOf reads an answer, an error and a pending value", () => {
		const e = engine();
		expect(statusOf(e.evaluateExpression("2 + 2"))).toBe("answered");
		expect(statusOf(e.evaluateExpression("check 1 == 2"))).toBe("failed");
		expect(statusOf(e.evaluateExpression("weather in London"))).toBe("failed");
	});

	test("documentAnswers gives one answer per evaluated line, and the prose as not read", () => {
		const e = engine();
		const result = evaluateDocument(e, BUDGET);
		const answers = documentAnswers(result, (v) => e.formatValue(v), 100);
		expect(answers.map((a) => [a.line, a.status, a.display])).toEqual([
			[3, "not-read", 'Expected an operator or the end of the line, but found "rent"'],
			[4, "answered", "= 4"],
			[5, "answered", "= 3"],
			[6, "answered", "= 12"],
			[7, "answered", "= \u2713"],
			[8, "failed", "check failed: 4 is not equal to 5"],
			[9, "answered", "= \u2713 (differs by 0.04%)"],
		]);
		expect(answers[6].value).toEqual({ type: 3, value: "\u2713 (differs by 0.04%)" });
		expect(answers[5].code).toBe("CHECK_FAILED");
		expect(hasPending(result)).toBe(false);
	});

	test("an inline solve is its own answer", () => {
		const e = engine();
		const answers = documentAnswers(evaluateDocument(e, ":rent = 1200\nRent is s`rent * 12` a year, or s`rent / 0 m`."), (v) => e.formatValue(v), 100);
		expect(answers.map((a) => [a.line, a.text, a.status])).toEqual([
			[1, ":rent = 1200", "answered"],
			[2, "`rent * 12`", "answered"],
			[2, "`rent / 0 m`", answers[2].status],
		]);
	});

	test("isFailure counts failed and pending, and not-read only when strict", () => {
		const a = (status: ReportedAnswer["status"]): ReportedAnswer => ({ line: 1, text: "", status, display: "", code: null, value: null });
		expect([isFailure(a("answered"), false), isFailure(a("failed"), false), isFailure(a("pending"), false), isFailure(a("not-read"), false)]).toEqual([false, true, true, false]);
		expect(isFailure(a("not-read"), true)).toBe(true);
		expect(isFailure(a("answered"), true)).toBe(false);
	});

	test("documentChecks: passed, failed, approximate, broken, and a variable called check", () => {
		const e = engine();
		const text = BUDGET + "check 1 km ==\ncheck weather in London > 10\n:check = 80\ncheck * 2\ncheck the oil\n";
		const result = evaluateDocument(e, text);
		const checks = documentChecks(result, (v) => e.formatValue(v), 100);
		expect(checks.map((c) => [c.line, c.status, c.code])).toEqual([
			[7, "passed", null],
			[8, "failed", "CHECK_FAILED"],
			[9, "passed", null],
			[10, "not-read", "UNEXPECTED_END_OF_INPUT"],
			[11, "error", "NETWORK_DISABLED"],
			[14, "not-read", checks[5].code],
		]);
		// The engine's own count agrees on the two it counts.
		expect(result.checks).toEqual({ passed: 2, failed: 1 });
		expect(checkSummary(checks)).toBe("6 checks: 2 passed, 1 failed, 3 could not be evaluated");
	});

	test("CHECK_LINE is the engine's isWrittenAsCheck", () => {
		const corpus = [
			"check 1 == 1", "CHECK 1 == 1", "  check x", "total: check a < b", "check = 80", "check += 5", "check == 3", "check\t1 == 1",
			"check", "checked 1 == 1", '"a:b" check 1', "the check 1 == 1", "check -= 1", "check *= 2", "check /= 2", "check -1 < 0", "check =5",
			...PROTOTYPE_WORDS.map((w) => `check ${w}`), ...TEXT_EDGES.map((t) => `check ${t}`),
		];
		for (const line of corpus) expect([line, CHECK_LINE.test(line)]).toEqual([line, isWrittenAsCheck(line)]);
	});

	test("renderRows aligns the columns, cuts a long line, and escapes the text", () => {
		const rows = [
			{ line: 9, text: "short", status: "answered" as const, display: "= 1" },
			{ line: 10, text: "x".repeat(60), status: "failed" as const, display: "Units do not fit" },
			{ line: 11, text: "\u001b[2Jhidden", status: "not-read" as const, display: "bad \u202e" },
			{ line: 12, text: "p", status: "pending" as const, display: "no answer" },
		];
		const out = renderRows(rows).split("\n");
		expect(out[0]).toBe(` 9  short${" ".repeat(43)}  = 1`);
		expect(out[1]).toBe(`10  ${"x".repeat(47)}\u2026  error: Units do not fit`);
		expect(out[2]).toBe(`11  \\u{1b}[2Jhidden${" ".repeat(33)}  not read: bad \\u{202e}`);
		expect(out[3]).toBe(`12  p${" ".repeat(47)}  pending: no answer`);
		expect(renderRows([])).toBe("");
		expect(renderRows(rows, (r) => r.line === 9)).toBe("9  short  = 1\n");
	});

	test("plural, checkSummary and expressionDisplay", () => {
		expect(plural(1, "line")).toBe("1 line");
		expect(plural(0, "line")).toBe("0 lines");
		expect(plural(2, "check")).toBe("2 checks");
		expect(checkSummary([])).toBe("0 checks: 0 passed, 0 failed");
		expect(expressionDisplay("= 3.11 miles")).toBe("3.11 miles");
		expect(expressionDisplay("check failed: 1 is not equal to 2")).toBe("check failed: 1 is not equal to 2");
		expect(expressionDisplay("=5")).toBe("=5");
	});

	test("isKnownZone", () => {
		expect(isKnownZone("Europe/London")).toBe(true);
		expect(isKnownZone("UTC")).toBe(true);
		for (const zone of ["Europe/Atlantis", "", "constructor", "__proto__", "Europe/London\u0000", "x".repeat(200)]) expect(isKnownZone(zone)).toBe(false);
	});
});

describe("#774 one expression", () => {
	test("answers on standard output with exit 0, without the leading =", async () => {
		const r = await solve(["5 km in miles"]);
		expect(r).toMatchObject({ code: EXIT.OK, out: "3.11 miles\n", err: "" });
		expect((await solve(["5", "km", "in", "miles"])).out).toBe("3.11 miles\n");
		expect((await solve(["--", "-5", "+", "3"])).out).toBe("-2\n");
		expect((await solve(["-5 + 3"])).out).toBe("-2\n");
	});

	test("a failed check, a unit that does not fit and an unreadable line exit 1 on standard error", async () => {
		expect(await solve(["check 1 == 2"])).toMatchObject({ code: EXIT.FAILED, out: "", err: "check failed: 1 is not equal to 2\n" });
		const unit = await solve(["5 km + 3 kg"]);
		expect(unit.code).toBe(EXIT.FAILED);
		expect(unit.err).toMatch(/^error: /);
		expect(await solve(["5 km in mlies"])).toMatchObject({ code: EXIT.FAILED, out: "" });
		expect(await solve(["hello there"])).toMatchObject({ code: EXIT.FAILED, err: 'error: Expected an operator or the end of the line, but found "there"\n' });
	});

	test("--json writes the value, the code and the exit status", async () => {
		const r = await solve(["--json", "5 km in miles"]);
		expect(r.code).toBe(EXIT.OK);
		expect(json(r)).toEqual({ expression: "5 km in miles", status: "answered", display: "= 3.11 miles", code: null, value: { type: 6, value: 3.1068559611866697, unit: "miles" }, exitCode: 0 });
		const failed = json(await solve(["--json", "check 1 == 2"]));
		expect(failed).toMatchObject({ status: "failed", code: "CHECK_FAILED", exitCode: 1 });
		const unread = json(await solve(["--json", "hello there"]));
		expect(unread).toMatchObject({ status: "not-read", code: "UNEXPECTED_TRAILING_TOKEN", value: null, exitCode: 1 });
	});

	test("a big exact integer survives --json as a string", async () => {
		const r = json(await solve(["--json", "2^64"]));
		expect(r.status).toBe("answered");
		expect(JSON.stringify(r.value)).not.toContain("[object");
	});

	test("a whole-document form on its own is an honest refusal, not a number", async () => {
		expect(json(await solve(["--json", "line 1 * 2"]))).toMatchObject({ status: "failed", code: "LINE_REF_NO_DOCUMENT", exitCode: 1 });
		expect(json(await solve(["--json", "solve line 2 for price = 150"]))).toMatchObject({ status: "failed", code: "GOAL_SEEK_NO_DOCUMENT" });
	});

	test("an empty expression is a usage error, not 0", async () => {
		expect(await solve([""])).toMatchObject({ code: EXIT.USAGE, out: "" });
		expect(await solve(["-e", "   "])).toMatchObject({ code: EXIT.USAGE });
		expect(await solve([])).toMatchObject({ code: EXIT.USAGE, err: expect.stringContaining("Nothing to evaluate") });
	});

	test("help and version", async () => {
		expect(await solve(["--help"])).toEqual(expect.objectContaining({ code: EXIT.OK, out: HELP }));
		expect(HELP).toContain("solve check");
		expect(await solve(["-V"])).toEqual(expect.objectContaining({ code: EXIT.OK, out: `solve 9.9.9 (solve-engine ${ENGINE_VERSION})\n` }));
	});

	test("the engine is cleared once, whatever the outcome", async () => {
		for (const argv of [["2 + 2"], ["check 1 == 2"], ["hello there"], ["--json", "1/0"]]) {
			expect((await solve(argv)).clears).toEqual([1]);
		}
		// A usage error builds no engine at all.
		expect((await solve(["--bogus"])).clears).toEqual([]);
	});
});

describe("#774 a document", () => {
	test("one answer per line, prose left out, exit 1 when a line failed", async () => {
		const path = file("budget.md", BUDGET);
		const r = await solve(["--network", "off", path]);
		expect(r.code).toBe(EXIT.FAILED);
		expect(r.out).toBe(
			[
				"4  :price = 4                   = 4",
				"5  :qty = 3                     = 3",
				"6  price * qty                  = 12",
				"7  check price * qty == 12      = \u2713",
				"8  check price == 5             check failed: 4 is not equal to 5",
				"9  check 22/7 \u2248 pi within 0.1%  = \u2713 (differs by 0.04%)",
				"",
			].join("\n"),
		);
		expect(r.err).toBe(`solve: 1 line in "${path}" failed.\n`);
	});

	test("a document whose lines all answer exits 0, prose and all", async () => {
		const r = await solve([file("ok.md", "# Costs\n\nWe pay rent monthly.\n:rent = 1200\nrent * 12\n")]);
		expect(r).toMatchObject({ code: EXIT.OK, err: "" });
		expect(r.out).toBe("4  :rent = 1200  = 1,200\n5  rent * 12     = 14,400\n");
	});

	test("--strict counts the prose as failures and prints it", async () => {
		const r = await solve(["--strict", file("strict.md", "We pay rent monthly.\n1 + 1\n")]);
		expect(r.code).toBe(EXIT.FAILED);
		expect(r.out).toContain("not read: ");
	});

	test("--json lists every evaluated line with its status", async () => {
		const r = await solve(["--json", "--network", "off", file("budget.json.md", BUDGET)]);
		const body = json(r);
		expect(body.exitCode).toBe(1);
		expect(body.failed).toBe(1);
		expect(body.lines.map((l: ReportedAnswer) => l.status)).toEqual(["not-read", "answered", "answered", "answered", "answered", "failed", "answered"]);
		expect(body.lines[3]).toEqual({ line: 6, text: "price * qty", status: "answered", display: "= 12", code: null, value: { type: 0, value: 12 } });
	});

	test("the cross-line forms resolve, goal seek included, and agree with the batch pass", async () => {
		const note = ":price = 100\nprice * 1.25\nsolve line 2 for price = 150\nline 2 with price = 10\nlunch $12 #food\ndinner $30 #food\ntotal of #food\n";
		const body = json(await solve(["--json", file("cross.md", note)]));
		expect(body.lines.map((l: ReportedAnswer) => l.display)).toEqual(["= 100", "= 125", "= 120", "= 12.50", "= $12.00", "= $30.00", "= $42.00"]);
		// Every form but goal seek is the batch pass's answer too.
		const e = createEngine();
		const batch = e.parseDocument(note).lines.filter((l) => !l.isEmpty).map((l) => (l.result ? formatValue(l.result, e.getFormattingSettings()) : null));
		expect(batch.filter((_, i) => i !== 2)).toEqual(body.lines.map((l: ReportedAnswer) => l.display).filter((_: string, i: number) => i !== 2));
		e.clear();
	});

	test("standard input, with the same answers as a file", async () => {
		const r = await solve(["-"], { stdin: ":a = 2\na * 21\n" });
		expect(r).toMatchObject({ code: EXIT.OK, out: "1  :a = 2  = 2\n2  a * 21  = 42\n" });
	});

	test("a directory, a device, a missing document and an unreadable one are usage errors", async () => {
		for (const argv of [[dir], ["/dev/null"], ["/dev/zero"], [join(dir, "missing.md")], [file("bin.md", new Uint8Array([0xc3, 0x28]))]]) {
			const r = await solve(argv);
			expect(r.code).toBe(EXIT.USAGE);
			expect(r.out).toBe("");
			expect(r.err).toMatch(/^solve: /);
			expectNoLeak(r.err);
		}
	});
});

describe("#774 solve check", () => {
	test("the issue's document: a passing, a failing and an approximate check", async () => {
		const r = await solve(["check", "--network", "off", file("checks.md", BUDGET)]);
		expect(r.code).toBe(EXIT.FAILED);
		expect(r.out).toBe(
			[
				"7  check price * qty == 12      \u2713",
				"8  check price == 5             check failed: 4 is not equal to 5",
				"9  check 22/7 \u2248 pi within 0.1%  \u2713 (differs by 0.04%)",
				"3 checks: 2 passed, 1 failed",
				"",
			].join("\n"),
		);
	});

	test("every check passing exits 0, even beside a line that failed", async () => {
		const r = await solve(["check", file("pass.md", ":a = 2\ncheck a == 2\ncheck a \u2248 2.01 within 1%\n5 km + 3 kg\n")]);
		expect(r).toMatchObject({ code: EXIT.OK, err: "" });
		expect(lastRow(r.out)).toBe("2 checks: 2 passed, 0 failed");
	});

	test("a check that cannot be read or evaluated does not pass", async () => {
		const r = await solve(["check", "--network", "off", file("broken.md", "check 1 == 1\ncheck 1 km ==\ncheck weather in London > 10\n")]);
		expect(r.code).toBe(EXIT.FAILED);
		expect(r.out).toContain("not read: The line ends after");
		expect(r.out).toContain("error: Live data is switched off");
		expect(r.out).toContain("3 checks: 1 passed, 0 failed, 2 could not be evaluated");
	});

	test("a document with no checks says so and exits 0", async () => {
		const path = file("nochecks.md", "1 + 1\n");
		expect(await solve(["check", path])).toMatchObject({ code: EXIT.OK, out: `No check lines in "${path}".\n` });
		expect(await solve(["check", file("check-var.md", ":check = 80\ncheck * 2\n")])).toMatchObject({ code: EXIT.OK, out: expect.stringContaining("No check lines") });
	});

	test("--json gives each check and the counts, which match the engine's", async () => {
		const body = json(await solve(["check", "--json", "--network", "off", file("checks.json.md", BUDGET)]));
		expect(body).toMatchObject({ passed: 2, failed: 1, unevaluated: 0, pending: 0, exitCode: 1 });
		expect(body.checks[1]).toEqual({ line: 8, text: "check price == 5", status: "failed", display: "check failed: 4 is not equal to 5", code: "CHECK_FAILED" });
		const e = createEngine({ config: { network: { enabled: false } } });
		expect(evaluateDocument(e, BUDGET).checks).toEqual({ passed: body.passed, failed: body.failed });
		e.clear();
	});

	test("check from standard input, and the refusals", async () => {
		expect(await solve(["check", "-"], { stdin: "check 2 > 1\n" })).toMatchObject({ code: EXIT.OK, out: expect.stringContaining("1 check: 1 passed") });
		expect(await solve(["check", "1 == 1"])).toMatchObject({ code: EXIT.USAGE, err: 'solve: solve check reads a document, and "1 == 1" is not a file.\n' });
		expect(await solve(["check", "a.md", "b.md"])).toMatchObject({ code: EXIT.USAGE });
	});
});

describe("#774 --tz, --now, --seed and --network", () => {
	test("--tz with an unknown zone is a usage error, not a stack trace", async () => {
		const r = await solve(["--tz", "Europe/Atlantis", "today"]);
		expect(r).toMatchObject({ code: EXIT.USAGE, out: "" });
		expect(r.err).toBe('solve: --tz "Europe/Atlantis" is not a time zone this machine knows. Give an IANA name, such as Europe/London or America/New_York.\n');
		for (const zone of PROTOTYPE_WORDS) expect((await solve(["--tz", zone, "today"])).code).toBe(EXIT.USAGE);
	});

	test("--now pins the clock, read in the --tz zone", async () => {
		expect((await solve(["--now", "2026-01-01T09:00:00Z", "--tz", "Asia/Tokyo", "today"])).out).toBe("Thursday, January 1, 2026, 6:00:00 PM\n");
		expect((await solve(["--now", "2026-01-01T09:00:00Z", "--tz", "America/New_York", "today"])).out).toBe("Thursday, January 1, 2026, 4:00:00 AM\n");
		// Without --tz, the machine's zone (UTC here).
		expect((await solve(["--now", "2026-01-01T09:00:00Z", "today"])).out).toBe("Thursday, January 1, 2026, 9:00:00 AM\n");
	});

	test("--now on a leap day and across a change of clocks", async () => {
		expect((await solve(["--now", "2028-02-29T12:00:00Z", "--tz", "UTC", "today + 1 day"])).out).toBe("Wednesday, March 1, 2028, 12:00:00 PM\n");
		// 01:00 UTC on 29 March 2026 is the moment London moves to summer time.
		expect((await solve(["--now", "2026-03-29T01:00:00Z", "--tz", "Europe/London", "now"])).out).toBe("Sunday, March 29, 2026, 2:00:00 AM\n");
		expect((await solve(["--now", "2026-03-29T00:59:00Z", "--tz", "Europe/London", "now"])).out).toBe("Sunday, March 29, 2026, 12:59:00 AM\n");
	});

	test("a --now that is not an instant is a usage error", async () => {
		for (const bad of ["2026-01-01T09:00:00", "tomorrow", "2027-02-29T00:00:00Z"]) {
			const r = await solve(["--now", bad, "today"]);
			expect(r.code).toBe(EXIT.USAGE);
			expect(r.err).toContain("is not a moment solve can read");
		}
	});

	test("--seed makes a roll the same on every run", async () => {
		const first = await solve(["--seed", "42", "roll(1, 1000000)"]);
		const second = await solve(["--seed", "42", "roll(1, 1000000)"]);
		expect(first.code).toBe(EXIT.OK);
		expect(second.out).toBe(first.out);
		expect((await solve(["--seed", "seven", "roll(1, 1000000)"])).out).toBe((await solve(["--seed", "seven", "roll(1, 1000000)"])).out);
		expect((await solve(["--seed", "__proto__", "roll(1, 6)"])).code).toBe(EXIT.OK);
	});

	test("--network off refuses live data by its code", async () => {
		expect(json(await solve(["--json", "--network", "off", "weather in London"]))).toMatchObject({ status: "failed", code: "NETWORK_DISABLED", exitCode: 1 });
	});
});

describe("#774 live values and exiting", () => {
	test("a live value is waited for, and answers", async () => {
		const r = await solve(["lookup abcde"], { packages: [probePackage(slowLength(20))] });
		expect(r).toMatchObject({ code: EXIT.OK, out: "43\n" });
		expect(r.clears).toEqual([1]);
	});

	test("a live line in a document is waited for, and what reads it follows", async () => {
		const r = await solve(["--json", file("live.md", ":x = lookup abcde\nx + 1\ncheck x == 43\n")], { packages: [probePackage(slowLength(20))] });
		expect(json(r).lines.map((l: ReportedAnswer) => l.display)).toEqual(["= 43", "= 44", "= \u2713"]);
		expect(r.code).toBe(EXIT.OK);
	});

	test("a live line that never answers ends the run within the wait, as a failure", async () => {
		const r = await solve(["--wait", "150", "lookup abcde"], { packages: [probePackage(never, { timeoutMs: 200 })] });
		expect(r.code).toBe(EXIT.FAILED);
		expect(r.err).toBe("pending: no answer from live data within 150 ms\n");
		expect(r.ms).toBeLessThan(2_000);
		expect(r.clears).toEqual([1]);
	});

	test("the same in a document, and in solve check", async () => {
		const pkg = () => [probePackage(never, { timeoutMs: 200 })];
		const doc = file("never.md", "1 + 1\n:x = lookup abcde\ncheck x > 1\n");
		const r = await solve(["--json", "--wait", "100", doc], { packages: pkg() });
		// A line reading a variable whose value never arrived is not read (the
		// engine answers "Undefined variable: x" there), and the pending line
		// above it is what fails the run.
		expect(json(r).lines.map((l: ReportedAnswer) => l.status)).toEqual(["answered", "pending", "not-read"]);
		expect(r.code).toBe(EXIT.FAILED);
		expect(r.ms).toBeLessThan(2_000);
		const c = await solve(["check", "--wait", "100", doc], { packages: pkg() });
		expect(c.code).toBe(EXIT.FAILED);
		expect(c.out).toContain("1 check: 0 passed, 0 failed, 1 could not be evaluated");
		const direct = await solve(["check", "--wait", "100", file("never-check.md", "check lookup abcde > 1\n")], { packages: pkg() });
		expect(direct.code).toBe(EXIT.FAILED);
		expect(direct.out).toContain("1 check: 0 passed, 0 failed, 1 still waiting for live data");
	});

	test("--wait 0 does not wait at all", async () => {
		const r = await solve(["--wait", "0", "lookup abcde"], { packages: [probePackage(slowLength(20))] });
		expect(r.code).toBe(EXIT.FAILED);
		expect(r.err).toContain("pending");
	});

	test("a fetch that fails is a failed line with its code", async () => {
		const failing = async (): Promise<Value> => {
			throw new Error("upstream down");
		};
		const r = await solve(["--json", "lookup abcde"], { packages: [probePackage(failing)] });
		expect(json(r)).toMatchObject({ status: "failed", exitCode: 1 });
	});

	test("after a run, the query cache holds no timer that would keep Node running", async () => {
		const timers = () => process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
		await later(20);
		const before = timers();
		await solve(["lookup abcde"], { packages: [probePackage(slowLength(5))] });
		await later(20);
		expect(timers()).toBeLessThanOrEqual(before);

		// The control: the same lookup on an engine nobody clears keeps its
		// query in the cache, whose collection timer is what held Node open.
		// Read from the engine's own cache rather than the process's timer
		// count, which a timer left by an earlier suite in the same process can
		// move either way while this one runs.
		const kept = createEngine({ extraPackages: [probePackage(slowLength(5))] });
		kept.getBatcher().onLineResult = () => {};
		kept.evaluateExpression("lookup abcde");
		await kept.settle();
		expect(kept.queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);
		kept.clear();
		expect(kept.queryClient.getQueryCache().getAll()).toHaveLength(0);
		await later(20);
		expect(timers()).toBeLessThanOrEqual(before);
	});
});

describe("#774 adversarial: security", () => {
	test("prototype words as expressions, document lines and seeds leave Object.prototype alone", async () => {
		const before = prototypeNames();
		for (const word of PROTOTYPE_WORDS) {
			const r = await solve([word]);
			expect([EXIT.OK, EXIT.FAILED]).toContain(r.code);
			expectNoLeak(r.out + r.err);
			const d = await solve(["--json", file(`proto-${word}.md`, `${word}\n:${word} = 5\n${word} * 2\ncheck ${word} == 5\n`)]);
			expect([EXIT.OK, EXIT.FAILED]).toContain(d.code);
			expect(() => json(d)).not.toThrow();
			expect((await solve(["--seed", word, "roll(1, 6)"])).code).toBe(EXIT.OK);
		}
		expect(prototypeNames()).toEqual(before);
	});

	test("a file past 16 MiB is refused before it is read", async () => {
		const path = file("huge.md", new Uint8Array(MAX_INPUT_BYTES + 1).fill(0x31));
		const r = await solve([path]);
		expect(r).toMatchObject({ code: EXIT.USAGE, out: "" });
		expect(r.err).toBe(`solve: "${path}" is larger than 16 MiB, the most solve reads.\n`);
		expect(r.ms).toBeLessThan(2_000);
		expect(await solve(["-"], { stdin: new Uint8Array(MAX_INPUT_BYTES + 1) })).toMatchObject({ code: EXIT.USAGE, err: "solve: standard input is larger than 16 MiB, the most solve reads.\n" });
	});

	test("a document past the engine's line limit is refused by name", async () => {
		const r = await solve([file("lines.md", "1\n".repeat(100_001))]);
		expect(r.code).toBe(EXIT.USAGE);
		expect(r.err).toMatch(/^solve: ".*lines\.md" could not be evaluated: /);
		expectNoLeak(r.err);
	}, 30_000);

	test("the resource probes end within their budget", async () => {
		for (const probe of [RESOURCE_PROBES.longSum(), RESOURCE_PROBES.deepParens(), RESOURCE_PROBES.hugePower(), RESOURCE_PROBES.hugeRange(), RESOURCE_PROBES.longIdentifier()]) {
			const r = await solve(["-e", probe]);
			expect([EXIT.OK, EXIT.FAILED]).toContain(r.code);
			expect(r.ms).toBeLessThan(5_000);
			expectNoLeak(r.out + r.err);
		}
		const many = await solve([file("many.md", RESOURCE_PROBES.manyLines())]);
		expect(many.code).toBe(EXIT.OK);
		expect(lastRow(many.out)).toBe("2001  prev + 1  = 2,001");
	}, 60_000);

	test("an escape sequence in a line acts on no terminal: text escapes it, JSON keeps it as data", async () => {
		const note = "\u001b[2J\u001b]0;pwned\u0007:a = 5\n\u202ea * 2\nclear\u200b = 1\n";
		const path = file("escapes.md", note);
		const text = await solve(["--strict", path]);
		// eslint-disable-next-line no-control-regex -- looking for these characters is the test
		expect(text.out).not.toMatch(/[\u001b\u0007\u202e\u200b]/);
		expect(text.out).toContain("\\u{1b}[2J");
		const body = json(await solve(["--json", path]));
		expect(body.lines[0].text).toBe("\u001b[2J\u001b]0;pwned\u0007:a = 5");
	});

	test("markup- and injection-shaped lines are read as text", async () => {
		for (const text of ["<script>alert(1)</script>", "'; DROP TABLE notes; --", "${5}", "%s%s%s%n", "$(rm -rf /)", "`rm -rf /`"]) {
			const r = await solve(["-e", text]);
			expect([EXIT.OK, EXIT.FAILED]).toContain(r.code);
			expectNoLeak(r.out + r.err);
		}
	});

	test("look-alike digits and invisible characters in a check", async () => {
		const r = await solve(["check", "--json", file("lookalike.md", "check \u0665 == 5\ncheck 5\u200b == 5\ncheck \uff15 == 5\n")]);
		expect([EXIT.OK, EXIT.FAILED]).toContain(r.code);
		for (const c of json(r).checks) expect(["passed", "failed", "not-read", "error"]).toContain(c.status);
	});
});

describe("#774 adversarial: realistic breakage", () => {
	test("a typo in a unit, a unit that does not fit, a value from the line above", async () => {
		const body = json(await solve(["--json", file("typos.md", ":d = 5 km\nd in mils\nd + 3 kg\nd in miles\ncheck d in miles > 3\n")]));
		expect(body.lines[3]).toMatchObject({ status: "answered", display: "= 3.11 miles" });
		expect(body.lines[4]).toMatchObject({ status: "answered", display: "= \u2713" });
		expect(body.lines[2].status).toBe("failed");
		expect(body.exitCode).toBe(1);
	});

	test("a check over a line reference, a tag, a section and a what-if", async () => {
		const note = "# Food\nlunch $12 #food\ndinner $30 #food\ncheck total of #food == $42\ncheck line 2 < line 3\ncheck line 2 with lunch = 1 == $12\n";
		const r = await solve(["check", "--json", file("cross-check.md", note)]);
		const body = json(r);
		expect(body.checks.slice(0, 2).map((c: { status: string }) => c.status)).toEqual(["passed", "passed"]);
		expect(body.checks.length).toBe(3);
	});

	test("the same document through a file, standard input and a CRLF copy gives the same answers", async () => {
		const note = ":price = 4\n:qty = 3\nprice * qty\ncheck price * qty == 12\n";
		const a = json(await solve(["--json", file("same.md", note)]));
		const b = json(await solve(["--json", "-"], { stdin: note }));
		const c = json(await solve(["--json", file("same-crlf.md", note.replace(/\n/g, "\r\n"))]));
		expect(b.lines).toEqual(a.lines);
		expect(c.lines.map((l: ReportedAnswer) => l.display)).toEqual(a.lines.map((l: ReportedAnswer) => l.display));
	});

	test("the document edges end honestly", async () => {
		for (const [i, note] of DOCUMENT_EDGES.entries()) {
			const r = await solve(["--json", file(`edge-${i}.md`, note)]);
			expect([EXIT.OK, EXIT.FAILED]).toContain(r.code);
			expect(json(r).exitCode).toBe(r.code);
			expectNoLeak(r.out + r.err);
		}
	});

	test("an empty, a blank and a prose-only document answer nothing and exit 0", async () => {
		for (const note of ["", "\n\n", "   \n\t\n", "Just some words about the week.\nAnd more.\n"]) {
			expect(await solve([file(`quiet-${note.length}.md`, note)])).toMatchObject({ code: EXIT.OK, out: "", err: "" });
		}
	});
});

describe("#774 adversarial: edge cases", () => {
	test("the numeric edges as expressions: the engine's own answer, never a leak", async () => {
		const e = createEngine();
		for (const edge of NUMERIC_EDGES) {
			const r = await solve(["-e", edge]);
			expect([EXIT.OK, EXIT.FAILED]).toContain(r.code);
			expectNoLeak(r.out + r.err);
			// What the command prints is what the engine writes, with nothing
			// added or lost on the way: 0/0 reads NaN because the engine says so.
			if (r.code === EXIT.OK) expect(r.out).toBe(`${expressionDisplay(e.formatValue(e.evaluateExpression(edge)))}\n`);
		}
		e.clear();
	});

	test("zero, negative zero and a quotient with no finite answer", async () => {
		expect((await solve(["-e", "0"])).out).toBe("0\n");
		expect((await solve(["-e", "-0"])).code).toBe(EXIT.OK);
		expect((await solve(["1/0"])).out).toBe("\u221e\n");
		expect((await solve(["2^53 + 1"])).out).toBe("9,007,199,254,740,993\n");
	});

	test("the text edges as expressions end with one of the three codes", async () => {
		for (const edge of TEXT_EDGES) {
			const r = await solve(["-e", edge]);
			expect([EXIT.OK, EXIT.FAILED, EXIT.USAGE]).toContain(r.code);
			// eslint-disable-next-line no-control-regex -- looking for these characters is the test
			expect(r.out + r.err).not.toMatch(/[\u001b\u202e\u200b\ufeff]/);
			expectNoLeak(r.out + r.err);
		}
	});

	test("a trailing newline and a document of only CRLF blank lines", async () => {
		expect((await solve([file("trail.md", "1 + 1\n")])).out).toBe("1  1 + 1  = 2\n");
		expect(await solve([file("crlf-blank.md", "\r\n\r\n")])).toMatchObject({ code: EXIT.OK, out: "" });
	});

	test("a file named like an expression, read with -e", async () => {
		const sub = join(dir, "cwd");
		mkdirSync(sub, { recursive: true });
		const path = join(sub, "2");
		writeFileSync(path, "40 + 2\n");
		expect(statSync(path).isFile()).toBe(true);
		expect((await solve([path])).out).toBe("1  40 + 2  = 42\n");
		expect((await solve(["-e", path])).code).toBe(EXIT.FAILED);
	});
});
