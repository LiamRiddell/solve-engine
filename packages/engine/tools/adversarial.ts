/**
 * The shared kit for adversarial tests: inputs chosen to break a feature, and
 * the checks that say what "not broken" means.
 *
 * A happy-path test shows a feature works for the input its author had in mind.
 * An adversarial test attacks it three ways, and a change is not finished until
 * it has faced all three (see the "Adversarial tests" rule in CLAUDE.md and the
 * contributing testing page):
 *
 * - **Security.** Input a hostile document could carry: a word that names an
 *   inherited property (`constructor`, `__proto__`), text built to exhaust
 *   time or memory, characters that look like one thing and are another.
 * - **Realistic breakage.** What real readers and hosts do: a typo, a unit that
 *   does not fit, the feature meeting another feature (a check, a what-if, a
 *   tag), the same document through the other entry point.
 * - **Edge cases.** The boundaries: zero and negative zero, 2^53, the 34-digit
 *   decimal limit, empty and whitespace-only lines, CRLF, a trailing newline.
 *
 * The rule every check here enforces is the engine's own: an answer is either
 * right or an honest refusal that names the problem. A raw JavaScript error, an
 * internal name leaking into what the reader sees, an unexplained NaN, a hang,
 * two entry points disagreeing, and a change to `Object.prototype` are all
 * failures, whatever the input was.
 *
 * Each check comes in two forms. `lineProblems` and `documentProblems` return
 * the problems as a list and assert nothing, so a known open bug can be pinned
 * as a one-assertion `test.failing` (the shape FailingTestShape.spec.ts
 * enforces). `expectHonestLine` and `expectHonestDocument` assert that the list
 * is empty.
 */

