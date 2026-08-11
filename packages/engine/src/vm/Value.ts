import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { chargeAllocation } from "@solve-js/vm/AllocationBudget";
import type { SymbolicNode } from "@solve-js/symbolic";

/**
 * A single matrix cell. `boolean` covers element-wise comparison results
 * (`[1,6;3,8] < [5,2;7,4]` produces a Matrix of booleans, not numbers). A
 * `SymbolicNode` cell is a free-variable algebraic entry, e.g. `s =
 * [sx,0,0;0,sy,0;0,0,1]` where `sx`/`sy` are never assigned, so those
 * cells store a real `SymbolicNode` (a bare `var` node initially) rather
 * than degrading to `0`. See `MatrixOps.ts`'s `entryToSymbolic()`/
 * `symbolicToEntry()` for the two-way conversion every symbolic-aware
 * matrix op (multiply, inverse, determinant) uses.
 */
export type MatrixEntry = number | boolean | SymbolicNode;

/**
 * A general rows×cols matrix, a vector is just a 1×N (row) or N×1 (column)
 * matrix. `data` is COLUMN-MAJOR (`data[row + col*rows]`), matching the
 * spec's own `a[index]` column-major indexing semantics directly (no
 * translation needed for single-index reads). `hasSymbolic` lets every
 * numeric matrix op fast-path the all-numeric case with one boolean check,
 * mirroring `binaryOp()`'s existing Number+Number fast path, computed by
 * `matrixValue()` itself (true the moment any cell is a `SymbolicNode`
 * object rather than a plain number/boolean), not something callers set
 * by hand.
 */
export interface MatrixData {
	readonly rows: number;
	readonly cols: number;
	readonly data: readonly MatrixEntry[];
	readonly hasSymbolic: boolean;
}

/** A first-class integer range `min:max`, both bounds inclusive. */
export interface RangeData {
	readonly min: number;
	readonly max: number;
}

/**
 * Discriminated union tag for {@link Value} objects.
 *
 * Determines the runtime type of a Value and how its `value` field should
 * be interpreted. Used by the VM for type-aware dispatch in arithmetic,
 * comparison, and conversion operations.
 */
export enum ValueType {
	/** Plain 64-bit floating point number (IEEE 754 double) */
	Number = 0,
	Hex = 1,
	BigInt = 2,
	String = 3,
	Datetime = 4,
	Percentage = 5,
	Uom = 6,
	/** General rows×cols matrix (a vector is a 1×N or N×1 matrix). Value is {@link MatrixData}. */
	Matrix = 7,
	/** A first-class integer range `min:max`, both inclusive. Value is {@link RangeData}. */
	Range = 8,
	/** A symbolic/algebraic expression tree (free-variable formula, not a concrete number). Value is a `SymbolicNode` (`@solve-js/symbolic`). */
	Symbolic = 9,
	/** Boolean true/false. Value is `boolean`. */
	Boolean = 10,
	/** Unit of measurement token (lexer only, not a runtime value). */
	Unit = 11,
	/** Async result pending resolution. Value stores the queryKey string. */
	Pending = 12,
	/** Plugin-raised error propagated through the DAG. Value stores error code, unit stores message. */
	Error = 13,
}

// ── ValueArena ────────────────────────────────────────────────────────────
// Phase 5.3: Bump-allocator arena for zero-allocation Value reuse during scroll.
// Instead of allocating new Value objects per instruction, we pre-allocate a
// block and bump an index. A single arena.reset() per scroll frame recycles all
// Values, no per-value release overhead, no GC pressure during 60fps scrolling.

/**
 * Bump-allocator arena for zero-allocation Value reuse during scroll.
 *
 * Instead of allocating new Value objects per instruction, pre-allocates a
 * block and bumps an index. `arena.reset()` per scroll frame recycles all
 * Values, no per-value release overhead, no GC pressure during 60fps scrolling.
 *
 * Only active during Tier 2 scroll execution (ThreeTierEvaluator).
 */
export class ValueArena {
	private arena: Value[] = [];
	private index: number = 0;
	/** The block size to come back down to. Kept so {@link reset} can. */
	private readonly initialSize: number;

