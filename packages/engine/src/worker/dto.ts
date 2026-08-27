/**
 * The serialisable result shapes the worker harness posts back across the
 * boundary, one clone-safe projection per public result type.
 *
 * A raw {@link Value} cannot be posted: it carries `bigint`, class-instance
 * matrix cells, symbolic trees, and the exact-decimal/rational sidecars, none
 * of which structured cloning reproduces faithfully (and `bigint` alone breaks
 * `JSON.stringify`). These interfaces are what crosses instead. Every field is
 * a string, number, boolean, or an object of those, so a whole
 * {@link SerializedParsingResult} survives both `structuredClone` (what
 * `postMessage` uses) and `JSON` (what a host may cache or log), which is the
 * property `worker/serialize.ts` is built to guarantee.
 */

import type { ValueType, ColourFormat } from "@solve-js/vm/Value";
import type { DiagnosticReportJSON } from "@solve-js/diagnostics";

/**
 * A matrix flattened for transport.
 *
 * `cells` is column-major, the same order as {@link MatrixData.data}, so a host
 * indexes it identically. Finite numeric and boolean cells pass through as
 * themselves; a symbolic cell (a free-variable algebraic entry) becomes its
 * formatted string, since a `SymbolicNode` is a class instance that would not
 * survive the clone; and a non-finite numeric cell (`Infinity`/`-Infinity`/`NaN`,
 * from e.g. a `[1/0, 2]`) becomes the same string tag the scalar
 * {@link SerializedValue.nonFinite} uses, because a raw non-finite number does
 * not survive `JSON` (it becomes `null`). A host reads a numeric string cell
 * back with `Number(cell)`.
 */
export interface SerializedMatrix {
	rows: number;
	cols: number;
	cells: Array<number | boolean | string>;
	hasSymbolic: boolean;
}

/**
 * A single evaluated value, projected onto clone-safe fields.
 *
 * `text` is the formatted display string a host renders, and `number` is the
 * numeric reading ({@link Value.toNumber}), present for every type (0 where a
 * value has no numeric meaning, matching the engine's own convention). The
 * type-specific fields below carry the rest of the payload where it does not
 * fit in a plain number: `bigint` as a base-ten string, `matrix` and `range`
 * as their own shapes.
 */
export interface SerializedValue {
	/** The {@link ValueType} discriminant (a number), so a host can branch on the kind. */
	type: ValueType;
	/** The formatted display string, what a host renders against the line. */
	text: string;
	/**
	 * The numeric reading via {@link Value.toNumber}: 0 for non-numeric types.
	 * Always finite so the DTO survives `JSON` (which turns `Infinity`/`NaN` into
	 * `null`): when the true reading is non-finite this is 0 and {@link nonFinite}
	 * names the real value. Read `nonFinite ? Number(nonFinite) : number` to
	 * recover it.
	 */
	number: number;
	/**
	 * Set only when the numeric reading is non-finite (`1/0`, `0/0`, an overflow),
	 * to a string a host turns back into the value with `Number(...)`. Carried
	 * separately because a non-finite number cannot cross `JSON`; see {@link number}.
	 */
	nonFinite?: "Infinity" | "-Infinity" | "NaN";
	/** Unit annotation for unit-of-measurement and non-decimal-base values, when present. */
	unit?: string;
	/** Base-ten string for a `bigint` payload, so no `BigInt` ever crosses `JSON`. */
	bigint?: string;
	/** Matrix shape and cells, present only for {@link ValueType.Matrix}. */
	matrix?: SerializedMatrix;
	/** Inclusive integer range bounds, present only for {@link ValueType.Range}. */
	range?: { min: number; max: number };
	/**
	 * Colour payload, present only for {@link ValueType.Colour}. `hex` is the
	 * canonical `#rrggbb`/`#rrggbbaa`; `r`,`g`,`b` are 0-255, `a` is 0-1;
	 * `format` is the authored form; `css` is a render-ready CSS string, so a
	 * host draws a swatch (e.g. `background: css`) with no recomputation.
	 */
	colour?: {
		hex: string;
		r: number;
		g: number;
		b: number;
		a: number;
		format: ColourFormat;
		css: string;
	};
	/**
	 * Chart payload, present only for {@link ValueType.Chart}: the specification a
	 * host renders with its own charting library. `kind` selects the renderer
	 * (`sparkline`/`plot`); `points` are the `(x, y)` to draw, scaled to `domain`
	 * × `range`; `label` is the plain-text answer; `expr` is the source
	 * expression for a plot. The engine emits data, never pixels. See issues #186,
	 * #187.
	 */
	chart?: {
		kind: string;
		points: Array<[number, number]>;
		label: string;
		domain: [number, number];
		range: [number, number];
		expr?: string;
	};
	/**
	 * IP/CIDR payload, present only for {@link ValueType.IpCidr}: the 32-bit
	 * `addr` and/or CIDR `prefix`, plus `text` (the dotted-quad form the answer
	 * shows). See issue #189.
	 */
	ipCidr?: {
		addr?: number;
		prefix?: number;
		text: string;
	};
	/** Whether an async fallback timed out, carried through when the engine set it. */
	timedOut?: boolean;
}

/**
 * One inline solve and its serialised result, mirroring
 * {@link InlineSolvePosition} with the live `Value` replaced by a
 * {@link SerializedValue}.
 */
export interface SerializedInlineSolve {
	start: number;
	end: number;
	expression: string;
	lineNumber: number;
	columnNumber: number;
	result: SerializedValue | null;
	error: string | null;
}

/**
 * One parsed line, mirroring {@link ParsedLine} with every live `Value`
 * replaced by a {@link SerializedValue}.
 */
export interface SerializedParsedLine {
	lineNumber: number;
	text: string;
	startPosition: number;
	endPosition: number;
	isEmpty: boolean;
	hasInlineSolves: boolean;
	inlineSolves: SerializedInlineSolve[];
	expression: string | null;
	result: SerializedValue | null;
	error: string | null;
}

/**
 * A whole parsed document, mirroring {@link ParsingResult}.
 *
 * `diagnostics` is already the JSON form the engine emits ({@link
 * DiagnosticReportJSON}), so it crosses unchanged when a host asked for it.
 */
export interface SerializedParsingResult {
	lines: SerializedParsedLine[];
	totalLines: number;
	errors: string[];
	diagnostics?: DiagnosticReportJSON;
}
