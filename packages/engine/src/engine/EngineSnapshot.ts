/**
 * Serialise and restore the state a session accumulates in memory.
 *
 * An engine builds up three things while it evaluates a document: named
 * variables, user-defined functions, and a per-line result/bytecode cache.
 * All three live only in memory, so a host that wants to persist a session,
 * warm-start a process, or move a document between contexts has to re-evaluate
 * the whole thing from scratch. This module turns that state into a plain,
 * JSON-safe object (see {@link EngineSnapshot}) and back again, so the host can
 * store it and rehydrate an engine that behaves as though it had evaluated the
 * document itself.
 *
 * What is deliberately NOT carried:
 * - Resolved async values (weather, stocks, currency, any package that fetches).
 *   Those are point-in-time and must be re-fetched, not restored stale, so the
 *   snapshot omits every line and variable backed by an async resolver. See
 *   {@link ExpressionEngine.toJSON}, which filters them out before this module
 *   ever sees them.
 * - Package-contributed state (a package's own caches or globals). Core state
 *   only for now; a package opt-in is a follow-up. See the guide.
 *
 * JSON safety is the load-bearing contract here. `JSON.stringify` cannot encode
 * a `bigint` (it throws) and turns `NaN`/`Infinity` into `null` (a silent
 * corruption), and typed arrays round-trip as sparse objects rather than
 * arrays. Every value that crosses this boundary therefore goes through
 * {@link encodeNumber} (non-finite numbers become sentinel strings) or is
 * written as a decimal string (every `bigint`), and typed arrays are copied to
 * plain arrays. A snapshot produced here survives `JSON.stringify` followed by
 * `JSON.parse` unchanged.
 */

import { Value, ValueType, type MatrixData, type MatrixEntry } from "@solve-js/vm/Value";
import type { BytecodeProgram, UserFunctionDef, AnonymousBodyDef } from "@solve-js/parser/BytecodeBuilder";
import type { DecimalData } from "@solve-js/decimal";
import type { Rational } from "@solve-js/symbolic";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";

/**
 * The magic string every snapshot carries, so a host handing `fromJSON` an
 * arbitrary object (a config file, a different tool's export) is refused with a
 * clear error rather than half-restored. See {@link assertRestorable}.
 */
export const SNAPSHOT_FORMAT = "solve-engine/snapshot" as const;

/**
 * The snapshot layout version, bumped whenever the serialised shape changes in
 * a way an older reader cannot understand. `fromJSON` accepts only the exact
 * version it was built for and refuses anything else with a coded error, which
 * is the whole point of the field: a snapshot taken by a future (or older)
 * engine is rejected loudly instead of being restored wrongly. This is separate
 * from the engine's own semver (recorded alongside it as {@link
 * EngineSnapshot.engineVersion} for diagnostics), because the serialised shape
 * and the published API version do not have to move together.
 */
export const SNAPSHOT_VERSION = 1 as const;

// ── JSON-safe number encoding ──────────────────────────────────────────────

/**
 * A number as it appears in a snapshot: an ordinary JSON number when finite, or
 * a sentinel string when not. `JSON.stringify` writes `NaN`/`Infinity`/
 * `-Infinity` as `null`, which would silently turn a real `1/0` into an absent
 * value on the way back, so the three non-finite doubles are named instead.
 */
export type SerializedNumber = number | "NaN" | "Infinity" | "-Infinity";

/** Encode a double for the snapshot, naming the non-finite ones (see {@link SerializedNumber}). */
export function encodeNumber(n: number): SerializedNumber {
	if (Number.isFinite(n)) return n;
	if (Number.isNaN(n)) return "NaN";
	return n > 0 ? "Infinity" : "-Infinity";
}

/** Reverse {@link encodeNumber}. Throws {@link SnapshotErrorCodes.SNAPSHOT_MALFORMED} on an unrecognised sentinel. */
export function decodeNumber(n: SerializedNumber): number {
	if (typeof n === "number") return n;
	if (n === "NaN") return NaN;
	if (n === "Infinity") return Infinity;
	if (n === "-Infinity") return -Infinity;
	throw ErrorFactory.validation({
		code: SnapshotErrorCodes.SNAPSHOT_MALFORMED,
		message: `Snapshot holds an unrecognised number sentinel: ${JSON.stringify(n)}`,
		expected: `a JSON number, or one of "NaN", "Infinity", "-Infinity"`,
		found: JSON.stringify(n),
	});
}