	/**
	 * How much more than the last cycle needed the arena may go on holding
	 * before it gives the difference back, and how much of it it keeps when it
	 * does.
	 *
	 * A bump allocator that grows to serve one expensive line is working as
	 * intended; one that never comes down is a leak wearing a cache's clothes.
	 * `map(x*1, 1:100000)` is an ordinary line by every limit the engine has,
	 * and it took the arena from 512 Values to 300,004, about 24MB that stayed
	 * live through two forced full collections and through every later `1 + 1`,
	 * because `acquire()` handles overflow with `push()` and `reset()` only
	 * zeroed the bump index. The instance is module-level and survives
	 * `disableValueArena()` on purpose, so that high-water mark was for the
	 * life of the process.
	 *
	 * Keeping twice what the last cycle used, and only shrinking once holding
	 * four times that, is what stops the release from becoming a different
	 * performance bug: a steady scroll uses about the same number of Values
	 * every frame, so it never meets the condition at all, and an alternating
	 * heavy/light document degrades at worst to allocating the Values it would
	 * have allocated with no arena in the first place.
	 */
	private static readonly SHRINK_WHEN_HOLDING_TIMES = 4;
	private static readonly KEEP_TIMES = 2;

	/** Pre-allocate initial block. 512 Values covers ~30-line viewport comfortably. */
	constructor(initialSize: number = 512) {
		this.initialSize = initialSize;
		for (let i = 0; i < initialSize; i++) {
			this.arena.push(new Value(ValueType.Number, 0));
		}
	}

	/** Bump-allocate a recycled Value. Falls back to allocation only for overflow. */
	acquire(type: ValueType, value: number | bigint | string | boolean | MatrixData | RangeData | SymbolicNode, unit?: string): Value {
		if (this.index < this.arena.length) {
			const v = this.arena[this.index++];
			v.recycle(type, value, unit);
			return v;
		}
		// Arena overflow, allocate fresh (rare, only for very complex expressions)
		const v = new Value(type, value, unit);
		this.arena.push(v);
		this.index++;
		return v;
	}

	/**
	 * Reset for the next scroll frame, releasing a block the last frame turned
	 * out not to need.
	 *
	 * Still O(1) in the ordinary case: one comparison against what the cycle
	 * that just ended used, and the truncation only on the frame after an
	 * unusually expensive one. Reading the usage here rather than at
	 * `disableValueArena()` is what makes the policy "the first cycle that does
	 * not need the block gives it back", which is the first thing a host does
	 * after the line that grew it.
	 */
	reset(): void {
		const usedLastCycle = this.index;
		this.index = 0;
		if (this.arena.length <= this.initialSize) return;
		if (this.arena.length <= usedLastCycle * ValueArena.SHRINK_WHEN_HOLDING_TIMES) return;
		// Never below the initial block, and never above what is already held,
		// so this only ever truncates.
		this.arena.length = Math.max(this.initialSize, usedLastCycle * ValueArena.KEEP_TIMES);
	}

	/** Current arena utilization (for diagnostics). */
	get usage(): number { return this.index; }
	get capacity(): number { return this.arena.length; }
}

// Module-level arena toggle. Single-threaded JS, so global state is safe.
// The arena is ONLY active during Tier 2 scroll execution, the ThreeTierEvaluator
// enables it before evaluating visible lines and disables it after.
//
// The arena INSTANCE survives disable(): constructing a ValueArena allocates
// its whole initial block (512 Values), so dropping it on every disable would
// pay that allocation cost again on the next enable, more garbage than the
// arena saves. Instead, an `_arenaActive` flag gates use of the long-lived
// instance; enable() just resets the bump index.
let _arena: ValueArena | null = null;
let _arenaActive = false;

/** Enable the Value arena for zero-allocation scroll execution. */
export function enableValueArena(size?: number): ValueArena {
	if (!_arena) _arena = new ValueArena(size);
	_arena.reset();
	_arenaActive = true;
	return _arena;
}

/** Disable the arena (returns to normal GC-collected allocation). */
export function disableValueArena(): void {
	_arenaActive = false;
}

/** Check if arena is active (used by STORE_VAR / HALT to decide cloning). */
export function isArenaActive(): boolean {
	return _arenaActive;
}

