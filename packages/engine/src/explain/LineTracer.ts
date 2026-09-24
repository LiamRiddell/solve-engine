import type { Token } from "@solve-js/lexer/Token";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { extractReadsAndWrites } from "@solve-js/engine/ExpressionEngineSafety";
import type { LineTrace } from "./Explanation";

/**
 * Where a line's answer came from, worked out from the document's text.
 *
 * A line reads other lines three ways: by a variable another line defines
 * (`deposit`), by position (`line 2`, `prev`, `total above`, `sum(line 1 :
 * line 3)`), and by a category tag (`total of #food`). This module reads each
 * line's normalised tokens, the same tokens the line was compiled from, and
 * follows those reads upwards, line by line, into a {@link LineTrace}.
 *
 * It reads text and answers, never the engine's dependency graph. The graph
 * is kept only on the incremental path (the batch pass does not record which
 * positions a line read), so a trace built from it would say one thing through
 * `parseDocument` and another through `evaluateDocument`. The text and the
 * answers are the same through both, so a trace built from them is too.
 *
 * A variable resolves to the nearest line above the reader that defines it,
 * because that is the definition in force when the reader ran: a variable's
 * value is positional, and a later redefinition does not reach back.
 */

/** A document as the tracer sees it. Both document paths and a host's `ParsingResult` are adapted to this. */
export interface TraceSource {
	/** How many lines the document has. */
	readonly lineCount: number;
	/** The evaluable expressions on a line: one for an ordinary line, one per inline solve, none for prose. */
	expressions(line: number): readonly string[];
	/** A line's answer, or `null` when it has none. */
	result(line: number): Value | null;
	/** Whether a line is blank or a heading, where `total above` stops. */
	isBoundary(line: number): boolean;
	/** The lines carrying `#tag`, ascending. */
	taggedLines(tag: string): readonly number[];
}

/** How far a trace is followed, and from where. */
export interface TraceOptions {
	/** How many levels of inputs below the traced line are listed. */
	readonly maxDepth: number;
	/** How many lines one trace may list in all, across every level. */
	readonly maxLines: number;
	/**
	 * Whether a forward reference (a line reading a line below it) is followed.
	 * The `inputs of` form does not: from inside a pass, a line below the reader
	 * has not been worked out, so it is reported rather than read.
	 */
	readonly followForward: boolean;
}

/** The trace limits a host gets when it names none: ten levels, two hundred lines. */
export const DEFAULT_TRACE_OPTIONS: TraceOptions = { maxDepth: 10, maxLines: 200, followForward: true };

/** One read a line makes, before it is resolved to lines. */
type Read =
	| { readonly order: number; readonly kind: "variable"; readonly name: string }
	| { readonly order: number; readonly kind: "lines"; readonly lines: readonly number[]; readonly via: string };

/** What a line defines and what it reads, from its tokens. */
interface LineReads {
	/** Names the line defines with `=` (a definition, not a running total), in order. */
	readonly defines: readonly string[];
	/** Every name the line writes, running totals included. */
	readonly writes: ReadonlySet<string>;
	/** The reads, in the order the text makes them. */
	readonly reads: readonly Read[];
}

const NO_READS: LineReads = { defines: [], writes: new Set(), reads: [] };

/** The aggregate tokens that read a block of lines above them. */
const ABOVE_TOKENS: ReadonlySet<string> = new Set(["TOTAL_ABOVE", "SUM_ABOVE", "AVERAGE_ABOVE"]);
/** The call tokens that read an explicit span, `sum(line 1 : line 3)`. */
const RANGE_TOKENS: ReadonlySet<string> = new Set(["SUM_RANGE_CALL", "AVERAGE_RANGE_CALL"]);
/** The category-tag aggregate tokens, whose value is the tag name. */
const TAG_TOKENS: ReadonlySet<string> = new Set(["TAG_SUM", "TAG_AVERAGE", "TAG_COUNT"]);