import { expect } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import type { Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "./trackedEngine";

/**
 * Words that name a property every plain object inherits. A table looked up by
 * a word the reader typed, and read without an own-property guard, finds these
 * instead of missing (see `__tests__/hardening/PrototypeKeySafety.spec.ts`).
 */
export const PROTOTYPE_WORDS: readonly string[] = [
	"constructor",
	"__proto__",
	"prototype",
	"toString",
	"valueOf",
	"hasOwnProperty",
	"isPrototypeOf",
	"__defineGetter__",
];

/**
 * Numbers at the edges the engine treats specially, written as a reader would
 * type them: signed and negative zero, the exact-integer boundary, the
 * exact-decimal digit limit, the largest and smallest doubles, and the
 * quotients that have no finite answer.
 */
export const NUMERIC_EDGES: readonly string[] = [
	"0",
	"-0",
	"0.0",
	"-1",
	"0.5",
	"-0.5",
	"1/3",
	"0.1 + 0.2",
	"2^53",
	"2^53 + 1",
	"9007199254740993",
	"12345678901234567890123456789012345",
	"0.1234567890123456789012345678901234567",
	"1e308",
	"-1e308",
	"1e-320",
	"1/0",
	"-1/0",
	"0/0",
];

/**
 * Text shapes a line can take that are easy to forget: empty and blank lines,
 * a lone comment or heading, padding, a stray carriage return, invisible and
 * direction-changing characters, digits from other scripts, an emoji, and
 * markup-shaped text that must be read as text rather than acted on.
 */
export const TEXT_EDGES: readonly string[] = [
	"",
	" ",
	"\t",
	"//",
	"// 5",
	"#",
	"# 5",
	"   5   ",
	"5\r",
	"​5",
	"5​",
	"‮5 + 1",
	"﻿5",
	"５",
	"٥",
	"𝟓",
	"5 🙂",
	"<script>alert(1)</script>",
	"'; DROP TABLE notes; --",
	"${5}",
	"%s%s%s%n",
	"\\u0000",
];

/**
 * Whole documents at the edges of line handling: line endings, a trailing
 * newline, blank-only and comment-only notes, a markdown table, a heading
 * between figures, a note that is only prose, and one-character first lines.
 */
export const DOCUMENT_EDGES: readonly string[] = [
	"",
	"\n",
	"\n\n\n",
	"1\r\n2\r\ntotal above",
	"1\n2\ntotal above\n",
	"// a note\n// another",
	"# Heading\n10\n## Sub\n20\ntotal above",
	"| item | cost |\n| --- | --- |\n| food | 10 |",
	"Some prose about the rent.\nMore prose.",
	"x\n5",
	"e\n5",
];

/**
 * Inputs sized to exhaust time or memory if a limit is missing, built on
 * demand so a suite pays only for the ones it uses. `size` scales each probe;
 * the defaults are large enough to expose a missing bound and small enough to
 * run in the fast loop when the bound is there.
 */
export const RESOURCE_PROBES = {
	longSum: (size = 5_000): string => Array.from({ length: size }, (_, i) => String(i)).join(" + "),
	deepParens: (size = 2_000): string => "(".repeat(size) + "1" + ")".repeat(size),
	longText: (size = 100_000): string => `"${"a".repeat(size)}"`,
	longIdentifier: (size = 10_000): string => "x".repeat(size),
	hugePower: (): string => "2^(10^9)",
	hugeRange: (): string => "0:9999999",
	manyLines: (size = 2_000, line = "prev + 1"): string => ["1", ...Array.from({ length: size }, () => line)].join("\n"),
};

/**
 * Text that means an internal detail reached the reader: a stringified object,
 * a JavaScript runtime message, or an internal spelling the engine uses for
 * itself. `tan is undefined at 90 degrees` is a legitimate message, so the bare
 * word "undefined" is not on the list; an answer of `undefined` is, below.
 */
const LEAK_MARKERS: readonly string[] = [
	"[object Object]",
	"[object ",
	"Cannot read propert",
	"is not a function",
	"is not iterable",
	"Maximum call stack",
	"eval_failed",
	"exec_failed",
	"mps2",
	"timecode@",
];

/** What an adversarial check allows beyond the defaults. */
export interface HonestyOptions {
	/** The most milliseconds the line or each document pass may take. Generous by default, so a slow runner is not a failure. */
	readonly budgetMs?: number;
	/** Whether an answer of NaN is documented for this input (`0/0` is), rather than an unexplained one. */
	readonly allowNaN?: boolean;
	/** An engine to use instead of a fresh one, for a check that depends on configuration or earlier lines. */
	readonly engine?: ExpressionEngine;
}

/** How one line came out: an answer, an error Value, a thrown EngineError, or a raw JavaScript error. */
export type LineOutcome =
	| { readonly kind: "value"; readonly text: string; readonly value: Value }
	| { readonly kind: "error"; readonly code: string; readonly message: string }
	| { readonly kind: "thrown"; readonly code: string; readonly message: string }
	| { readonly kind: "crashed"; readonly name: string; readonly message: string };

/** The leak markers found in `text`, as readable reasons. */
function leaksIn(text: string, allowNaN: boolean): string[] {
	const found = LEAK_MARKERS.filter((m) => text.includes(m)).map((m) => `leaks "${m}"`);
	if (/(^|=\s*)undefined\b/.test(text)) found.push("answers undefined");
	if (!allowNaN && /(^|=\s*)NaN\b/.test(text)) found.push("answers NaN");
	return found;
}

/** A source string short enough to read in a failure message. */
function shortly(source: string): string {
	return JSON.stringify(source.length > 120 ? `${source.slice(0, 120)}...` : source);
}

/**
 * Evaluate one line the way a host does and classify what came back. An
 * `EngineError` is the documented way a line fails to parse; any other thrown
 * error is a crash in the engine, whatever the input.
 */
export function evaluateLine(source: string, engine: ExpressionEngine = newTrackedEngine()): LineOutcome {
	let value: Value;
	try {
		value = engine.evaluateExpression(source);
	} catch (error) {
		if (error instanceof EngineError) return { kind: "thrown", code: error.code, message: error.message };
		const e = error as Error;
		return { kind: "crashed", name: e?.constructor?.name ?? typeof error, message: String(e?.message ?? error) };
	}
	if (value.isError()) return { kind: "error", code: String(value.errorCode ?? ""), message: String(value.errorMessage ?? "") };
	return { kind: "value", text: formatValue(value), value };
}

/**
 * Every way a line fails to be answered honestly: past the time budget, a raw
 * JavaScript error, an error without a code or a message, or an internal detail
 * leaking into what the reader sees. Asserts nothing.
 *
 * This checks honesty, not correctness: it cannot know the right answer to an
 * arbitrary input. Pair it with an ordinary assertion wherever the right answer
 * is known.
 */
export function lineProblems(source: string, options: HonestyOptions = {}): { outcome: LineOutcome; problems: string[] } {
	const budget = options.budgetMs ?? 2_000;
	const started = performance.now();
	const outcome = evaluateLine(source, options.engine);
	const elapsed = performance.now() - started;
	const problems: string[] = [];
	if (elapsed > budget) problems.push(`took ${Math.round(elapsed)} ms, past ${budget} ms`);
	if (outcome.kind === "crashed") {
		problems.push(`threw a raw ${outcome.name}: ${outcome.message.slice(0, 160)}`);
	} else if (outcome.kind === "value") {
		problems.push(...leaksIn(outcome.text, options.allowNaN ?? false));
	} else {
		if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(outcome.code)) problems.push(`error code ${JSON.stringify(outcome.code)} is not a code`);
		if (outcome.message.trim() === "") problems.push("error has no message");
		problems.push(...leaksIn(outcome.message, true));
	}
	return { outcome, problems };
}