/**
 * Allocate a Value that persists beyond the current arena cycle.
 * Used for values stored in variables (STORE_VAR) and final expression results
 * (HALT return), these must survive arena.reset() in the next scroll frame.
 */
export function persistentValue(v: Value): Value {
	return new Value(v.type, v.value, v.unit);
}

// ── Dev-mode immutability guard (Part II, L5, Value model hardening) ──
//
// Value is documented immutable by convention, not enforcement: the arena
// mutates objects in place via recycle() (by design, for Tier-2 scroll
// performance), so Value can never be unconditionally frozen. This guard
// freezes a Value ONLY when it is safe to do so, i.e. NOT while the arena
// is active, since an arena-active Value may still be recycled later in
// the same scroll frame. It is a no-op outside development builds (matches
// the existing `process.env.NODE_ENV === "development"` convention used by
// the app-layer logger) so there is zero runtime cost in production.
const isDevelopmentBuild = process.env.NODE_ENV === "development";

/**
 * Freeze a Value in development builds, catching accidental external
 * mutation of "immutable" results early. Safe to call unconditionally
 * it is a no-op in production and a no-op whenever the arena is active
 * (an arena-active Value may still be recycle()'d before this scroll
 * frame ends, and freezing it would make recycle() throw).
 *
 * Intended for values leaving a public evaluation boundary
 * (ExpressionEngine.evaluateLine* / evaluateExpression), not for values
 * still moving through internal VM/arena machinery.
 */
export function freezeIfDev<T extends Value>(value: T): T {
	if (isDevelopmentBuild && !isArenaActive()) {
		// toNumber() lazily memoizes _cachedNumber for bigint/string values
		// (Number/Hex are already eagerly cached by the constructor), warm
		// it now so a later toNumber() call on the frozen object doesn't
		// try to write to a frozen field.
		value.toNumber();
		Object.freeze(value);
	}
	return value;
}

/**
 * Universal runtime value for the solve-js VM.
 *
 * Carries a {@link ValueType} discriminant, a polymorphic `value` payload,
 * and an optional `unit` string (for UoM values). Treated as immutable after
 * construction, the arena reuses objects internally via `recycle()`, but
 * external code should never mutate Value fields.
 *
 * A cached `_cachedNumber` avoids repeated `toNumber()` computation on
 * hot paths (ADD/SUB/MUL in the VM dispatch loop).
 */
export class Value {
	// Cached numeric representation, computed once on first toNumber() call.
	// Cleared on recycle() when the arena reuses this Value for a new value.
	private _cachedNumber: number | undefined;

	// Fields are NOT readonly, the arena reuses Value objects by calling
	// recycle() which overwrites all fields. External code should treat Values
	// as immutable after construction (arena handles mutation internally).
	public type: ValueType;
	public value: number | bigint | string | boolean | MatrixData | RangeData | SymbolicNode;
	public unit?: string;
	/** Set by async resolvers when a fetch timed out, the result is a fallback (typically 0). */
	public timedOut?: boolean;

	constructor(
		type: ValueType,
		value: number | bigint | string | boolean | MatrixData | RangeData | SymbolicNode,
		unit?: string
	) {
		this.type = type;
		this.value = value;
		this.unit = unit;
		// Eagerly cache for Number and Hex types (the most common case).
		// This avoids a method call + type-check on first toNumber().
		if (typeof value === 'number') {
			this._cachedNumber = value;
		}
	}

	/**
	 * Phase 5.3: Reset all fields for arena reuse.
	 * Called by ValueArena.acquire(), zero allocation, just field assignment.
	 */
	recycle(type: ValueType, value: number | bigint | string | boolean | MatrixData | RangeData | SymbolicNode, unit?: string): void {
		this.type = type;
		this.value = value;
		this.unit = unit;
		// Clear cache, value changed, cached number is stale.
		// Re-eager-cache for Number type (most common).
		this._cachedNumber = typeof value === 'number' ? value : undefined;
		// Clear timeout flag, recycled Values shouldn't inherit stale metadata.
		this.timedOut = undefined;
	}