/** A name as a reader would write it: a `global :rate` key shows as `rate`. */
function displayName(key: string): string {
	return key.startsWith("global:") ? key.slice("global:".length) : key;
}

/**
 * Read one line's definitions and reads from its expressions' tokens.
 *
 * The variable reads are the engine's own (`extractReadsAndWrites`, the
 * function that feeds the dependency graph), with one adjustment: a definition
 * `:payment = ...` lists its own name as a read, because the graph keys a
 * definition that way, and a trace must not report the line as reading the
 * name it is defining. So one occurrence of each defined name is dropped, and
 * a definition that genuinely reads its own previous value (`:x = x + 1`)
 * keeps the other.
 */
function readLine(
	line: number,
	expressions: readonly string[],
	tokensOf: (expression: string) => readonly Token[] | null,
	source: TraceSource,
): LineReads {
	if (expressions.length === 0) return NO_READS;
	const defines: string[] = [];
	const writes = new Set<string>();
	const reads: Read[] = [];
	let offset = 0;

	for (const expression of expressions) {
		const tokens = tokensOf(expression);
		if (tokens === null) continue;
		const extracted = extractReadsAndWrites(tokens as Token[]);
		for (const w of extracted.writes) writes.add(w);

		// A write through `=` is a definition; through `+=`/`-=` it is a
		// running total, which reads its own previous value and keeps it.
		const compound = new Set<string>();
		for (let i = 0; i + 1 < tokens.length; i++) {
			const next = tokens[i + 1].type;
			if (next === "PLUS_EQUALS" || next === "MINUS_EQUALS") compound.add(tokens[i].value);
		}
		const remaining = extracted.reads.slice();
		for (const w of extracted.writes) {
			if (compound.has(w)) continue;
			if (!defines.includes(w)) defines.push(w);
			const at = remaining.indexOf(w);
			if (at !== -1) remaining.splice(at, 1);
		}
		const readNames = [...new Set(remaining)];

		// Order each variable read by the first token that spells it and is not
		// its own definition site, so reads interleave with positional ones in
		// the order the line is written.
		const firstSeen = new Map<string, number>();
		for (let i = 0; i < tokens.length; i++) {
			const t = tokens[i];
			if (t.type !== "IDENT" && t.type !== "UNIT") continue;
			if (firstSeen.has(t.value) || !readNames.includes(t.value)) continue;
			const definitionSite = defines.includes(t.value) && tokens[i + 1]?.type === "EQUALS";
			if (!definitionSite) firstSeen.set(t.value, i);
		}
		for (const name of readNames) {
			reads.push({ order: offset + (firstSeen.get(name) ?? tokens.length), kind: "variable", name });
		}

		// Positional and tag reads, straight off the tokens that make them.
		const inRange = new Set<number>();
		for (let i = 0; i < tokens.length; i++) {
			const t = tokens[i];
			if (RANGE_TOKENS.has(t.type)) {
				// `sum(line a : line b)`: the two references and every line between.
				const a = tokens.findIndex((x, j) => j > i && x.type === "LINE_REF");
				const b = a === -1 ? -1 : tokens.findIndex((x, j) => j > a && x.type === "LINE_REF");
				if (a !== -1 && b !== -1) {
					inRange.add(a);
					inRange.add(b);
					const from = parseInt(tokens[a].value, 10);
					const to = parseInt(tokens[b].value, 10);
					const lines: number[] = [];
					const last = Math.min(source.lineCount, Math.max(from, to));
					for (let n = Math.max(1, Math.min(from, to)); n <= last; n++) lines.push(n);
					reads.push({ order: offset + i, kind: "lines", lines, via: `line ${from} : line ${to}` });
				}
			} else if (t.type === "LINE_REF" && !inRange.has(i)) {
				const n = parseInt(t.value, 10);
				reads.push({ order: offset + i, kind: "lines", lines: [n], via: `line ${n}` });
			} else if (t.type === "PREV") {
				reads.push({ order: offset + i, kind: "lines", lines: [line - 1], via: "prev" });
			} else if (ABOVE_TOKENS.has(t.type)) {
				const lines: number[] = [];
				for (let n = line - 1; n >= 1 && !source.isBoundary(n); n--) lines.unshift(n);
				reads.push({ order: offset + i, kind: "lines", lines, via: "above" });
			} else if (TAG_TOKENS.has(t.type)) {
				const lines = source.taggedLines(t.value).filter((n) => n !== line);
				reads.push({ order: offset + i, kind: "lines", lines, via: `#${t.value.toLowerCase()}` });
			}
		}
		offset += tokens.length + 1;
	}

	reads.sort((x, y) => x.order - y.order);
	return { defines, writes, reads };
}

