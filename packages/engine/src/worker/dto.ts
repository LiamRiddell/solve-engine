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

import type { ValueType, ColourFormat, DatetimeGrain, CalendarName } from "@solve-js/vm/Value";
import type { ValueSource, FrozenMark } from "@solve-js/vm/Provenance";
import type { DiagnosticReportJSON } from "@solve-js/diagnostics";
import type { SourceSpan } from "@solve-js/errors/EngineError";

/**
 * A matrix flattened for transport.
 *
 * `cells` is column-major, the same order as {@link MatrixData.data}, so a host
 * indexes it identically. Finite numeric and boolean cells pass through as
 * themselves; a symbolic cell (a free-variable algebraic entry) becomes its
 * formatted string, since a `SymbolicNode` is a class instance that would not
 * survive the clone; and a non-finite numeric cell (`Infinity`/`-Infinity`/`NaN`,
 * from e.g. a `[1/0, 2]`) becomes the same string tag the scalar
 * {@link SerializedWorkerValue.nonFinite} uses, because a raw non-finite number does
 * not survive `JSON` (it becomes `null`). A host reads a numeric string cell
 * back with `Number(cell)`.
 */
export interface SerializedMatrix {
	rows: number;
	cols: number;
	cells: Array<number | boolean | string>;
	hasSymbolic: boolean;
	/** The unit every numeric cell is in, for a list of quantities (`km` for `[1 km, 500 m]`); absent for plain numbers. */
	unit?: string;
}

/**
 * The name this DTO carried before it was renamed.
 *
 * @deprecated Use {@link SerializedWorkerValue}. The root entry exports the
 * snapshot shape under the name `SerializedValue`, so a host importing both
 * met two different types with one name. This alias keeps existing imports
 * working for at least one minor release and is removed in the next major.
 */
export type SerializedValue = SerializedWorkerValue;

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
export interface SerializedWorkerValue {
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
	/**
	 * Unit annotation for unit-of-measurement and non-decimal-base values, when
	 * present. Never set for an {@link ValueType.Error}: its message is in
	 * {@link text}, and its code in {@link errorCode}. A timecode crosses as
	 * `frames`, its count, with the rate in {@link timecodeFps}.
	 */
	unit?: string;
	/**
	 * Set only for a video timecode (`01:02:03:04 at 30 fps`): its frame rate.
	 * {@link number} is then the frame count and {@link unit} is `frames`, so a
	 * host never sees the engine's internal unit name for a timecode (#759).
	 */
	timecodeFps?: number;
	/**
	 * The name a quantity is shown under when the reader wrote a word for its
	 * unit that is not the unit's own (`Meile`, `sprints`), and how many of
	 * {@link unit} one of it is. The {@link text} is already written under it;
	 * this is for a host that renders the number itself (#762).
	 */
	unitLabel?: { name: string; per: number };
	/**
	 * The error's code (`INCOMPATIBLE_UNITS`, `UNDEFINED_FUNCTION`), present only for
	 * {@link ValueType.Error}, so a host branches on the code the way it would on
	 * a main-thread value's `errorCode`, rather than on the message text (#662).
	 */
	errorCode?: string;
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
	 * IPv4 `addr` or the 128-bit IPv6 `addr6` (as a decimal string, since JSON
	 * cannot carry a bigint) and its `zone`, and/or the `prefix`, plus `text`
	 * (the form the answer shows). See issues #189 and #748.
	 */
	ipCidr?: {
		addr?: number;
		addr6?: string;
		zone?: string;
		prefix?: number;
		text: string;
	};
	/** Whether an async fallback timed out, carried through when the engine set it. */
	timedOut?: boolean;
	/**
	 * What a {@link ValueType.Datetime} anchors, present only when the engine
	 * recorded it: `"date"` for a calendar day, `"datetime"` for a wall-clock
	 * reading, `"instant"` for a fixed point, `"time"` for a time of day. See
	 * `Value.grain`. A plain JSON string, so the DTO's `structuredClone`/`JSON`
	 * guarantee is unaffected.
	 */
	grain?: DatetimeGrain;
	/**
	 * For a time of day, an instant on the day it is counted from, in epoch
	 * milliseconds, present only when recorded. See `Value.timeAnchor`.
	 */
	timeAnchor?: number;
	/**
	 * The zone a Datetime should be read in, present only when the line named
	 * one: an IANA name (`"Asia/Tokyo"`) or a fixed offset (`"UTCOFFSET:540"`).
	 * See `Value.zone`.
	 */
	zone?: string;
	/**
	 * For a String that is a weekday or month name drawn from a date, which one
	 * it names (`{ kind: "weekday", index: 2 }` for Tuesday), present only then.
	 * `text` is already written in the settings' language; this lets a host
	 * that renders its own text name the day in its own. See `Value.calendarName`.
	 */
	calendarName?: CalendarName;
	/**
	 * Where the live figures behind this value came from, present only when it
	 * carries any: each record's provider, kind, fetch time, and when relevant
	 * its subject, its day and its freeze time. See `Value.sources`. Every field
	 * is a string or a number, so the DTO's `structuredClone`/`JSON` guarantee
	 * is unaffected.
	 */
	sources?: ValueSource[];
	/** Present only on a frozen answer: when it was frozen and the key it is stored under. See `Value.frozen`. */
	frozen?: FrozenMark;
}