	isNumber(): this is Value & { value: number } {
		return this.type === ValueType.Number;
	}

	isHex(): this is Value & { value: number } {
		return this.type === ValueType.Hex;
	}

	isBigInt(): this is Value & { value: bigint } {
		return this.type === ValueType.BigInt;
	}

	isString(): this is Value & { value: string } {
		return this.type === ValueType.String;
	}

	isMatrix(): this is Value & { value: MatrixData } {
		return this.type === ValueType.Matrix;
	}

	/** A Matrix shaped like a vector, 1×N (row) or N×1 (column). */
	isVectorShape(): boolean {
		if (this.type !== ValueType.Matrix) return false;
		const m = this.value as MatrixData;
		return m.rows === 1 || m.cols === 1;
	}

	isRange(): this is Value & { value: RangeData } {
		return this.type === ValueType.Range;
	}

	isSymbolic(): this is Value & { value: SymbolicNode } {
		return this.type === ValueType.Symbolic;
	}

	toNumber(): number {
		// Pending/Error have no numeric representation at all, 0 (established
		// convention). A genuinely multi-cell Matrix has no single numeric
		// representation either (real callers branch on `.isMatrix()` BEFORE
		// reaching this fallback. See e.g. VM.ts's MUL/comparison dispatch)
		// but a 1x1 Matrix, the shape `float(x)`'s legacy sugar produces, see
		// packages/vector/parselets/FloatParselet.ts, IS a scalar in every
		// meaningful sense, so it degrades to that single cell's numeric value
		// rather than 0 (this exact case used to work "by accident" pre-Matrix,
		// since `parseFloat([2].toString())` happened to yield `2`).
		if (this.type === ValueType.Pending) return 0;
		if (this.type === ValueType.Error) return 0;
		if (this.type === ValueType.Matrix) {
			const m = this.value as MatrixData;
			if (m.rows === 1 && m.cols === 1 && typeof m.data[0] === "number") return m.data[0];
			return 0;
		}
		if (this.type === ValueType.Range) return 0;
		// A symbolic expression has no single concrete numeric value by
		// definition (it's a free-variable formula), 0, matching the
		// Pending/Error/Range convention. Real callers branch on
		// `.isSymbolic()` BEFORE reaching this fallback (see
		// `VMConversion.ts`'s `binaryOp()`).
		if (this.type === ValueType.Symbolic) return 0;
		// A boolean has an obvious numeric reading and no branch used to give it
		// one, so it fell through to `parseFloat(true)` -> NaN -> 0, and BOTH
		// booleans read as zero: `true == false` answered true, and every
		// arithmetic path that mixes a boolean with a number ("true and 5")
		// contributed nothing. 1/0 is the reading every language with a numeric
		// boolean coercion uses, and the one `if 1 then` already implies.
		if (this.type === ValueType.Boolean) return this.value === true ? 1 : 0;

		if (this._cachedNumber !== undefined) return this._cachedNumber;

		if (typeof this.value === 'bigint') {
			this._cachedNumber = Number(this.value);
			return this._cachedNumber;
		}
		// Prevent silent NaN propagation from non-numeric strings
		const result = parseFloat(this.value as string);
		this._cachedNumber = isNaN(result) ? 0 : result;
		return this._cachedNumber;
	}

	isNaN(): boolean {
		if (this.type === ValueType.Pending) return false;
		if (this.type === ValueType.Error) return false;
		if (this.type === ValueType.Matrix) {
			const m = this.value as MatrixData;
			if (m.rows === 1 && m.cols === 1 && typeof m.data[0] === "number") return isNaN(m.data[0]);
			return false;
		}
		if (this.type === ValueType.Range) return false;
		if (this.type === ValueType.Symbolic) return false;
		// Matches toNumber()'s boolean reading above. Without this a Boolean
		// reached the string branch at the bottom and `parseFloat(true)` made
		// every boolean report itself as NaN.
		if (this.type === ValueType.Boolean) return false;
		if (typeof this.value === 'number') return isNaN(this.value);
		if (typeof this.value === 'bigint') return false;
		return isNaN(parseFloat(this.value as string));
	}
}

/**
 * Create a Number-typed Value. Uses the arena when active for zero-allocation.
 * This is the most common factory, over 90% of all Value creations.
 */