/**
 * Follow a line's inputs upwards into a {@link LineTrace}.
 *
 * Every line is read once per trace and remembered, so a trace over a long
 * document costs one pass over the lines it touches, however many times a
 * variable's definition is looked for. The trace is bounded three ways: a line
 * already on the path is marked as a cycle rather than followed again, the
 * depth stops at `options.maxDepth` levels, and the whole trace at
 * `options.maxLines` lines. A line cut off by either bound is marked
 * `truncated`, so a reader can tell "reads nothing" from "not listed".
 *
 * @param source - The document to read.
 * @param tokensOf - The engine's normalised tokens for an expression, or `null` when it does not tokenise.
 * @param line - The 1-based line to trace.
 * @param options - How far to follow it.
 * @returns The trace, rooted at `line`.
 */
export function buildLineTrace(
	source: TraceSource,
	tokensOf: (expression: string) => readonly Token[] | null,
	line: number,
	options: TraceOptions,
): LineTrace {
	const readCache = new Map<number, LineReads>();
	const readsOf = (n: number): LineReads => {
		let cached = readCache.get(n);
		if (cached === undefined) {
			cached = n >= 1 && n <= source.lineCount ? readLine(n, source.expressions(n), tokensOf, source) : NO_READS;
			readCache.set(n, cached);
		}
		return cached;
	};

	/** The nearest line above `below` that writes `name`, or 0 when none does. */
	const definitionAbove = (name: string, below: number): number => {
		for (let n = below - 1; n >= 1; n--) if (readsOf(n).writes.has(name)) return n;
		return 0;
	};

	/** A line's direct inputs, merged by line, in reading order. */
	const inputsOf = (n: number): Array<{ line: number; via: string[] }> => {
		const merged = new Map<number, string[]>();
		for (const read of readsOf(n).reads) {
			if (read.kind === "variable") {
				const producer = definitionAbove(read.name, n);
				if (producer === 0) continue; // a constant, a unit, or a name nothing above defines
				const via = merged.get(producer);
				const label = displayName(read.name);
				if (via === undefined) merged.set(producer, [label]);
				else if (!via.includes(label)) via.push(label);
				continue;
			}
			for (const m of read.lines) {
				if (m < 1 || m > source.lineCount) continue;
				const via = merged.get(m);
				if (via === undefined) merged.set(m, [read.via]);
				else if (!via.includes(read.via)) via.push(read.via);
			}
		}
		return [...merged].map(([m, via]) => ({ line: m, via }));
	};

	let budget = options.maxLines;
	const path = new Set<number>();

	/** The name a line is known by: what it defines, else the running total it adds to. */
	const nameOf = (n: number): string | null => {
		const reads = readsOf(n);
		const key = reads.defines[0] ?? reads.writes.values().next().value;
		return key === undefined ? null : displayName(key);
	};

	const visit = (n: number, via: readonly string[], depth: number, reader: number | null): LineTrace => {
		const name = nameOf(n);
		const forward = reader !== null && n > reader;
		if (path.has(n)) {
			return { line: n, name, value: source.result(n), via, inputs: [], cycle: true, forward, truncated: false };
		}
		if (forward && !options.followForward) {
			return { line: n, name, value: null, via, inputs: [], cycle: false, forward, truncated: false };
		}
		budget--;
		const direct = inputsOf(n);
		const value = source.result(n);
		if (direct.length > 0 && (depth >= options.maxDepth || budget <= 0)) {
			return { line: n, name, value, via, inputs: [], cycle: false, forward, truncated: true };
		}
		path.add(n);
		const inputs = direct.map((d) => visit(d.line, d.via, depth + 1, n));
		path.delete(n);
		return { line: n, name, value, via, inputs, cycle: false, forward, truncated: false };
	};

	return visit(line, [], 0, null);
}