// ── Serialised shapes ──────────────────────────────────────────────────────

/** {@link DecimalData} with its `bigint` coefficient written as a decimal string. */
export interface SerializedDecimal {
	coef: string;
	scale: number;
}

/** {@link Rational} with both `bigint` components written as decimal strings. */
export interface SerializedRational {
	n: string;
	d: string;
}

/**
 * A {@link Value} in JSON-safe form, discriminated by its {@link ValueType}
 * on the `t` field. Only the types a session can leave in a variable, a
 * function result, or a cached line are represented; {@link ValueType.Pending}
 * is filtered out upstream (an in-flight async result), and
 * {@link ValueType.Symbolic} plus symbolic matrix cells are refused with a
 * clear error (deferred, see the module doc).
 */
export type SerializedValue =
	| { t: ValueType.Number; v: SerializedNumber; exact?: SerializedDecimal; rational?: SerializedRational }
	| { t: ValueType.Hex; v: SerializedNumber | string; big?: boolean; base?: string }
	| { t: ValueType.BigInt; v: string }
	| { t: ValueType.String; v: string }
	| { t: ValueType.Datetime; v: SerializedNumber }
	| { t: ValueType.Percentage; v: SerializedNumber }
	| { t: ValueType.Uom; v: SerializedNumber; unit: string; exact?: SerializedDecimal }
	| { t: ValueType.Matrix; rows: number; cols: number; data: (SerializedNumber | boolean)[] }
	| { t: ValueType.Range; min: SerializedNumber; max: SerializedNumber }
	| { t: ValueType.Boolean; v: boolean }
	| { t: ValueType.Error; code: string; message: string };

/** A {@link BytecodeProgram} with its typed arrays copied to plain arrays and non-finite constants named. */
export interface SerializedBytecode {
	opcodes: number[];
	numbers: SerializedNumber[];
	strings: string[];
	hasAsync: boolean;
	constants?: [number, number][];
	userFunctionBodies?: SerializedUserFunction[];
	anonymousBodies?: SerializedAnonymousBody[];
}

/** A {@link UserFunctionDef}: name, parameter names, and the body compiled to its own program. */
export interface SerializedUserFunction {
	name: string;
	params: string[];
	program: SerializedBytecode;
}

/** An {@link AnonymousBodyDef}: a `map`/`reduce` inline transform body, a user function minus the name. */
export interface SerializedAnonymousBody {
	params: string[];
	program: SerializedBytecode;
}

/** One cached line: the result, the compiled program, and the reads/writes the dependency graph needs. */
export interface SerializedLineCacheEntry {
	line: number;
	/** The expression text this entry is keyed under, or "" for an expressionless entry. Mirrors `LineCache`'s own two-level key. */
	expression: string;
	result: SerializedValue;
	bytecode: SerializedBytecode;
	reads: string[];
	writeVar: string | null;
}

/**
 * A complete, JSON-safe snapshot of an engine's session state.
 *
 * Produced by {@link ExpressionEngine.toJSON} and consumed by
 * {@link ExpressionEngine.fromJSON}. Safe to `JSON.stringify`, store, and
 * `JSON.parse` back into `fromJSON`.
 */
export interface EngineSnapshot {
	/** Always {@link SNAPSHOT_FORMAT}. Identifies the object as a snapshot before anything reads deeper. */
	format: typeof SNAPSHOT_FORMAT;
	/** The serialised-shape version, {@link SNAPSHOT_VERSION} at write time. `fromJSON` refuses any other value. */
	version: number;
	/** The engine's semver at write time, for diagnostics and forward compatibility decisions. Not itself a gate. */
	engineVersion: string;
	/** The locale the snapshot was taken under, so `fromJSON` can rebuild a matching lexer when the caller does not override it. */
	locale: string;
	/** Named variables, by name. Async-backed and in-flight variables are omitted (see the module doc). */
	variables: Record<string, SerializedValue>;
	/** User-defined functions (`f(x) = ...`). */
	userFunctions: SerializedUserFunction[];
	/** Cached lines, minus any backed by an async resolver. */
	lineCache: SerializedLineCacheEntry[];
	/** The expression-keyed bytecode cache, a pure recompilation cache, carried so a warm start skips re-parsing unchanged expressions. */
	bytecodeCache: { expression: string; program: SerializedBytecode }[];
}