export function numberValue(n: number): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Number, n);
	return new Value(ValueType.Number, n);
}

/** Which base a {@link ValueType.Hex} value is displayed in. */
export type DisplayBase = "hex" | "bin" | "oct";

/**
 * Create a Hex-typed Value: a **number** that displays in another base.
 *
 * The type is numeric on purpose, and that is the whole point of it. A base is
 * a way of writing a quantity, not a different kind of quantity, so `0xFF + 1`
 * has to be 256. Returning a string instead makes it 1, because a string reads
 * as zero in arithmetic, and nothing about that failure is visible at the point
 * of use.
 *
 * @param n - The number itself, in full precision. A `bigint` is accepted for
 * the same reason the type is numeric at all: `12345678901234567890n as hex`
 * has an exact answer, and forcing it through a double first rendered
 * 0xAB54A98CEB1F0800 for a value ending 0AD2.
 * @param base - How to display it, defaulting to hexadecimal. Carried in the
 * `unit` slot, which is free for this type.
 */
export function hexValue(n: number | bigint, base: DisplayBase = "hex"): Value {
	const tag = base === "hex" ? undefined : base;
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Hex, n, tag);
	return new Value(ValueType.Hex, n, tag);
}

/** Create a BigInt-typed Value (arbitrary-precision integer). */
export function bigIntValue(n: bigint): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.BigInt, n);
	return new Value(ValueType.BigInt, n);
}

/** Create a String-typed Value. */
export function stringValue(s: string): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.String, s);
	return new Value(ValueType.String, s);
}

/** Create a Unit-of-Measurement Value (typed number with unit annotation). */
export function uomValue(n: number, unit: string): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Uom, n, unit);
	return new Value(ValueType.Uom, n, unit);
}

// ── Rate, "quantity per unit of something" (SoulverCore: `$99/week`
// `3 hours/day`, `30 fps`). Represented as a `ValueType.Uom` (no new
// ValueType, a rate IS a unit-of-measurement, just a compound one) whose
// `unit` string is `"<numerator>/<denominator>"`. The numerator is an
// opaque label (may be a real convertible unit like "USD"/"km", or a bare
// tag like "frames" that the `convert` package doesn't know about, rate
// arithmetic never needs to convert the numerator, only compare it for
// equality when combining two rates). The denominator MUST be a unit
// `convertUnit()`/`getMeasure()` (uom/UomConverter.ts) recognizes, since
// that's the part rate arithmetic actually rescales. See `vm/VM.ts`'s
// `RATE_CONVERT`/`RATE_MUL`/`RATE_DIV` opcodes for the operations built on
// this representation.

/** Create a Rate value: `magnitude` of `numeratorUnit` per one `denominatorUnit`. */
export function rateValue(magnitude: number, numeratorUnit: string, denominatorUnit: string): Value {
	return uomValue(magnitude, `${numeratorUnit}/${denominatorUnit}`);
}

/** Whether `unit` is a compound rate unit (`"X/Y"`) rather than a plain unit. */
export function isRateUnit(unit: string | undefined): unit is string {
	return typeof unit === "string" && unit.includes("/");
}

/**
 * Split a rate unit string into its numerator/denominator halves.
 * @throws if `unit` isn't a rate unit, check with {@link isRateUnit} first.
 */
export function splitRateUnit(unit: string): { numerator: string; denominator: string } {
	const idx = unit.indexOf("/");
	if (idx < 0) {
		throw ErrorFactory.internal(
			"INVALID_RATE_UNIT",
			`splitRateUnit: "${unit}" is not a rate unit (expected "numerator/denominator")`,
			{ unit },
		);
	}
	return { numerator: unit.slice(0, idx), denominator: unit.slice(idx + 1) };
}

/** Join a numerator/denominator pair back into a rate unit string. */
export function joinRateUnit(numeratorUnit: string, denominatorUnit: string): string {
	return `${numeratorUnit}/${denominatorUnit}`;
}

