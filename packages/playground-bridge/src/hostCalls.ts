/**
 * The host calls a whole-document feature relies on, shaped for the
 * playground: the document's answers through the incremental pass (so goal
 * seek resolves), a what-if, an explanation, a trace, and the language
 * service's reference calls (go to definition, find references, rename, and
 * keeping `line N` references in place when lines move).
 *
 * Each call builds its own engine and clears it before returning, so nothing
 * here shares state with the debug pipeline or with another call, and none of
 * them reaches the network: the what-if and the explanation re-run lines, and
 * a live lookup is not something a re-run should start.
 *
 * Every call answers; none throws. A failure comes back as `{ error, code }`
 * with the engine's own message and code, so a panel can show it as it is.
 */

import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { LanguageService } from "@solve-js/language/LanguageService";
import {
	applyTextEdits,
	type DocumentPosition,
	type LineShift,
	type TextEdit,
	type VariableReference,
} from "@solve-js/language/DocumentReferences";
import { formatLineTrace } from "@solve-js/explain/LineTracer";
import { normalizeUnknownError } from "@solve-js/errors/EngineError";
import { ValueType, type Value } from "@solve-js/vm/Value";
import type { ParsedLine, ParsingResult } from "@solve-js/types/ParsingResult";
import { PLAYGROUND_PACKAGES } from "./playgroundPackages.js";

/** A call that could not answer: the engine's message and code. */
export interface HostCallFailure {
	error: string;
	code: string;
}

/** One line of a document as a panel shows it. */
export interface HostLine {
	lineNumber: number;
	text: string;
	/** The answer as the engine writes it (`= 170,507.23`), or the failure's message; empty for prose. */
	shown: string;
	/** The failure's code, when the line failed. */
	errorCode?: string;
}

/** Build a playground engine with live data off, run `body` on it, and clear it whatever happens. */
function withEngine<T>(body: (engine: ExpressionEngine) => T): T | HostCallFailure {
	const engine = new ExpressionEngine({ packages: PLAYGROUND_PACKAGES, config: { network: { enabled: false } } });
	try {
		return body(engine);
	} catch (error) {
		const coded = normalizeUnknownError(error);
		return { error: coded.message, code: coded.code };
	} finally {
		engine.clear();
	}
}

/** Whether a call answered with a failure rather than a result. */
export function isFailure(value: unknown): value is HostCallFailure {
	return typeof value === "object" && value !== null && typeof (value as HostCallFailure).error === "string" && typeof (value as HostCallFailure).code === "string";
}

/** A value as a panel shows it, and its code when it is an error. */
function showValue(value: Value | null): { shown: string; errorCode?: string } {
	if (value === null) return { shown: "" };
	if (value.type === ValueType.Error) return { shown: String(value.unit ?? value.value), errorCode: String(value.value) };
	return { shown: formatValue(value) };
}

/** A document line as a panel shows it. */
function hostLine(line: ParsedLine): HostLine {
	if (line.error !== null) return { lineNumber: line.lineNumber, text: line.text, shown: line.error, errorCode: line.errorCode ?? undefined };
	return { lineNumber: line.lineNumber, text: line.text, ...showValue(line.result) };
}

/**
 * The document's answers through the incremental pass, the one a live editor
 * runs, which can re-run a line, so goal seek, what-if lines and sweeps
 * resolve. The debug pipeline evaluates a line at a time and cannot, which is
 * why a goal seek there answered `GOAL_SEEK_LINE_NOT_READY` (#776).
 *
 * Live data is off here: a line that fetches answers `NETWORK_DISABLED`, and
 * the caller keeps its own (possibly live) answer for such a line.
 */
export function documentAnswers(text: string): ParsingResult | HostCallFailure {
	return withEngine((engine) => evaluateDocument(engine, text));
}

/**
 * Read a what-if's inputs from what a reader types in the panel:
 * `deposit = 200000, rate = 5%`. Each is a name, `=`, and a value the engine
 * evaluates on its own; a comma or a new line separates them.
 */
export function parseOverrides(input: string): Record<string, string> | HostCallFailure {
	const overrides: Record<string, string> = Object.create(null);
	const parts = input.split(/[,\n]/).map((p) => p.trim()).filter((p) => p !== "");
	if (parts.length === 0) return { error: "Name at least one input to change, such as deposit = 200000.", code: "WHAT_IF_OVERRIDE_INVALID" };
	for (const part of parts) {
		const m = /^:?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(part);
		if (m === null) return { error: `"${part}" is not an input: write a name, =, and a value, such as rate = 5%.`, code: "WHAT_IF_OVERRIDE_INVALID" };
		overrides[m[1]] = m[2].trim();
	}
	return overrides;
}

/** A what-if's result: every line before and after, and which ones changed. */
export interface WhatIfLines {
	lines: Array<HostLine & { before: string; changed: boolean }>;
}