/**
 * One inline solve and its serialised result, mirroring
 * {@link InlineSolvePosition} with the live `Value` replaced by a
 * {@link SerializedWorkerValue}.
 */
export interface SerializedInlineSolve {
	start: number;
	end: number;
	expression: string;
	lineNumber: number;
	columnNumber: number;
	result: SerializedWorkerValue | null;
	error: string | null;
	/** The code of the failure in `error`, as {@link InlineSolvePosition.errorCode}; null when `error` is. */
	errorCode: string | null;
	/** Where in the line the failure in `error` is, as {@link InlineSolvePosition.errorSpan}; null when the engine has no position or `error` is null. */
	errorSpan: SourceSpan | null;
}

/**
 * One parsed line, mirroring {@link ParsedLine} with every live `Value`
 * replaced by a {@link SerializedWorkerValue}.
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
	result: SerializedWorkerValue | null;
	error: string | null;
	/**
	 * The code of the failure in `error` (`NO_PREFIX_PARSELET`,
	 * `UNDEFINED_VARIABLE`), as {@link ParsedLine.errorCode}: what a host behind
	 * the worker branches on. Null when `error` is. A failure the line returned
	 * as a value keeps its code on `result.errorCode` instead.
	 */
	errorCode: string | null;
	/**
	 * Where in the line the failure in `error` is, as {@link ParsedLine.errorSpan}:
	 * offsets into the line's own text, with the one-based line and column.
	 * Null when the engine has no position for it, or `error` is null.
	 */
	errorSpan: SourceSpan | null;
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
	/** The document's check pass and fail count, as `ParsingResult.checks`. */
	checks?: { passed: number; failed: number };
}

/**
 * One step of a derivation, mirroring {@link ExplanationStep} with its value
 * serialised.
 */
export interface SerializedExplanationStep {
	/** A short account of the operation, as `ExplanationStep.description` ("80 less 20%"). */
	description: string;
	/** The value the step arrives at. */
	value: SerializedWorkerValue;
}

/**
 * A derivation of how a line reached its answer, mirroring {@link Explanation}
 * (what `ExpressionEngine.explainLine` returns) with every value serialised.
 */
export interface SerializedExplanation {
	/** The expression as given. */
	expression: string;
	/** The ordered derivation, one entry per operation, in evaluation order. */
	steps: SerializedExplanationStep[];
	/** The final value, the same answer `evaluateExpression` gives. */
	result: SerializedWorkerValue;
}

/**
 * Where a line's answer came from, mirroring {@link LineTrace} (what
 * `ExpressionEngine.traceLine` returns) with every value serialised and each
 * input traced the same way.
 */
export interface SerializedLineTrace {
	/** The line's 1-based number. */
	line: number;
	/** The variable the line defines, or null. */
	name: string | null;
	/** The line's answer, or null when it has none. */
	value: SerializedWorkerValue | null;
	/** How the line that read this one reached it (`deposit`, `line 2`, `#food`). Empty at the root. */
	via: string[];
	/** The lines this one read, each traced the same way. */
	inputs: SerializedLineTrace[];
	/** The line is already on the path above it, so it is not followed again. */
	cycle: boolean;
	/** The line is below the line that read it. */
	forward: boolean;
	/** The depth or size bound stopped the trace here. */
	truncated: boolean;
}