// ── Video timecode, "HH:MM:SS:FF at a given fps" (SoulverCore: video
// editing timecode literals, e.g. `01:02:03:04 at 30fps`). Represented the
// same way Rate is above: NOT a new ValueType, just a `ValueType.Uom` whose
// `unit` string is `"timecode@<fps>"` and whose numeric `value` is the
// TOTAL FRAME COUNT since 00:00:00:00 at that fps, e.g. "00:00:01:00 at
// 30fps" is `Uom(30, "timecode@30")`.
//
// Storing the total frame count (rather than four separate H/M/S/F fields)
// means ordinary integer addition/subtraction on the numeric value is
// ALREADY correct carry/borrow-aware arithmetic with zero extra logic
// e.g. "frame 29 + 2 frames" at 30fps is just `29 + 2 = 31`, and 31 total
// frames at 30fps IS frame 1 of the next second, with no explicit carry
// step required. Carry/borrow only needs to be reconstructed when
// converting a total frame count back into HH:MM:SS:FF display notation
// see `packages/time/timecode/TimecodeMath.ts`'s `framesToTimecodeString()`.
// See `vm/VM.ts`'s ADD/SUB dispatch for the arithmetic built on this
// representation (timecode + frames, + duration, + timecode, - timecode).

const TIMECODE_UNIT_PREFIX = "timecode@";

/** Build a timecode Uom unit string embedding its frame rate, e.g. `timecodeUnit(30)` -> `"timecode@30"`. */
export function timecodeUnit(fps: number): string {
	return `${TIMECODE_UNIT_PREFIX}${fps}`;
}

/** Whether `unit` is a compound video-timecode unit (`"timecode@<fps>"`). */
export function isTimecodeUnit(unit: string | undefined): unit is string {
	return typeof unit === "string" && unit.startsWith(TIMECODE_UNIT_PREFIX);
}

/**
 * Extract the fps from a timecode unit string.
 * @throws if `unit` isn't a timecode unit, check with {@link isTimecodeUnit} first.
 */
export function timecodeFps(unit: string): number {
	if (!isTimecodeUnit(unit)) {
		throw ErrorFactory.internal(
			"INVALID_TIMECODE_UNIT",
			`timecodeFps: "${unit}" is not a timecode unit (expected "timecode@<fps>")`,
			{ unit },
		);
	}
	return parseFloat(unit.slice(TIMECODE_UNIT_PREFIX.length));
}

/**
 * Create a Matrix value from an explicit shape + column-major data array.
 * `data.length` must equal `rows*cols`, callers building a matrix from
 * row-major source syntax (e.g. the `[1,2;3,4]` literal) must transpose
 * into column-major order before calling this; see `MatrixOps.ts`'s
 * `rowMajorToColumnMajor()`.
 */
export function matrixValue(rows: number, cols: number, data: readonly MatrixEntry[]): Value {
	// Every matrix in the engine is born here, which makes this the one place
	// that can charge for one without each producer having to remember to. The
	// charge lands after `data` exists, so it is a backstop rather than a
	// refusal: it cannot stop a single allocation that is already fatal (the
	// sites whose size is knowable in advance charge before allocating, see
	// `vm/VM.ts`'s matrix cases), but it does stop the second one, and it means
	// an opcode added later inherits the bound without being told about it.
	// Free in relative terms: the hasSymbolic scan just below is already O(n)
	// over the same cells.
	chargeAllocation(data.length, "matrix cells");
	// A SymbolicNode cell is the only object-typed MatrixEntry variant
	// (number/boolean are primitives), a cheap, always-correct way to
	// derive hasSymbolic without asking every caller to track it by hand.
	// The `"kind" in cell` half is a tripwire, not redundancy. MatrixEntry is
	// `number | boolean | SymbolicNode`, so an object cell should always be a
	// node; requiring the discriminant means a Rational that escaped
	// MatrixOps.ts's symbolicToEntry() shows up as a wrong result rather than as
	// a matrix that silently believes it is symbolic.
	const hasSymbolic = data.some(cell => typeof cell === "object" && cell !== null && "kind" in cell);
	const m: MatrixData = { rows, cols, data, hasSymbolic };
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Matrix, m);
	return new Value(ValueType.Matrix, m);
}