/**
 * The coded errors this module and `fromJSON` raise. Registered in
 * `errors/ErrorCode.ts` so the catalog test can see them.
 */
export const SnapshotErrorCodes = {
	/** The object handed to `fromJSON` is not a snapshot at all, or its version does not match this engine's reader. */
	SNAPSHOT_VERSION_MISMATCH: "SNAPSHOT_VERSION_MISMATCH",
	/** A snapshot with the right envelope but internally inconsistent contents (a bad number sentinel, a missing field). */
	SNAPSHOT_MALFORMED: "SNAPSHOT_MALFORMED",
	/** A value the snapshot format cannot yet represent (a symbolic expression, a symbolic matrix cell). Deferred, see the module doc. */
	SNAPSHOT_UNSUPPORTED_VALUE: "SNAPSHOT_UNSUPPORTED_VALUE",
} as const;

// ── Value serialisation ─────────────────────────────────────────────────────

function serializeDecimal(d: DecimalData): SerializedDecimal {
	return { coef: d.coef.toString(), scale: d.scale };
}

function deserializeDecimal(d: SerializedDecimal): DecimalData {
	return { coef: BigInt(d.coef), scale: d.scale };
}

function serializeRational(r: Rational): SerializedRational {
	return { n: r.n.toString(), d: r.d.toString() };
}

function deserializeRational(r: SerializedRational): Rational {
	return { n: BigInt(r.n), d: BigInt(r.d) };
}

/** The label a caller sees when a value cannot be serialised, so the error names what it choked on rather than a bare enum number. */
function valueTypeName(type: ValueType): string {
	return ValueType[type] ?? String(type);
}

function unsupportedValue(type: ValueType, where: string): never {
	throw ErrorFactory.validation({
		code: SnapshotErrorCodes.SNAPSHOT_UNSUPPORTED_VALUE,
		message: `A ${valueTypeName(type)} value (${where}) cannot be included in a snapshot yet.`,
		expected: "a concrete number, string, boolean, unit, range, matrix, bigint, or money value",
		found: `${valueTypeName(type)} value`,
		suggestion: "Symbolic (algebra) values are deferred to a follow-up. Evaluate the document without the symbolic line, or re-derive it after restoring.",
		context: { valueType: type, location: where },
	});
}

/**
 * Turn a runtime {@link Value} into its JSON-safe form.
 *
 * @param value - The value to serialise.
 * @param where - A short human label for the value's origin (`variable "x"`, a
 *   line number), folded into the error message when the type is unsupported so
 *   the host learns which value refused rather than only that one did.
 * @throws {@link SnapshotErrorCodes.SNAPSHOT_UNSUPPORTED_VALUE} for a symbolic
 *   value (or a symbolic matrix cell), the one class this v1 format defers.
 */
export function serializeValue(value: Value, where: string): SerializedValue {
	switch (value.type) {
		case ValueType.Number: {
			const out: Extract<SerializedValue, { t: ValueType.Number }> = { t: ValueType.Number, v: encodeNumber(value.value as number) };
			if (value.exact !== undefined) out.exact = serializeDecimal(value.exact);
			if (value.rational !== undefined) out.rational = serializeRational(value.rational);
			return out;
		}
		case ValueType.Hex: {
			const raw = value.value;
			if (typeof raw === "bigint") {
				return { t: ValueType.Hex, v: raw.toString(), big: true, base: value.unit };
			}
			return { t: ValueType.Hex, v: encodeNumber(raw as number), base: value.unit };
		}
		case ValueType.BigInt:
			return { t: ValueType.BigInt, v: (value.value as bigint).toString() };
		case ValueType.String:
			return { t: ValueType.String, v: value.value as string };
		case ValueType.Datetime:
			return { t: ValueType.Datetime, v: encodeNumber(value.value as number) };
		case ValueType.Percentage:
			return { t: ValueType.Percentage, v: encodeNumber(value.value as number) };
		case ValueType.Uom: {
			const out: Extract<SerializedValue, { t: ValueType.Uom }> = { t: ValueType.Uom, v: encodeNumber(value.value as number), unit: value.unit ?? "" };
			if (value.exact !== undefined) out.exact = serializeDecimal(value.exact);
			return out;
		}
		case ValueType.Matrix: {
			const m = value.value as MatrixData;
			if (m.hasSymbolic) unsupportedValue(ValueType.Symbolic, `${where} (symbolic matrix cell)`);
			const data = m.data.map((cell) => serializeMatrixCell(cell, where));
			return { t: ValueType.Matrix, rows: m.rows, cols: m.cols, data };
		}
		case ValueType.Range: {
			const r = value.value as { min: number; max: number };
			return { t: ValueType.Range, min: encodeNumber(r.min), max: encodeNumber(r.max) };
		}
		case ValueType.Boolean:
			return { t: ValueType.Boolean, v: value.value as boolean };
		case ValueType.Error:
			return { t: ValueType.Error, code: value.value as string, message: value.unit ?? "" };
		default:
			// Pending is filtered out before this function is called; Symbolic and
			// the lexer-only Unit type land here and are refused by name.
			return unsupportedValue(value.type, where);
	}
}