/**
 * Re-run the document with some inputs changed (`engine.whatIf`), and set each
 * line's answer beside the one the document gives now.
 */
export function whatIfLines(text: string, overrides: Record<string, string>): WhatIfLines | HostCallFailure {
	return withEngine((engine) => {
		const before = evaluateDocument(engine, text).lines.map(hostLine);
		const after = engine.whatIf(text, overrides).lines.map(hostLine);
		return {
			lines: after.map((line, i) => ({ ...line, before: before[i]?.shown ?? "", changed: (before[i]?.shown ?? "") !== line.shown })),
		};
	});
}

/** A derivation as a panel shows it. */
export interface ExplainedLine {
	expression: string;
	steps: Array<{ description: string; shown: string }>;
	result: string;
}

/**
 * How line `lineNumber` reached its answer (`engine.explainLine`), read
 * against the document above it: the document is evaluated first, so the
 * names the line reads hold what the lines above define.
 */
export function explainDocumentLine(text: string, lineNumber: number): ExplainedLine | HostCallFailure {
	return withEngine((engine) => {
		const document = evaluateDocument(engine, text);
		const line = document.lines[lineNumber - 1];
		if (line === undefined) return { error: `The document has ${document.lines.length} line(s), so there is no line ${lineNumber}.`, code: "TRACE_NO_SUCH_LINE" };
		const explanation = engine.explainLine(line.expression ?? line.text);
		return {
			expression: explanation.expression,
			steps: explanation.steps.map((s) => ({ description: s.description, shown: formatValue(s.value) })),
			result: formatValue(explanation.result),
		};
	});
}

/** A trace as a panel shows it: the one-line summary, and the tree. */
export interface TracedLine {
	summary: string;
	trace: ReturnType<ExpressionEngine["traceLine"]>;
}

/** Where line `lineNumber`'s answer came from (`engine.traceLine`), through the incremental pass. */
export function traceDocumentLine(text: string, lineNumber: number): TracedLine | HostCallFailure {
	return withEngine((engine) => {
		const document = evaluateDocument(engine, text);
		const trace = engine.traceLine(lineNumber, { document });
		return { summary: formatLineTrace(trace), trace };
	});
}

/** Every place the variable at `position` is named. Empty when it is not on one. */
export function referencesAt(text: string, position: DocumentPosition): VariableReference[] | HostCallFailure {
	return withEngine((engine) => new LanguageService(engine).findReferences(text, position));
}

/** The definition the variable at `position` reads, or null. */
export function definitionAt(text: string, position: DocumentPosition): VariableReference | null | HostCallFailure {
	return withEngine((engine) => new LanguageService(engine).getDefinition(text, position));
}

/** Rename the variable at `position`, answering the new document text or the named refusal. */
export function renameAt(text: string, position: DocumentPosition, newName: string): { text: string; edits: number } | HostCallFailure {
	return withEngine((engine) => {
		const result = new LanguageService(engine).rename(text, position, newName);
		if (!result.ok) return { error: result.message, code: result.code };
		return { text: applyTextEdits(text, result.edits), edits: result.edits.length };
	});
}

/**
 * Keep `line N` references on the lines they meant after lines were inserted
 * or deleted: the edits, and the corrected text (the text unchanged when no
 * reference moved).
 */
export function shiftReferences(text: string, change: LineShift): { text: string; edits: readonly TextEdit[] } | HostCallFailure {
	return withEngine((engine) => {
		const result = new LanguageService(engine).shiftLineReferences(text, change);
		if (!result.ok) return { error: result.message, code: result.code };
		return { text: applyTextEdits(text, result.edits), edits: result.edits };
	});
}

/**
 * Describe an edit to a document in whole lines, for {@link shiftReferences}:
 * the line count before and after, and where the one changed range began and
 * ended in the old text (as line numbers and whether each end sits at the
 * start of its line). Null when the line count did not change, which moves no
 * line.
 *
 * A newline typed at the end of line 3 inserts a line at 4, and at the start
 * of line 3 it inserts one at 3; a run of whole lines removed from the start
 * of a line deletes from that line, and a join (backspace at the start of line
 * 4) deletes line 4.
 */
export function describeLineShift(edit: {
	oldLineCount: number;
	newLineCount: number;
	fromLine: number;
	fromAtLineStart: boolean;
	toAtLineStart: boolean;
	insertedEndsWithNewline: boolean;
}): LineShift | null {
	const delta = edit.newLineCount - edit.oldLineCount;
	if (delta === 0 || !Number.isInteger(delta) || edit.fromLine < 1) return null;
	if (delta > 0) {
		const line = edit.fromAtLineStart && edit.insertedEndsWithNewline ? edit.fromLine : edit.fromLine + 1;
		return { kind: "insert", line, count: delta };
	}
	const line = edit.fromAtLineStart && edit.toAtLineStart ? edit.fromLine : edit.fromLine + 1;
	return { kind: "delete", line, count: -delta };
}