/** A 1×N row-vector Matrix, row-major and column-major storage are identical for a single row. */
export function rowVectorValue(data: readonly number[]): Value {
	return matrixValue(1, data.length, data);
}

/** An N×1 column-vector Matrix, row-major and column-major storage are identical for a single column. */
export function colVectorValue(data: readonly number[]): Value {
	return matrixValue(data.length, 1, data);
}

/** Create a Range value, a first-class integer range `min:max`, both bounds inclusive. */
export function rangeValue(min: number, max: number): Value {
	const r: RangeData = { min, max };
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Range, r);
	return new Value(ValueType.Range, r);
}

/** Create a Symbolic value, a free-variable algebraic expression tree (`symbolic/SymbolicNode.ts`'s `SymbolicNode`), not a concrete number. */
export function symbolicValue(node: SymbolicNode): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Symbolic, node);
	return new Value(ValueType.Symbolic, node);
}



/** Create a Boolean-typed Value. */
export function boolValue(b: boolean): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Boolean, b);
	return new Value(ValueType.Boolean, b);
}

/** Create a Datetime-typed Value (Unix timestamp in milliseconds). */
export function datetimeValue(n: number): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Datetime, n);
	return new Value(ValueType.Datetime, n);
}

/** Create a Percentage-typed Value (stored as fraction, e.g. 0.5 for 50%). */
export function percentageValue(n: number): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Percentage, n);
	return new Value(ValueType.Percentage, n);
}

/**
 * Create a Pending value, signals that an async result is not yet resolved.
 * The value field stores the queryKey string for deduplication and diagnostics.
 * Pending values should NEVER be stored in the arena (they persist across
 * scroll frames until resolution completes).
 */
export function pendingValue(queryKey: string): Value {
	return new Value(ValueType.Pending, queryKey);
}

/**
 * Create an Error value, propagated through the DAG when a plugin raises an error.
 * The value field stores the EngineError code, unit stores the message.
 * Downstream consumers (lines that depend on errored data) bubble this up.
 * Should NEVER be stored in the arena.
 */
export function errorValue(code: string, message: string): Value {
	return new Value(ValueType.Error, code, message);
}

/**
 * The first operand carrying a fault rather than a quantity, if any does.
 *
 * `Error` and `Pending` both read as the number 0 through {@link Value.toNumber},
 * by a convention that only holds up as long as nothing asks. Every opcode and
 * builtin that reaches for an operand's number without asking its type first
 * therefore computes with a zero it cannot tell apart from a real one, and
 * hands back an answer dressed in whatever type it was going to produce
 * anyway. That is how `(5 kg to m) to s` came to answer `0.00 s`: the failed
 * conversion is an Error, the second conversion read it as zero, and the unit
 * the reader asked for made the result look like a conversion that worked.
 *
 * Operands are checked left to right, matching evaluation order, and the
 * faulted Value is returned AS IT IS rather than replaced with a fresh one, so
 * the original code and message (or the pending query key) reach the caller
 * unchanged. `binaryOp` (vm/VMConversion.ts) and `OpCode.EXP` already did this
 * inline; this is the same rule for every other site, in one place so a site
 * added later can adopt it in a line.
 *
 * Three operands cover every call site in the VM (`MAT_INDEX2` and `MAT_SLICE`
 * are the widest). A variadic signature would allocate an arguments array on
 * paths that run per instruction; see {@link faultedIn} for the list case.
 *
 * @returns The faulted operand, or `null` when all of them carry a value.
 */
export function faultedOperand(a: Value, b?: Value, c?: Value): Value | null {
	if (a.type === ValueType.Error || a.type === ValueType.Pending) return a;
	if (b !== undefined && (b.type === ValueType.Error || b.type === ValueType.Pending)) return b;
	if (c !== undefined && (c.type === ValueType.Error || c.type === ValueType.Pending)) return c;
	return null;
}

/**
 * {@link faultedOperand} over an already-built list, for the call sites that
 * have one (a builtin's arguments, a plugin function's).
 *
 * @returns The first faulted element, or `null` when every element carries a value.
 */
export function faultedIn(values: readonly Value[]): Value | null {
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (v.type === ValueType.Error || v.type === ValueType.Pending) return v;
	}
	return null;
}
