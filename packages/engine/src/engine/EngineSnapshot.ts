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
 *   ever sees them. The one exception is the opt-in one: a line the reader
 *   froze (`10 USD in GBP frozen`) is carried with its answer, its date and its
 *   sources, in {@link EngineSnapshot.frozen}, because keeping that answer is
 *   what the line asked for.
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

import { Value, ValueType, type MatrixData, type MatrixEntry, type DatetimeGrain } from "@solve-js/vm/Value";
import type { BytecodeProgram, UserFunctionDef, AnonymousBodyDef } from "@solve-js/parser/BytecodeBuilder";
import type { DecimalData } from "@solve-js/decimal";
import type { Rational } from "@solve-js/symbolic";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { ValueSource, SourceKind } from "@solve-js/vm/Provenance";
import type { FrozenDirective, FrozenRecord } from "@solve-js/vm/FrozenValues";
import { OpCode } from "@solve-js/parser/OpCode";
import { OPERAND_BYTES } from "@solve-js/parser/OperandWidth";

/**
 * The magic string every snapshot carries, so a host handing `fromJSON` an
 * arbitrary object (a config file, a different tool's export) is refused with a
 * clear error rather than half-restored. See {@link assertRestorable}.
 */
export const SNAPSHOT_FORMAT = "solve-engine/snapshot" as const;

/**
 * The snapshot layout version, bumped whenever the serialised shape changes in
 * a way an older reader cannot understand. `fromJSON` accepts the versions it
 * knows (see RESTORABLE_VERSIONS) and refuses anything else with a coded error,
 * which is the whole point of the field: a snapshot taken by a future engine is
 * rejected loudly instead of being restored wrongly. This is separate
 * from the engine's own semver (recorded alongside it as {@link
 * EngineSnapshot.engineVersion} for diagnostics), because the serialised shape
 * and the published API version do not have to move together.
 */
export const SNAPSHOT_VERSION = 2 as const;

/**
 * The versions `fromJSON` restores. Version 2 names the plugin function behind
 * every call a compiled program makes (see {@link SerializedPluginCall}, #658).
 * Version 1 did not, so its index bytes meant whatever the writing process had
 * registered at them; a version 1 program that calls a plugin function is left
 * out on restore and recompiles when its line is next evaluated, and the rest of
 * a version 1 snapshot restores as it always did.
 */
const RESTORABLE_VERSIONS: ReadonlySet<number> = new Set([1, SNAPSHOT_VERSION]);

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
 * The sidecars any serialised value may carry alongside its type-specific
 * fields: its provenance (`src`, see `vm/Provenance.ts`) and, for a frozen
 * answer, its frozen mark (`fz`). Both are optional and absent on a snapshot
 * written before they existed, which is why they need no
 * {@link SNAPSHOT_VERSION} bump: an older snapshot restores exactly as it did.
 */
export interface SerializedValueSidecars {
	src?: ValueSource[];
	fz?: { at: number; key: string };
}

/**
 * A {@link Value} in JSON-safe form, discriminated by its {@link ValueType}
 * on the `t` field. Only the types a session can leave in a variable, a
 * function result, or a cached line are represented; {@link ValueType.Pending}
 * is filtered out upstream (an in-flight async result). A symbolic value, a
 * symbolic matrix cell, a colour, a split, a chart and an IP subnet have no form
 * here: {@link serializeValue} refuses them with
 * {@link SnapshotErrorCodes.SNAPSHOT_UNSUPPORTED_VALUE}, and
 * `ExpressionEngine.toJSON` catches that refusal and leaves the variable or
 * cached line out of the snapshot (#665).
 */
export type SerializedValue = SerializedValueSidecars & (
	| { t: ValueType.Number; v: SerializedNumber; exact?: SerializedDecimal; rational?: SerializedRational }
	| { t: ValueType.Hex; v: SerializedNumber | string; big?: boolean; base?: string }
	| { t: ValueType.BigInt; v: string }
	| { t: ValueType.String; v: string }
	| { t: ValueType.Datetime; v: SerializedNumber; g?: DatetimeGrain; z?: string }
	| { t: ValueType.Percentage; v: SerializedNumber }
	| { t: ValueType.Uom; v: SerializedNumber; unit: string; exact?: SerializedDecimal }
	| { t: ValueType.Matrix; rows: number; cols: number; data: (SerializedNumber | boolean)[] }
	| { t: ValueType.Range; min: SerializedNumber; max: SerializedNumber }
	| { t: ValueType.Boolean; v: boolean }
	| { t: ValueType.Error; code: string; message: string }
);

