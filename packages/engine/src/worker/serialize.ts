/**
 * Turn live engine results into the clone-safe DTOs the worker harness posts.
 *
 * These functions run on the worker side, just before a result crosses the
 * boundary, and are also what the main side re-runs on a synchronous result to
 * compare the two paths in tests. They are pure and deterministic given the
 * same {@link FormattingSettings}, so a value serialised on either side is
 * byte-for-byte the same DTO.
 */

import { Value, ValueType, type MatrixData, type MatrixEntry, type RangeData, type ColourData, type PlotData } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { sparklineFor } from "@solve-js/format/Sparkline";
import { toHexString, formatColour } from "@solve-js/packages/colour/ColourMath";
import type { FormattingSettings } from "@solve-js/format/FormattingSettings";
import { formatSymbolic } from "@solve-js/symbolic";
import type { ParsedLine, InlineSolvePosition, ParsingResult } from "@solve-js/types/ParsingResult";
import type {
	SerializedValue,
	SerializedMatrix,
	SerializedParsedLine,
	SerializedInlineSolve,
	SerializedParsingResult,
} from "./dto";

/**
 * The JSON-safe string tag for a non-finite reading. `Infinity`/`-Infinity`/`NaN`
 * cannot cross `JSON` (which turns each into `null`), so this one string form is
 * what survives both `structuredClone` and `JSON`, and a host recovers the value
 * with `Number(tag)`. Shared by the scalar `nonFinite` field and matrix cells.
 */
function nonFiniteTag(n: number): "Infinity" | "-Infinity" | "NaN" {
	return n > 0 ? "Infinity" : n < 0 ? "-Infinity" : "NaN";
}

/** Project a matrix onto clone-safe cells: finite primitives pass through, symbolic cells and non-finite numbers become strings. */
function serializeMatrix(m: MatrixData): SerializedMatrix {
	const cells = m.data.map((cell: MatrixEntry): number | boolean | string => {
		// A `SymbolicNode` (the object-typed cell variant) flattens to its display
		// string. A non-finite number (a `[1/0, 2]` cell) cannot cross JSON any
		// more than a scalar reading can, so it takes the same string tag rather
		// than being passed through raw and turned into `null` by `JSON.stringify`
		// (which would diverge from the `structuredClone` path). A finite number
		// or a boolean is already clone-safe and passes through.
		if (typeof cell === "object" && cell !== null) return formatSymbolic(cell);
		if (typeof cell === "number" && !Number.isFinite(cell)) return nonFiniteTag(cell);
		return cell;
	});
	return { rows: m.rows, cols: m.cols, cells, hasSymbolic: m.hasSymbolic };
}

/**
 * Project a {@link Value} onto a {@link SerializedValue}.
 *
 * `text` and `number` are set for every value; the type-specific fields are
 * added only where the payload needs them, so the DTO stays minimal and a
 * deep-equal between the two evaluation paths does not trip on a property one
 * side left `undefined`.
 */
export function serializeValue(value: Value, settings?: FormattingSettings): SerializedValue {
	const reading = value.toNumber();
	const dto: SerializedValue = {
		type: value.type,
		text: formatValue(value, settings),
		// A non-finite reading (1/0, 0/0, an overflow) cannot cross JSON, which
		// turns it into null and breaks the round-trip the DTO guarantees. Keep
		// `number` finite and name the real value in `nonFinite` instead.
		number: Number.isFinite(reading) ? reading : 0,
	};
	if (!Number.isFinite(reading)) {
		dto.nonFinite = nonFiniteTag(reading);
	}

	if (value.unit !== undefined) dto.unit = value.unit;
	if (value.timedOut !== undefined) dto.timedOut = value.timedOut;

	const raw = value.value;
	if (typeof raw === "bigint") {
		// Covers BigInt values and a Hex value that carries a bigint magnitude:
		// a base-ten string is the one representation that neither loses
		// precision nor breaks JSON.
		dto.bigint = raw.toString();
	} else if (value.type === ValueType.Matrix) {
		dto.matrix = serializeMatrix(raw as MatrixData);
		const spark = sparklineFor(value);
		if (spark) dto.sparkline = { series: spark.series, min: spark.min, max: spark.max };
	} else if (value.type === ValueType.Range) {
		const r = raw as RangeData;
		dto.range = { min: r.min, max: r.max };
		const spark = sparklineFor(value);
		if (spark) dto.sparkline = { series: spark.series, min: spark.min, max: spark.max };
	} else if (value.type === ValueType.Colour) {
		const c = raw as ColourData;
		dto.colour = { hex: toHexString(c), r: c.r, g: c.g, b: c.b, a: c.a, format: c.format, css: formatColour(c) };
	} else if (value.type === ValueType.Plot) {
		const p = raw as PlotData;
		dto.plot = { points: p.points.map((pt) => [pt[0], pt[1]]), expr: p.expr, from: p.from, to: p.to };
	}

	return dto;
}

/** Serialise a nullable value, the shape both `result` fields carry. */
function serializeMaybe(value: Value | null | undefined, settings?: FormattingSettings): SerializedValue | null {
	return value ? serializeValue(value, settings) : null;
}

/** Project an inline solve onto its DTO, serialising its result. */
function serializeInlineSolve(solve: InlineSolvePosition, settings?: FormattingSettings): SerializedInlineSolve {
	return {
		start: solve.start,
		end: solve.end,
		expression: solve.expression,
		lineNumber: solve.lineNumber,
		columnNumber: solve.columnNumber,
		result: serializeMaybe(solve.result, settings),
		error: solve.error ?? null,
	};
}

/** Project a parsed line onto its DTO, serialising its result and every inline solve. */
export function serializeParsedLine(line: ParsedLine, settings?: FormattingSettings): SerializedParsedLine {
	return {
		lineNumber: line.lineNumber,
		text: line.text,
		startPosition: line.startPosition,
		endPosition: line.endPosition,
		isEmpty: line.isEmpty,
		hasInlineSolves: line.hasInlineSolves,
		inlineSolves: line.inlineSolves.map((solve) => serializeInlineSolve(solve, settings)),
		expression: line.expression,
		result: serializeMaybe(line.result, settings),
		error: line.error,
	};
}

/** Project a whole parsing result onto its DTO. */
export function serializeParsingResult(result: ParsingResult, settings?: FormattingSettings): SerializedParsingResult {
	const dto: SerializedParsingResult = {
		lines: result.lines.map((line) => serializeParsedLine(line, settings)),
		totalLines: result.totalLines,
		errors: [...result.errors],
	};
	// The diagnostics report is already the engine's own JSON form, so it
	// crosses unchanged; present only when the host asked for it.
	if (result.diagnostics !== undefined) dto.diagnostics = result.diagnostics;
	return dto;
}