function serializeMatrixCell(cell: MatrixEntry, where: string): SerializedNumber | boolean {
	if (typeof cell === "boolean") return cell;
	if (typeof cell === "number") return encodeNumber(cell);
	// The only remaining MatrixEntry variant is a SymbolicNode object, which the
	// hasSymbolic guard above should already have caught; this is the backstop.
	return unsupportedValue(ValueType.Symbolic, `${where} (symbolic matrix cell)`);
}

/** Reverse {@link serializeValue}. Builds a fresh {@link Value}; never touches the arena, so it is safe to call outside evaluation. */
export function deserializeValue(sv: SerializedValue): Value {
	switch (sv.t) {
		case ValueType.Number: {
			const v = new Value(ValueType.Number, decodeNumber(sv.v));
			if (sv.exact !== undefined) v.exact = deserializeDecimal(sv.exact);
			if (sv.rational !== undefined) v.rational = deserializeRational(sv.rational);
			return v;
		}
		case ValueType.Hex: {
			const value = sv.big ? BigInt(sv.v as string) : decodeNumber(sv.v as SerializedNumber);
			return new Value(ValueType.Hex, value, sv.base);
		}
		case ValueType.BigInt:
			return new Value(ValueType.BigInt, BigInt(sv.v));
		case ValueType.String:
			return new Value(ValueType.String, sv.v);
		case ValueType.Datetime:
			return new Value(ValueType.Datetime, decodeNumber(sv.v));
		case ValueType.Percentage:
			return new Value(ValueType.Percentage, decodeNumber(sv.v));
		case ValueType.Uom: {
			const v = new Value(ValueType.Uom, decodeNumber(sv.v), sv.unit);
			if (sv.exact !== undefined) v.exact = deserializeDecimal(sv.exact);
			return v;
		}
		case ValueType.Matrix: {
			const data: MatrixEntry[] = sv.data.map((cell) => (typeof cell === "boolean" ? cell : decodeNumber(cell)));
			// hasSymbolic is always false: a symbolic matrix is refused at serialise
			// time, so anything restored here is purely numeric/boolean.
			const m: MatrixData = { rows: sv.rows, cols: sv.cols, data, hasSymbolic: false };
			return new Value(ValueType.Matrix, m);
		}
		case ValueType.Range:
			return new Value(ValueType.Range, { min: decodeNumber(sv.min), max: decodeNumber(sv.max) });
		case ValueType.Boolean:
			return new Value(ValueType.Boolean, sv.v);
		case ValueType.Error:
			return new Value(ValueType.Error, sv.code, sv.message);
		default:
			throw ErrorFactory.validation({
				code: SnapshotErrorCodes.SNAPSHOT_MALFORMED,
				message: `Snapshot holds a value with an unknown type tag: ${JSON.stringify((sv as { t: unknown }).t)}`,
				expected: "a known SerializedValue type tag",
				found: JSON.stringify((sv as { t: unknown }).t),
			});
	}
}

// ── Bytecode serialisation ──────────────────────────────────────────────────

/** Turn a compiled {@link BytecodeProgram} into its JSON-safe form, recursively for nested function and anonymous bodies. */
export function serializeBytecode(program: BytecodeProgram): SerializedBytecode {
	const out: SerializedBytecode = {
		opcodes: Array.from(program.opcodes),
		numbers: Array.from(program.numbers, encodeNumber),
		strings: program.strings.slice(),
		hasAsync: program.hasAsync,
	};
	if (program.constants) out.constants = Array.from(program.constants.entries());
	if (program.userFunctionBodies) out.userFunctionBodies = program.userFunctionBodies.map(serializeUserFunction);
	if (program.anonymousBodies) {
		out.anonymousBodies = program.anonymousBodies.map((b) => ({ params: b.params.slice(), program: serializeBytecode(b.program) }));
	}
	return out;
}