/** The first line in a trace, depth first, that satisfies `test`, with the line that read it. */
function findInTrace(
	trace: LineTrace,
	test: (node: LineTrace) => boolean,
	reader: LineTrace | null = null,
): { node: LineTrace; reader: LineTrace | null } | null {
	if (test(trace)) return { node: trace, reader };
	for (const input of trace.inputs) {
		const found = findInTrace(input, test, trace);
		if (found) return found;
	}
	return null;
}

/**
 * The first place a trace cannot be read as an order of working: a cycle (two
 * lines reading each other) or a forward reference (a line reading one below
 * it). Cycles are looked for first, since a cycle through a line below is
 * still, first of all, a cycle.
 *
 * @param trace - A trace from {@link buildLineTrace}.
 * @returns The problem, the line it was found at and the line that read it, or `null`.
 */
export function traceProblem(trace: LineTrace): { kind: "cycle" | "forward"; line: number; reader: number } | null {
	const cycle = findInTrace(trace, (node) => node.cycle);
	if (cycle) return { kind: "cycle", line: cycle.node.line, reader: cycle.reader?.line ?? cycle.node.line };
	const forward = findInTrace(trace, (node) => node.forward);
	if (forward) return { kind: "forward", line: forward.node.line, reader: forward.reader?.line ?? forward.node.line };
	return null;
}

/** A line's answer as the display shows it, without the leading `= `; an error reads as `error`. */
function shown(value: Value | null): string | null {
	if (value === null) return null;
	if (value.type === ValueType.Error) return "error";
	return formatValue(value, DEFAULT_FORMATTING_SETTINGS).replace(/^=\s*/, "");
}

/** One line of a trace as text: `payment 527.84 (line 4)`. */
function head(node: LineTrace): string {
	const parts = [node.name, shown(node.value)].filter((p): p is string => p !== null && p !== "");
	return parts.length === 0 ? `line ${node.line}` : `${parts.join(" ")} (line ${node.line})`;
}

/** A line with its own inputs in brackets, for the levels below the first. */
function nested(node: LineTrace): string {
	if (node.truncated) return `${head(node)} <- [...]`;
	if (node.inputs.length === 0) return head(node);
	return `${head(node)} <- [${node.inputs.map(nested).join(", ")}]`;
}

/**
 * A trace as one line of text, the form `inputs of line N` answers with.
 *
 * The traced line comes first, then `<-` and the lines it read, separated by
 * commas. A line that itself read others carries them in brackets after its
 * own `<-`, so the nesting reads unambiguously however deep it goes, and a line
 * whose inputs the depth bound cut off ends in `<- [...]`:
 *
 * ```text
 * payment 527.84 (line 4) <- deposit 100,000 (line 2), rate 4.00% (line 1)
 * ```
 *
 * @param trace - A trace from `ExpressionEngine.traceLine()`.
 * @returns The trace as text.
 */
export function formatLineTrace(trace: LineTrace): string {
	if (trace.truncated) return `${head(trace)} <- [...]`;
	if (trace.inputs.length === 0) return `${head(trace)} reads no other line`;
	return `${head(trace)} <- ${trace.inputs.map(nested).join(", ")}`;
}