/**
 * Assert that a line is answered honestly; see {@link lineProblems}.
 *
 * @returns The outcome, for a test that goes on to assert more.
 */
export function expectHonestLine(source: string, options: HonestyOptions = {}): LineOutcome {
	const { outcome, problems } = lineProblems(source, options);
	expect({ line: shortly(source), problems }).toEqual({ line: shortly(source), problems: [] });
	return outcome;
}

/** A document's lines as comparable text: each answer formatted, each failure as its message. */
function documentLines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		const v = line.result;
		if (v == null) return line.error ? `ERROR ${line.error}` : "";
		if (v.isError()) return `ERROR ${String(v.errorMessage ?? "")}`;
		return formatValue(v);
	});
}

/**
 * Every way a whole document fails to be handled honestly through the two
 * document passes: a raw JavaScript error, past the time budget, a leaked
 * internal on any line, and, unless `agree` is false, a line the two passes
 * answer differently or a different number of lines. Asserts nothing.
 *
 * Lines the batch pass treats as prose (no answer) are compared only where the
 * incremental pass answered them, since the incremental pass reports prose as
 * an error value by design; any error compares equal to any other error.
 */
export function documentProblems(
	text: string,
	options: HonestyOptions & { readonly agree?: boolean } = {},
): { batch: string[]; incremental: string[]; problems: string[] } {
	const budget = options.budgetMs ?? 5_000;
	const problems: string[] = [];
	const run = (label: string, pass: () => ParsingResult): string[] => {
		const started = performance.now();
		let lines: string[];
		try {
			lines = documentLines(pass());
		} catch (error) {
			if (error instanceof EngineError) return [`ERROR ${error.message}`];
			const e = error as Error;
			problems.push(`${label} threw a raw ${e?.constructor?.name}: ${String(e?.message).slice(0, 160)}`);
			return [];
		}
		const elapsed = performance.now() - started;
		if (elapsed > budget) problems.push(`${label} took ${Math.round(elapsed)} ms, past ${budget} ms`);
		lines.forEach((line, i) => {
			for (const leak of leaksIn(line, options.allowNaN ?? false)) problems.push(`${label} line ${i + 1} ${leak}`);
		});
		return lines;
	};
	const batch = run("parseDocument", () => newTrackedEngine().parseDocument(text));
	const incremental = run("evaluateDocument", () => evaluateDocument(newTrackedEngine(), text));
	if (options.agree !== false && problems.length === 0) {
		if (batch.length !== incremental.length) {
			problems.push(`parseDocument has ${batch.length} lines, evaluateDocument has ${incremental.length}`);
		} else {
			batch.forEach((b, i) => {
				const n = incremental[i];
				const same = b === n || (b.startsWith("ERROR") && n.startsWith("ERROR")) || (b === "" && n.startsWith("ERROR"));
				if (!same) problems.push(`line ${i + 1}: parseDocument ${JSON.stringify(b)}, evaluateDocument ${JSON.stringify(n)}`);
			});
		}
	}
	return { batch, incremental, problems };
}

/**
 * Assert that a whole document is handled honestly through both passes; see
 * {@link documentProblems}.
 */
export function expectHonestDocument(
	text: string,
	options: HonestyOptions & { readonly agree?: boolean } = {},
): { batch: string[]; incremental: string[] } {
	const { batch, incremental, problems } = documentProblems(text, options);
	expect({ document: shortly(text), problems }).toEqual({ document: shortly(text), problems: [] });
	return { batch, incremental };
}

/**
 * Run `body` and assert that `Object.prototype` has the same own properties
 * after it as before. A document that writes through `__proto__` changes every
 * object in the process, which is the worst outcome a hostile word can have.
 */
export function expectPrototypeUntouched(body: () => void): void {
	const before = Object.getOwnPropertyNames(Object.prototype).sort();
	body();
	expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
}

/**
 * A feature's template filled with each value of a corpus, for a test that runs
 * one form over every edge: `fill("round(X, 2)", NUMERIC_EDGES)`. `X` is the
 * placeholder; a value with a space or an operator in it is bracketed so it
 * stays one operand.
 */
export function fill(template: string, corpus: readonly string[], placeholder = "X"): string[] {
	return corpus.map((value) => template.split(placeholder).join(/[\s+\-*/^:]/.test(value.trim()) ? `(${value})` : value));
}