/** Reverse {@link serializeBytecode}, rebuilding the typed arrays and nested bodies. */
export function deserializeBytecode(sb: SerializedBytecode): BytecodeProgram {
	const program: BytecodeProgram = {
		opcodes: Uint8Array.from(sb.opcodes),
		numbers: Float64Array.from(sb.numbers, decodeNumber),
		strings: sb.strings.slice(),
		hasAsync: sb.hasAsync,
	};
	if (sb.constants) program.constants = new Map(sb.constants);
	if (sb.userFunctionBodies) program.userFunctionBodies = sb.userFunctionBodies.map(deserializeUserFunction);
	if (sb.anonymousBodies) {
		program.anonymousBodies = sb.anonymousBodies.map((b): AnonymousBodyDef => ({ params: b.params.slice(), program: deserializeBytecode(b.program) }));
	}
	return program;
}

/** Serialise one user-defined function, body and all. */
export function serializeUserFunction(fn: UserFunctionDef): SerializedUserFunction {
	return { name: fn.name, params: fn.params.slice(), program: serializeBytecode(fn.program) };
}

/** Reverse {@link serializeUserFunction}. */
export function deserializeUserFunction(fn: SerializedUserFunction): UserFunctionDef {
	return { name: fn.name, params: fn.params.slice(), program: deserializeBytecode(fn.program) };
}

// ── Envelope gating ─────────────────────────────────────────────────────────

/**
 * Confirm an arbitrary object really is a snapshot this engine can restore, and
 * throw a clear, coded error otherwise.
 *
 * This is the "refuse a snapshot from an incompatible engine rather than
 * restore it wrongly" contract the feature was asked for. A missing/mismatched
 * {@link SNAPSHOT_FORMAT} or {@link SNAPSHOT_VERSION} is a hard rejection: a
 * snapshot written by a newer or older serialised shape could deserialise into
 * a subtly wrong engine, which is worse than not restoring at all.
 *
 * @param snapshot - The candidate, typed `unknown` because it typically arrives
 *   straight from `JSON.parse` of untrusted storage.
 * @returns The same object, narrowed to {@link EngineSnapshot}, when it passes.
 * @throws {@link SnapshotErrorCodes.SNAPSHOT_VERSION_MISMATCH} when the envelope
 *   is absent or its version differs from {@link SNAPSHOT_VERSION}.
 */
export function assertRestorable(snapshot: unknown): asserts snapshot is EngineSnapshot {
	if (typeof snapshot !== "object" || snapshot === null) {
		throw ErrorFactory.validation({
			code: SnapshotErrorCodes.SNAPSHOT_VERSION_MISMATCH,
			message: "fromJSON was given something that is not a snapshot object.",
			expected: `an object produced by ExpressionEngine.toJSON() with format "${SNAPSHOT_FORMAT}"`,
			found: snapshot === null ? "null" : typeof snapshot,
		});
	}

	const candidate = snapshot as Partial<EngineSnapshot>;
	if (candidate.format !== SNAPSHOT_FORMAT) {
		throw ErrorFactory.validation({
			code: SnapshotErrorCodes.SNAPSHOT_VERSION_MISMATCH,
			message: `This object is not a solve-engine snapshot (its "format" is ${JSON.stringify(candidate.format)}).`,
			expected: `format "${SNAPSHOT_FORMAT}"`,
			found: JSON.stringify(candidate.format),
		});
	}

	if (candidate.version !== SNAPSHOT_VERSION) {
		throw ErrorFactory.validation({
			code: SnapshotErrorCodes.SNAPSHOT_VERSION_MISMATCH,
			message: `This snapshot was written for format version ${candidate.version}, but this engine restores version ${SNAPSHOT_VERSION}.`,
			expected: `snapshot version ${SNAPSHOT_VERSION}`,
			found: `version ${candidate.version}`,
			suggestion: "Regenerate the snapshot with a matching engine version, or re-evaluate the document from source.",
			context: { snapshotVersion: candidate.version, readerVersion: SNAPSHOT_VERSION, engineVersion: candidate.engineVersion },
		});
	}
}