/** A {@link BytecodeProgram} with its typed arrays copied to plain arrays and non-finite constants named. */
export interface SerializedBytecode {
	opcodes: number[];
	numbers: SerializedNumber[];
	strings: string[];
	hasAsync: boolean;
	constants?: [number, number][];
	userFunctionBodies?: SerializedUserFunction[];
	anonymousBodies?: SerializedAnonymousBody[];
	/** A frozen line's directive (see `vm/FrozenValues.ts`), carried so a restored line still answers from the store. */
	frozen?: FrozenDirective;
	/**
	 * The plugin function behind each plugin call in {@link opcodes}, in the order
	 * the calls appear. Written from version 2, and present only when the program
	 * makes a call. A restore relinks each call by these names (#658).
	 */
	pluginCalls?: SerializedPluginCall[];
}

/**
 * A plugin function a compiled program calls, named by the package that
 * registered it and its name in that package (#658).
 *
 * A plugin function's index is allocated process-wide, in the order packages
 * first register, so the index baked into a program means nothing in another
 * process, or after the same packages are passed in another order: a restored
 * `zbeta(21)` ran `zalpha` and answered 1,021. The snapshot names each call
 * instead, and a restore relinks it against the restoring engine's own index,
 * or refuses the snapshot when no registered package provides it.
 */
export interface SerializedPluginCall {
	/** The package that registered the function, as `IEnginePackage.name`. */
	pkg: string;
	/** The function's name in that package's `pluginFunctions`. */
	name: string;
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
 * One frozen answer, as a snapshot carries it: the key it is stored under, when
 * it was frozen, the day that was, and the answer itself with its sources.
 */
export interface SerializedFrozenRecord {
	key: string;
	at: number;
	day: string;
	value: SerializedValue;
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
	/**
	 * The answers this engine's `frozen` lines keep, so a restored document
	 * reads the same answers with no network. Absent on a snapshot written
	 * before frozen lines existed, which restores with none.
	 */
	frozen?: SerializedFrozenRecord[];
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
	/** A value the snapshot format cannot yet represent (a symbolic expression or matrix cell, a colour, a split, a chart, an IP subnet). `toJSON` catches it and leaves the value out. */
	SNAPSHOT_UNSUPPORTED_VALUE: "SNAPSHOT_UNSUPPORTED_VALUE",
	/** The snapshot calls a plugin function that no package registered on the restoring engine provides. Refused rather than restored, since the call would run whatever sits at its old index (#658). */
	SNAPSHOT_PACKAGE_MISSING: "SNAPSHOT_PACKAGE_MISSING",
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
 * @throws {@link SnapshotErrorCodes.SNAPSHOT_UNSUPPORTED_VALUE} for a value
 *   this v1 format defers: a symbolic value or matrix cell, a colour, a split, a
 *   chart or an IP subnet. `ExpressionEngine.toJSON` catches it and leaves the
 *   value out of the snapshot.
 */
export function serializeValue(value: Value, where: string): SerializedValue {
	const out = serializeValueBody(value, where);
	// Plain copies, so the snapshot shares nothing with the live value.
	if (value.sources !== undefined) out.src = value.sources.map((s) => ({ ...s }));
	if (value.frozen !== undefined) out.fz = { at: value.frozen.at, key: value.frozen.key };
	return out;
}

/** The type-specific half of {@link serializeValue}. */
function serializeValueBody(value: Value, where: string): SerializedValue {
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
		case ValueType.Datetime: {
			// The two sidecars ride along as optional fields, which is why this
			// needs no `SNAPSHOT_VERSION` bump: a snapshot written before they
			// existed simply carries neither, and restores to a Datetime with
			// nothing recorded, exactly as it did. Left out, a restored session
			// would silently forget that a stored date was a day in Tokyo.
			const out: Extract<SerializedValue, { t: ValueType.Datetime }> = { t: ValueType.Datetime, v: encodeNumber(value.value as number) };
			if (value.grain !== undefined) out.g = value.grain;
			if (value.zone !== undefined) out.z = value.zone;
			return out;
		}
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
	const value = deserializeValueBody(sv);
	if (sv.src !== undefined) value.sources = sv.src.map((s) => ({ ...s }));
	if (sv.fz !== undefined) value.frozen = { at: sv.fz.at, key: sv.fz.key };
	return value;
}

/** The type-specific half of {@link deserializeValue}. */
function deserializeValueBody(sv: SerializedValue): Value {
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
		case ValueType.Datetime: {
			const v = new Value(ValueType.Datetime, decodeNumber(sv.v));
			if (sv.g !== undefined) v.grain = sv.g;
			if (sv.z !== undefined) v.zone = sv.z;
			return v;
		}
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

// ── Frozen answers ──────────────────────────────────────────────────────────

/** Turn one frozen answer into its JSON-safe form. */
export function serializeFrozenRecord(record: FrozenRecord): SerializedFrozenRecord {
	return { key: record.key, at: record.at, day: record.day, value: serializeValue(record.value, `frozen "${record.key}"`) };
}

/** Reverse {@link serializeFrozenRecord}. */
export function deserializeFrozenRecord(sr: SerializedFrozenRecord): FrozenRecord {
	return { key: sr.key, at: sr.at, day: sr.day, value: deserializeValue(sr.value) };
}

// ── Bytecode serialisation ──────────────────────────────────────────────────

/** Where each plugin call's opcode sits in `opcodes`, in order, found by walking the instructions rather than trusting a recorded list. */
function pluginCallSites(opcodes: ArrayLike<number>): number[] {
	const sites: number[] = [];
	for (let i = 0; i < opcodes.length; i += 1 + (OPERAND_BYTES[opcodes[i]] ?? 0)) {
		const op = opcodes[i];
		if (op === OpCode.CALL_PLUGIN || op === OpCode.CALL_PLUGIN_WIDE) sites.push(i);
	}
	return sites;
}

/** The plugin-function index the call whose opcode is at `site` carries. */
function pluginIndexAt(opcodes: ArrayLike<number>, site: number): number {
	return opcodes[site] === OpCode.CALL_PLUGIN_WIDE ? (opcodes[site + 1] | (opcodes[site + 2] << 8)) : opcodes[site + 1];
}

/** Names the plugin function at an index of the writing engine, or undefined when no registered package holds that index. */
export type PluginCallNamer = (index: number) => SerializedPluginCall | undefined;

/**
 * Whether every plugin call in `program`, and in the bodies nested in it, names
 * a function the writing engine has registered. A program that fails this could
 * not be relinked anywhere, so `toJSON` leaves it out.
 *
 * @param program - The compiled program.
 * @param namer - The writing engine's index-to-name lookup.
 */
export function namesEveryPluginCall(program: BytecodeProgram, namer: PluginCallNamer): boolean {
	for (const site of pluginCallSites(program.opcodes)) {
		if (namer(pluginIndexAt(program.opcodes, site)) === undefined) return false;
	}
	for (const fn of program.userFunctionBodies ?? []) if (!namesEveryPluginCall(fn.program, namer)) return false;
	for (const body of program.anonymousBodies ?? []) if (!namesEveryPluginCall(body.program, namer)) return false;
	return true;
}

/**
 * Turn a compiled {@link BytecodeProgram} into its JSON-safe form, recursively for nested function and anonymous bodies.
 *
 * @param program - The compiled program.
 * @param namer - Names each plugin call for {@link SerializedBytecode.pluginCalls}. Without it no call is named, and a
 *   restore will not trust the program's plugin calls.
 */
export function serializeBytecode(program: BytecodeProgram, namer?: PluginCallNamer): SerializedBytecode {
	const out: SerializedBytecode = {
		opcodes: Array.from(program.opcodes),
		numbers: Array.from(program.numbers, encodeNumber),
		strings: program.strings.slice(),
		hasAsync: program.hasAsync,
	};
	if (program.constants) out.constants = Array.from(program.constants.entries());
	if (program.userFunctionBodies) out.userFunctionBodies = program.userFunctionBodies.map((fn) => serializeUserFunction(fn, namer));
	if (program.anonymousBodies) {
		out.anonymousBodies = program.anonymousBodies.map((b) => ({ params: b.params.slice(), program: serializeBytecode(b.program, namer) }));
	}
	if (program.frozen) out.frozen = { ...program.frozen };
	if (namer) {
		const sites = pluginCallSites(program.opcodes);
		// An unnamed call is written as an empty name, which a restore refuses;
		// `toJSON` checks namesEveryPluginCall first, so it does not write one.
		if (sites.length > 0) out.pluginCalls = sites.map((site) => namer(pluginIndexAt(program.opcodes, site)) ?? { pkg: "", name: "" });
	}
	return out;
}

/** Resolves a named plugin call to the index the restoring engine holds it at, or undefined when no registered package provides it. */
export type PluginCallLinker = (call: SerializedPluginCall) => number | undefined;

/**
 * Refuse the snapshot when a program in it calls a plugin function the restoring
 * engine does not have, before anything is restored (#658).
 *
 * Also checks that a program names exactly as many calls as its opcodes make: a
 * hand-edited snapshot that added a call, or dropped a name, is malformed rather
 * than relinked out of step.
 *
 * @param sb - A program from a version 2 snapshot.
 * @param link - The restoring engine's name-to-index lookup.
 * @param where - The program's path in the snapshot, for the error.
 * @throws {@link SnapshotErrorCodes.SNAPSHOT_PACKAGE_MISSING} or {@link SnapshotErrorCodes.SNAPSHOT_MALFORMED}.
 */
export function assertPluginCallsLinkable(sb: SerializedBytecode, link: PluginCallLinker, where: string): void {
	const sites = pluginCallSites(sb.opcodes);
	const calls = sb.pluginCalls ?? [];
	if (calls.length !== sites.length) {
		malformed(`${where}.pluginCalls`, `one named call for each of the program's ${sites.length} plugin calls`, sb.pluginCalls);
	}
	for (const call of calls) {
		if (link(call) === undefined) {
			throw ErrorFactory.validation({
				code: SnapshotErrorCodes.SNAPSHOT_PACKAGE_MISSING,
				message: `This snapshot calls the plugin function "${call.name}" from the package "${call.pkg}", which is not registered on this engine.`,
				expected: `the package "${call.pkg}" among the packages passed to fromJSON`,
				found: "no package providing it",
				suggestion: "Restore with the same packages the snapshot was taken with, or re-evaluate the document from source.",
				context: { location: where, package: call.pkg, function: call.name },
			});
		}
	}
	(sb.userFunctionBodies ?? []).forEach((fn, i) => assertPluginCallsLinkable(fn.program, link, `${where}.userFunctionBodies[${i}].program`));
	(sb.anonymousBodies ?? []).forEach((body, i) => assertPluginCallsLinkable(body.program, link, `${where}.anonymousBodies[${i}].program`));
}

/**
 * Rebuild a program for the restoring engine, relinking each plugin call by
 * name, or null when it cannot be relinked and should be recompiled from its
 * line instead (#658).
 *
 * `link` is null for a version 1 snapshot, whose programs name no calls: a v1
 * program that calls a plugin function is not trusted and comes back null. For
 * a version 2 program each call is relinked in order (run
 * {@link assertPluginCallsLinkable} first, which refuses a missing package). A
 * call compiled with a one-byte index that this engine holds past 255 comes back
 * null too, since the call cannot be widened in place.
 *
 * @param sb - The serialised program.
 * @param link - The restoring engine's name-to-index lookup, or null for a version 1 snapshot.
 */
export function restoreBytecode(sb: SerializedBytecode, link: PluginCallLinker | null): BytecodeProgram | null {
	const opcodes = Uint8Array.from(sb.opcodes);
	const sites = pluginCallSites(opcodes);
	if (sites.length > 0) {
		if (link === null || sb.pluginCalls === undefined) return null;
		for (let i = 0; i < sites.length; i++) {
			const index = link(sb.pluginCalls[i]);
			const site = sites[i];
			if (index === undefined) return null;
			if (opcodes[site] === OpCode.CALL_PLUGIN_WIDE) {
				opcodes[site + 1] = index & 0xff;
				opcodes[site + 2] = (index >> 8) & 0xff;
			} else if (index <= 0xff) {
				opcodes[site + 1] = index;
			} else {
				return null;
			}
		}
	}
	const program: BytecodeProgram = {
		opcodes,
		numbers: Float64Array.from(sb.numbers, decodeNumber),
		strings: sb.strings.slice(),
		hasAsync: sb.hasAsync,
	};
	// The names a fresh compile records, so a restored program keys its seeded
	// draws the way the same line compiled here would (see SeededRandom.ts).
	if (sites.length > 0) program.pluginCalls = { at: sites.map((site) => site + 1), names: sb.pluginCalls!.map((call) => call.name) };
	if (sb.constants) program.constants = new Map(sb.constants);
	if (sb.userFunctionBodies) {
		const bodies: UserFunctionDef[] = [];
		for (const fn of sb.userFunctionBodies) {
			const body = restoreBytecode(fn.program, link);
			if (body === null) return null;
			bodies.push({ name: fn.name, params: fn.params.slice(), program: body });
		}
		program.userFunctionBodies = bodies;
	}
	if (sb.anonymousBodies) {
		const bodies: AnonymousBodyDef[] = [];
		for (const b of sb.anonymousBodies) {
			const body = restoreBytecode(b.program, link);
			if (body === null) return null;
			bodies.push({ params: b.params.slice(), program: body });
		}
		program.anonymousBodies = bodies;
	}
	if (sb.frozen) program.frozen = { ...sb.frozen };
	return program;
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
	if (sb.frozen) program.frozen = { ...sb.frozen };
	return program;
}

/** Serialise one user-defined function, body and all, naming its plugin calls with `namer` when one is given (see {@link serializeBytecode}). */
export function serializeUserFunction(fn: UserFunctionDef, namer?: PluginCallNamer): SerializedUserFunction {
	return { name: fn.name, params: fn.params.slice(), program: serializeBytecode(fn.program, namer) };
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
 *   is absent or its version differs from {@link SNAPSHOT_VERSION}, and
 *   {@link SnapshotErrorCodes.SNAPSHOT_MALFORMED} when the envelope is right
 *   but a field inside it is not the shape the format promises: an opcode
 *   outside a byte, a constant pool holding the wrong type, a matrix whose
 *   data does not match its dimensions, or bodies nested past the cap. The
 *   error names the path to the field.
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

	if (typeof candidate.version !== "number" || !RESTORABLE_VERSIONS.has(candidate.version)) {
		throw ErrorFactory.validation({
			code: SnapshotErrorCodes.SNAPSHOT_VERSION_MISMATCH,
			message: `This snapshot was written for format version ${candidate.version}, but this engine restores versions 1 and ${SNAPSHOT_VERSION}.`,
			expected: `snapshot version 1 or ${SNAPSHOT_VERSION}`,
			found: `version ${candidate.version}`,
			suggestion: "Regenerate the snapshot with a matching engine version, or re-evaluate the document from source.",
			context: { snapshotVersion: candidate.version, readerVersion: SNAPSHOT_VERSION, engineVersion: candidate.engineVersion },
		});
	}

	assertSnapshotBody(snapshot as Record<string, unknown>);
}

// ── Body validation ─────────────────────────────────────────────────────────
//
// The envelope check above says "this is a snapshot of the right version". It
// says nothing about what is inside, and until this section existed nothing
// did: the opcodes, constant pools and nested bodies went straight into an
// executable program on trust. A snapshot typically arrives from storage the
// host does not fully control, so its contents are caller input in exactly
// the way an expression string is, and are checked the same way: refused by
// name, with the path to the offending field, before any of it runs.

/**
 * How deeply function and transform bodies may nest inside one another. The
 * compiler produces a handful of levels at most (a map body inside a user
 * function inside a map body); a crafted snapshot could nest without limit and
 * overflow the native stack in {@link deserializeBytecode} before any VM limit
 * is consulted. Thirty-two is far past anything real.
 */
const MAX_BODY_DEPTH = 32;

function describeFound(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return `an array of ${value.length}`;
	if (typeof value === "object") return "an object";
	return `${typeof value} ${JSON.stringify(value)}`.slice(0, 80);
}

function malformed(where: string, expected: string, found: unknown): never {
	throw ErrorFactory.validation({
		code: SnapshotErrorCodes.SNAPSHOT_MALFORMED,
		message: `Snapshot is malformed at ${where}: expected ${expected}.`,
		expected,
		found: describeFound(found),
		suggestion: "Regenerate the snapshot with ExpressionEngine.toJSON(), or re-evaluate the document from source.",
		context: { location: where },
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSerializedNumber(value: unknown): boolean {
	return typeof value === "number" || value === "NaN" || value === "Infinity" || value === "-Infinity";
}

function isIntegerString(value: unknown): boolean {
	return typeof value === "string" && /^-?\d+$/.test(value);
}

function assertStringArray(value: unknown, where: string): void {
	if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) malformed(where, "an array of strings", value);
}

function assertDecimalShape(value: unknown, where: string): void {
	if (!isRecord(value) || !isIntegerString(value.coef) || typeof value.scale !== "number") {
		malformed(where, "a decimal as { coef: digits, scale: number }", value);
	}
}

function assertRationalShape(value: unknown, where: string): void {
	if (!isRecord(value) || !isIntegerString(value.n) || !isIntegerString(value.d)) {
		malformed(where, "a rational as { n: digits, d: digits }", value);
	}
}

const SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>(["live", "primed", "historical"]);

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isIsoDay(value: unknown): boolean {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Check a value's optional provenance and frozen mark, the sidecars every type may carry. */
function assertSidecarShape(sv: Record<string, unknown>, where: string): void {
	if (sv.src !== undefined) {
		if (!Array.isArray(sv.src)) malformed(`${where}.src`, "an array of sources", sv.src);
		sv.src.forEach((s, i) => {
			const at = `${where}.src[${i}]`;
			if (!isRecord(s) || typeof s.provider !== "string" || !SOURCE_KINDS.has(s.kind as SourceKind) || !Number.isFinite(s.fetchedAt)) {
				malformed(at, 'a source with a provider, a kind of "live", "primed" or "historical", and a fetchedAt time', s);
			}
			if (!isOptionalString(s.subject) || !isOptionalString(s.asOf) || (s.frozenAt !== undefined && !Number.isFinite(s.frozenAt))) {
				malformed(at, "a source whose subject and asOf are strings and whose frozenAt is a time", s);
			}
		});
	}
	if (sv.fz !== undefined) {
		if (!isRecord(sv.fz) || !Number.isFinite(sv.fz.at) || typeof sv.fz.key !== "string") {
			malformed(`${where}.fz`, "a frozen mark as { at: time, key: string }", sv.fz);
		}
	}
}

/**
 * Check one serialised value against its type tag, so {@link deserializeValue}
 * never meets a field of the wrong kind: `BigInt("abc")` throws a raw
 * SyntaxError, and a matrix whose `data` is shorter than `rows × cols` would
 * be read past its end.
 */
function assertValueShape(sv: unknown, where: string): void {
	if (!isRecord(sv)) malformed(where, "a serialised value object", sv);
	assertSidecarShape(sv, where);
	switch (sv.t) {
		case ValueType.Number:
			if (!isSerializedNumber(sv.v)) malformed(`${where}.v`, "a number", sv.v);
			if (sv.exact !== undefined) assertDecimalShape(sv.exact, `${where}.exact`);
			if (sv.rational !== undefined) assertRationalShape(sv.rational, `${where}.rational`);
			return;
		case ValueType.Hex:
			if (sv.big ? !isIntegerString(sv.v) : !isSerializedNumber(sv.v)) {
				malformed(`${where}.v`, sv.big ? "an integer string" : "a number", sv.v);
			}
			if (sv.base !== undefined && typeof sv.base !== "string") malformed(`${where}.base`, "a base name", sv.base);
			return;
		case ValueType.BigInt:
			if (!isIntegerString(sv.v)) malformed(`${where}.v`, "an integer string", sv.v);
			return;
		case ValueType.String:
			if (typeof sv.v !== "string") malformed(`${where}.v`, "a string", sv.v);
			return;
		case ValueType.Datetime:
			if (!isSerializedNumber(sv.v)) malformed(`${where}.v`, "a number", sv.v);
			// Both sidecars are optional, so a snapshot written before they
			// existed passes here unchanged; present, they must still be the
			// strings a restore will assign to a `Value`.
			if (sv.g !== undefined && sv.g !== "date" && sv.g !== "datetime" && sv.g !== "instant") {
				malformed(`${where}.g`, 'one of "date", "datetime" or "instant"', sv.g);
			}
			if (sv.z !== undefined && typeof sv.z !== "string") malformed(`${where}.z`, "a zone reference", sv.z);
			return;
		case ValueType.Percentage:
			if (!isSerializedNumber(sv.v)) malformed(`${where}.v`, "a number", sv.v);
			return;
		case ValueType.Uom:
			if (!isSerializedNumber(sv.v)) malformed(`${where}.v`, "a number", sv.v);
			if (typeof sv.unit !== "string") malformed(`${where}.unit`, "a unit name", sv.unit);
			if (sv.exact !== undefined) assertDecimalShape(sv.exact, `${where}.exact`);
			return;
		case ValueType.Matrix: {
			const { rows, cols, data } = sv;
			if (!Number.isInteger(rows) || (rows as number) < 0) malformed(`${where}.rows`, "a non-negative integer", rows);
			if (!Number.isInteger(cols) || (cols as number) < 0) malformed(`${where}.cols`, "a non-negative integer", cols);
			if (!Array.isArray(data) || data.length !== (rows as number) * (cols as number)) {
				malformed(`${where}.data`, `an array of ${rows} × ${cols} cells`, data);
			}
			if (!data.every((cell) => typeof cell === "boolean" || isSerializedNumber(cell))) {
				malformed(`${where}.data`, "numeric or boolean cells", data);
			}
			return;
		}
		case ValueType.Range:
			if (!isSerializedNumber(sv.min) || !isSerializedNumber(sv.max)) malformed(where, "a range with numeric min and max", sv);
			return;
		case ValueType.Boolean:
			if (typeof sv.v !== "boolean") malformed(`${where}.v`, "a boolean", sv.v);
			return;
		case ValueType.Error:
			if (typeof sv.code !== "string" || typeof sv.message !== "string") malformed(where, "an error with a string code and message", sv);
			return;
		default:
			// deserializeValue() names an unknown tag itself; this vouches only
			// for the shapes it does understand.
			return;
	}
}

/** Check a serialised program, recursively through its nested bodies, with the nesting capped at {@link MAX_BODY_DEPTH}. */
function assertBytecodeShape(sb: unknown, where: string, depth: number): void {
	if (depth > MAX_BODY_DEPTH) malformed(where, `function bodies nested at most ${MAX_BODY_DEPTH} deep`, "deeper nesting");
	if (!isRecord(sb)) malformed(where, "a serialised program object", sb);
	if (!Array.isArray(sb.opcodes) || !sb.opcodes.every((op) => Number.isInteger(op) && op >= 0 && op <= 255)) {
		malformed(`${where}.opcodes`, "an array of bytes (integers 0 to 255)", sb.opcodes);
	}
	if (!Array.isArray(sb.numbers) || !sb.numbers.every(isSerializedNumber)) malformed(`${where}.numbers`, "an array of numbers", sb.numbers);
	assertStringArray(sb.strings, `${where}.strings`);
	if (typeof sb.hasAsync !== "boolean") malformed(`${where}.hasAsync`, "a boolean", sb.hasAsync);
	if (sb.constants !== undefined) {
		const isPair = (pair: unknown) => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "number" && typeof pair[1] === "number";
		if (!Array.isArray(sb.constants) || !sb.constants.every(isPair)) malformed(`${where}.constants`, "an array of [number, number] pairs", sb.constants);
	}
	if (sb.userFunctionBodies !== undefined) {
		if (!Array.isArray(sb.userFunctionBodies)) malformed(`${where}.userFunctionBodies`, "an array of functions", sb.userFunctionBodies);
		sb.userFunctionBodies.forEach((fn, i) => assertUserFunctionShape(fn, `${where}.userFunctionBodies[${i}]`, depth + 1));
	}
	if (sb.pluginCalls !== undefined) {
		const isCall = (call: unknown) => isRecord(call) && typeof call.pkg === "string" && typeof call.name === "string";
		if (!Array.isArray(sb.pluginCalls) || !sb.pluginCalls.every(isCall)) malformed(`${where}.pluginCalls`, "an array of { pkg, name } calls", sb.pluginCalls);
	}
	if (sb.frozen !== undefined) {
		const f = sb.frozen;
		if (!isRecord(f) || typeof f.key !== "string" || (f.on !== undefined && !isIsoDay(f.on)) || !isOptionalString(f.write)) {
			malformed(`${where}.frozen`, "a frozen directive as { key, on?: YYYY-MM-DD, write? }", f);
		}
	}
	if (sb.anonymousBodies !== undefined) {
		if (!Array.isArray(sb.anonymousBodies)) malformed(`${where}.anonymousBodies`, "an array of bodies", sb.anonymousBodies);
		sb.anonymousBodies.forEach((body, i) => {
			const at = `${where}.anonymousBodies[${i}]`;
			if (!isRecord(body)) malformed(at, "a body object", body);
			assertStringArray(body.params, `${at}.params`);
			assertBytecodeShape(body.program, `${at}.program`, depth + 1);
		});
	}
}

function assertUserFunctionShape(fn: unknown, where: string, depth: number): void {
	if (!isRecord(fn)) malformed(where, "a function object", fn);
	if (typeof fn.name !== "string") malformed(`${where}.name`, "a function name", fn.name);
	assertStringArray(fn.params, `${where}.params`);
	assertBytecodeShape(fn.program, `${where}.program`, depth);
}

/** Check everything inside the envelope, so a corrupted or crafted snapshot is refused by name before any of it is executed. */
function assertSnapshotBody(candidate: Record<string, unknown>): void {
	if (candidate.locale !== undefined && typeof candidate.locale !== "string") malformed("locale", "a locale code", candidate.locale);
	if (!isRecord(candidate.variables)) malformed("variables", "an object of values by name", candidate.variables);
	for (const [name, sv] of Object.entries(candidate.variables)) assertValueShape(sv, `variables.${name}`);

	if (!Array.isArray(candidate.userFunctions)) malformed("userFunctions", "an array of functions", candidate.userFunctions);
	candidate.userFunctions.forEach((fn, i) => assertUserFunctionShape(fn, `userFunctions[${i}]`, 1));

	if (!Array.isArray(candidate.lineCache)) malformed("lineCache", "an array of cached lines", candidate.lineCache);
	candidate.lineCache.forEach((entry, i) => {
		const at = `lineCache[${i}]`;
		if (!isRecord(entry)) malformed(at, "a cached line", entry);
		if (!Number.isInteger(entry.line)) malformed(`${at}.line`, "a line number", entry.line);
		if (typeof entry.expression !== "string") malformed(`${at}.expression`, "the line's expression text", entry.expression);
		assertValueShape(entry.result, `${at}.result`);
		assertBytecodeShape(entry.bytecode, `${at}.bytecode`, 1);
		assertStringArray(entry.reads, `${at}.reads`);
		if (entry.writeVar !== null && typeof entry.writeVar !== "string") malformed(`${at}.writeVar`, "a variable name or null", entry.writeVar);
	});

	if (!Array.isArray(candidate.bytecodeCache)) malformed("bytecodeCache", "an array of compiled expressions", candidate.bytecodeCache);
	candidate.bytecodeCache.forEach((cached, i) => {
		const at = `bytecodeCache[${i}]`;
		if (!isRecord(cached) || typeof cached.expression !== "string") malformed(at, "an { expression, program } pair", cached);
		assertBytecodeShape(cached.program, `${at}.program`, 1);
	});

	if (candidate.frozen !== undefined) {
		if (!Array.isArray(candidate.frozen)) malformed("frozen", "an array of frozen answers", candidate.frozen);
		candidate.frozen.forEach((record, i) => {
			const at = `frozen[${i}]`;
			if (!isRecord(record) || typeof record.key !== "string" || !Number.isFinite(record.at) || !isIsoDay(record.day)) {
				malformed(at, "a frozen answer as { key, at: time, day: YYYY-MM-DD, value }", record);
			}
			assertValueShape(record.value, `${at}.value`);
		});
	}
}
