import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { chargeAllocation } from "@solve-js/vm/AllocationBudget";
import type { SymbolicNode, Rational } from "@solve-js/symbolic";
import { decimalToString, type DecimalData } from "@solve-js/decimal";
import type { ValueSource, FrozenMark } from "@solve-js/vm/Provenance";

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
 * How a colour was authored, and therefore how it should display. It never
 * changes the channels: a colour is always stored as canonical sRGB (`r`,`g`,`b`
 * integers 0-255, `a` in 0-1), and `format` only decides whether `formatValue`
 * renders it as `#rrggbb`, `rgb(...)`, `hsl(...)` or a named keyword.
 */
export type ColourFormat = "hex" | "rgb" | "rgba" | "hsl" | "hsla" | "named";

/**
 * A colour value. Canonical channels are sRGB (`r`,`g`,`b` are integers 0-255,
 * `a` is 0-1); HSL is never stored, it is derived on demand for display and for
 * hue/saturation/lightness operations, then re-quantised back to RGBA. A
 * `lighten` followed by an equal `darken` returns to within one rounding step of
 * the original (integer channels re-quantise each way), and does not drift on
 * repetition, rather than storing both HSL and RGB and letting them disagree.
 * `format`
 * records the authored/display form; `name` carries the CSS keyword only when
 * `format === "named"` (e.g. `"rebeccapurple"`). Lives in a {@link Value}'s
 * `value` slot exactly as {@link MatrixData}/{@link RangeData} do.
 */
export interface ColourData {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
	readonly format: ColourFormat;
	readonly name?: string;
}

/**
 * One tier of a bill split: an amount and how many people pay it. An even
 * split is a single share; the odd-penny case is two shares (the base amount
 * most people pay, then the base plus a cent that the remaining `count` pay),
 * so the shares always add back to the exact total. `exact` carries the
 * base-ten cents of a currency share so display rounds from the decimal rather
 * than a drifted double, exactly as money does everywhere else.
 */
export interface SplitShare {
	readonly value: number;
	readonly exact?: DecimalData;
	readonly count: number;
}

/**
 * The result of a per-person bill split (`split $180 between 4`). `unit` is the
 * currency code when the amount was money, undefined for a bare number.
 * `shares` is ordered base-first: `shares[0]` is the "each" amount, and a
 * second share, when present, is the slightly larger amount the odd penny falls
 * on. Lives in a {@link Value}'s `value` slot exactly as {@link ColourData} and
 * {@link RangeData} do, a display-only payload the formatter renders.
 */
export interface SplitData {
	readonly unit?: string;
	readonly shares: readonly SplitShare[];
}

/**
 * What a {@link ChartData} draws, and therefore how a host renders it: a
 * `sparkline` is a tiny inline line with no axes, a `plot` a framed curve over a
 * domain. New kinds (a bar chart, a scatter) are added here, and every host that
 * switches on `kind` keeps working for the ones it already knows.
 */
export type ChartKind = "sparkline" | "plot";

/**
 * What a `Datetime`'s epoch-millisecond payload anchors.
 *
 * Three questions share one number and mean different things by it, which is
 * why the distinction is recorded rather than inferred:
 *
 * - `date`: a calendar day, held as its local midnight (`2026-04-03`,
 *   `3 April 2026`, `03/04/2026`). The time of day carries no meaning.
 * - `datetime`: a wall-clock reading on a day, in the calendar backend's own
 *   zone (`2026-04-03T09:30`, `6pm`). The reading is what was named; the
 *   instant follows from the zone it is read in.
 * - `instant`: a fixed point on the timeline, named without depending on a
 *   zone (`2026-04-03T10:30:00Z`, `...+09:00`, `now`).
 * - `time`: a time of day, as a clock time names one (`9:00am`, `16:00`), or
 *   a value written `as time` (#708). A wall-clock reading like `datetime`,
 *   held on the day it was written for so arithmetic keeps working, and shown
 *   as the time alone, with the days it has moved from that day beside it.
 *
 * See {@link Value.grain} for why the number cannot answer this on its own.
 */
export type DatetimeGrain = "date" | "datetime" | "instant" | "time";

/**
 * A chart specification: the DATA to draw, never pixels. One shape holds every
 * visual the engine produces, `[1,2,3] as sparkline` and `plot sin(x) from 0 to
 * 2pi` alike, so a host reads `kind` to choose a renderer and draws `points`
 * scaled to `domain` × `range`. The engine brings the numbers; the developer
 * brings the charting library. `label` is the plain-text answer a reader without
 * a canvas still gets. A sparkline's points are `(index, value)`; a plot's are
 * `(x, y)`. Lives in a {@link Value}'s `value` slot exactly as
 * {@link MatrixData}/{@link ColourData} do (issues #186, #187).
 */
export interface ChartData {
	readonly kind: ChartKind;
	/** The points to draw, `(x, y)`. A sparkline indexes x from 0. */
	readonly points: readonly (readonly [number, number])[];
	/** The plain-text answer, e.g. `sin(x) over [0, 6.28]` or the series itself. */
	readonly label: string;
	/** The x-axis extent `[min, max]`. */
	readonly domain: readonly [number, number];
	/** The y-axis extent `[min, max]`, for scaling the drawn height. */
	readonly range: readonly [number, number];
	/** The source expression, for a plot; absent for a sparkline. */
	readonly expr?: string;
}

/**
 * An IPv4 address and/or subnet prefix (issue #189). `addr` is the 32-bit
 * address (`192.168.1.10` held as one number); `prefix` is the CIDR prefix
 * length in `/24`. A bare address has no `prefix`, a bare `/24` has no `addr`,
 * and a full block (`192.168.1.0/24`) has both. Lives in a {@link Value}'s
 * `value` slot as the other struct payloads do; the formatter renders it as the
 * dotted quad (plus `/prefix` when present).
 */
export interface IpCidrData {
	readonly addr?: number;
	readonly prefix?: number;
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
	/** A colour (hex/rgb/hsl/named). Value is {@link ColourData}. */
	Colour = 14,
	/** A per-person bill split (`split $180 between 4`). Value is {@link SplitData}. */
	Split = 15,
	/** A chart to draw (`[1,2,3] as sparkline`, `plot sin(x) from 0 to 2pi`). Value is {@link ChartData}. */
	Chart = 16,
	/** An IPv4 address or subnet (`192.168.1.0/24`). Value is {@link IpCidrData}. */
	IpCidr = 17,
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

	/**
	 * The most Values the arena pools. Past it, {@link acquire} hands out an
	 * ordinary Value the collector reclaims, the Value it would have allocated
	 * with no arena at all.
	 *
	 * The shrink rule above releases a block only on a lighter cycle after it,
	 * so a document that grows the arena on every pass kept it for as long as it
	 * was open: five 1,000-step sweeps held 1,000,229 Values, and 1,000 reads of
	 * a 1,000-row table column held 1,003,001. The heaviest document pass in the
	 * docs corpus uses 847 pooled Values (the 99th percentile, 71), so the
	 * ceiling sits about twenty times above real use and a scroll frame never
	 * meets it.
	 */
	private static readonly MOST_POOLED = 16_384;

	/** Pre-allocate initial block. 512 Values covers ~30-line viewport comfortably. */
	constructor(initialSize: number = 512) {
		this.initialSize = initialSize;
		for (let i = 0; i < initialSize; i++) {
			this.arena.push(new Value(ValueType.Number, 0));
		}
	}

	/** Bump-allocate a recycled Value. Falls back to allocation only for overflow. */
	acquire(type: ValueType, value: number | bigint | string | boolean | MatrixData | RangeData | ColourData | SplitData | ChartData | IpCidrData | SymbolicNode, unit?: string): Value {
		if (this.index < this.arena.length) {
			const v = this.arena[this.index++];
			v.recycle(type, value, unit);
			return v;
		}
		// Arena overflow, allocate fresh (rare, only for very complex expressions),
		// pooled only while the block is under its ceiling.
		const v = new Value(type, value, unit);
		if (this.arena.length >= ValueArena.MOST_POOLED) return v;
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

/**
 * Run `work` with the arena off, then put it back as it was.
 *
 * For work inside a scroll pass whose Values are not scroll values: a what-if
 * or sweep's scratch passes, and goal seek's probes. With the arena on, every
 * Value those passes create was pooled, and a pooled Value is held for as long
 * as the arena is, so one 1,000-step sweep left 200,205 Values behind it.
 *
 * @param work - The work to run unpooled.
 * @returns What `work` returns.
 */
export function withoutValueArena<T>(work: () => T): T {
	const wasActive = _arenaActive;
	_arenaActive = false;
	try {
		return work();
	} finally {
		_arenaActive = wasActive;
	}
}

/** Check if arena is active (used by STORE_VAR / HALT to decide cloning). */
export function isArenaActive(): boolean {
	return _arenaActive;
}

/**
 * Allocate a Value that persists beyond the current arena cycle.
 * Used for values stored in variables (STORE_VAR) and final expression results
 * (HALT return), these must survive arena.reset() in the next scroll frame.
 *
 * A full {@link Value.clone}, so every sidecar survives the round trip: the
 * exact decimal ("a = $0.10, b = $0.20, a + b" stays exact), the rational
 * ("a = 1/3, a + a + a" is exactly 1), the uncertainty ("a = 12.3 +/- 0.5,
 * a * 4" keeps its tolerance), the display precision, and the two a datetime
 * carries ("d = 2026-04-03 in Tokyo, d" is still that day in Tokyo rather than
 * a bare instant). This used to copy some of them by name and drop the rest, so
 * a viewport evaluation (the one path that runs with the arena on) displayed
 * `3.14159 to 4 dp` as 3.14 while a single-line evaluation of the same text
 * displayed 3.1416. Naming them was the bug: a sidecar added later is carried
 * now without this function knowing it exists.
 */
export function persistentValue(v: Value): Value {
	return v.clone();
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
//
// Guarded, as AbortControllerLogger's read is: a browser tab or a module Web
// Worker has no `process`, and an unguarded read at module scope made every
// entry point of the ESM build throw "process is not defined" on import there.
const isDevelopmentBuild = typeof process !== "undefined" && process.env?.NODE_ENV === "development";

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
 * A payload made JSON-safe for {@link Value.toJSON}: every bigint, at any depth,
 * as its decimal string. A symbolic tree's constants and a matrix's entries can
 * hold bigints, so the walk goes into arrays and plain objects; anything else
 * is returned as it is. The walk is bounded by the payload, which the engine
 * already bounds.
 */
function jsonSafe(x: unknown): unknown {
	if (typeof x === "bigint") return x.toString();
	if (Array.isArray(x)) return x.map(jsonSafe);
	if (x !== null && typeof x === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(x)) out[k] = jsonSafe(v);
		return out;
	}
	return x;
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
	public value: number | bigint | string | boolean | MatrixData | RangeData | ColourData | SplitData | ChartData | IpCidrData | SymbolicNode;
	public unit?: string;
	/** Set by async resolvers when a fetch timed out, the result is a fallback (typically 0). */
	public timedOut?: boolean;
	/**
	 * The exact base-ten value this Value stands for, when it has one.
	 *
	 * A sidecar rather than a replacement for `value`: money and decimal-point
	 * literals set it to a {@link DecimalData} so that same-currency arithmetic
	 * and display can be exact ("$0.10 + $0.20" is "$0.30", not
	 * "$0.30000000000000004"), while `value` stays the nearest double so every
	 * existing consumer that reads `.value` or `toNumber()` is unchanged. Plain
	 * numbers carry it through arithmetic as money does (see vm/ExactDecimals.ts),
	 * so "0.1 + 0.2" is exactly 0.3; the plain fast paths leave only for an
	 * operand that carries it, so two whole numbers never pay for it. Cleared by
	 * {@link recycle} so a reused arena Value never inherits a stale exact.
	 */
	public exact?: DecimalData;
	/**
	 * The exact rational value this Value stands for, when it has one.
	 *
	 * The second sidecar, the same shape as {@link exact} and for the same
	 * reason: a fraction has no exact base-ten form (`1/3` is not any decimal),
	 * so exact fraction arithmetic needs a numerator/denominator pair rather
	 * than a coefficient and a scale. Integer division seeds it ("1/3" carries
	 * the {@link Rational} 1/3), and `+`, `-`, `*`, `/` between rational-bearing
	 * numbers keep it reduced, so "1/49 * 49" is exactly 1 and "5/6 - 1/6 - 1/6
	 * - 1/6 - 1/6 - 1/6" is exactly 0 rather than the 1.6e-16 the doubles drift
	 * to. `value` still holds the nearest double, recomputed from the exact
	 * rational so accumulation error never creeps in, which is why the default
	 * display and every `.value`/`toNumber()` reader are unchanged. A fraction
	 * written with "/" carries it, and so does a division of decimals that never
	 * ends ("0.1 / 3" is 1/30); a decimal that ends carries {@link exact}
	 * instead, and a transcendental result ("sqrt(2)") carries neither.
	 * Cleared by {@link recycle} alongside {@link exact}.
	 */
	public rational?: Rational;
	/**
	 * The one-sigma uncertainty (standard error) this value carries, when it
	 * has one.
	 *
	 * The third sidecar, the same shape as {@link exact} and {@link rational}
	 * and for the same reason: a measurement written `12.3 ± 0.5` is still the
	 * number 12.3 everywhere it is read as one, so the type stays
	 * {@link ValueType.Number} and `value` stays the center, while this non
	 * negative field carries the tolerance. The `±` (or ASCII `+/-`) operator
	 * seeds it, and `+`, `-`, `*`, `/` propagate it in quadrature for
	 * independent errors (see `vm/VMConversion.ts`'s `uncertainOp`). Everything
	 * else (a comparison, a transcendental function, a unit conversion) reads
	 * the center through `toNumber()` and drops the tolerance, which is why a
	 * value with no uncertainty behaves exactly as a plain number always did.
	 * Cleared by {@link recycle} alongside the other two sidecars.
	 */
	public uncertainty?: number;
	/**
	 * The number of decimal places this value should DISPLAY at, when it has been
	 * given an explicit precision.
	 *
	 * A display sidecar, not a value one: `value` is unchanged, so every
	 * `.value`/`toNumber()` reader and all arithmetic behave exactly as before,
	 * and a value with no `decimalPlaces` formats the way it always did (the
	 * global two-place default with trailing zeros trimmed). It is set only by an
	 * explicit precision request, `<x> to N dp` and `round(x, N)`, so that
	 * `3.14159 to 4 dp` shows `3.1416` and `1.5 to 2 dp` shows `1.50` rather than
	 * the value being rounded but then displayed at the default two places. It is
	 * NOT propagated through arithmetic (a later `+ 1` re-decides precision),
	 * which is why nothing that did not ask for a precision is affected. Cleared
	 * by {@link recycle} alongside the other sidecars.
	 */
	public decimalPlaces?: number;
	/**
	 * What this instant anchors: a calendar day, a wall-clock reading on one, or
	 * a fixed point on the timeline.
	 *
	 * The fifth sidecar, the same shape as {@link exact}, {@link rational},
	 * {@link uncertainty} and {@link decimalPlaces} and for the same reason: a
	 * `Datetime`'s payload is epoch milliseconds and has to stay a plain number,
	 * because the arena union, the worker DTO, the snapshot's Datetime variant
	 * and the `Datetime` SUB path all read it as one. The number cannot say
	 * which of three questions it is the answer to, and the difference is not
	 * recoverable from it: `formatDatetime` decides whether to print a time by
	 * testing whether the local hour, minute, second and millisecond are all
	 * zero, which is a guess that `2026-04-03T09:00:00+09:00` under `TZ=UTC`
	 * gets wrong, because the nine o'clock the reader typed IS UTC midnight.
	 *
	 * Set only where the shape is known: a date literal is `'date'`, a
	 * wall-clock literal (`2026-04-03T09:30`, `6pm`) is `'datetime'`, a literal
	 * carrying `Z` or an offset is `'instant'`, and so is `now`. Absent means
	 * not recorded, which every reader treats as an instant rather than
	 * inferring one. Nothing in 2.26.0 displays it: the formatter does not read
	 * it, so every rendered date is byte-identical to 2.25.0. Cleared by
	 * {@link recycle} alongside the other sidecars.
	 */
	public grain?: DatetimeGrain;
	/**
	 * The zone this instant should be read and displayed in, when the line
	 * named one.
	 *
	 * A zone reference in the encoding `calendar/IntlZone.ts` documents: an IANA
	 * name (`"Asia/Tokyo"`) or a fixed offset (`"UTCOFFSET:540"`). Set by
	 * `<datetime> in <zone>` and by an ISO literal carrying `Z` or an explicit
	 * offset, which names an offset rather than a zone and so records one.
	 * Absent means the value is read in the calendar backend's own zone, which
	 * is what every `Datetime` meant before this sidecar existed. Like
	 * {@link grain} it is recorded and readable in 2.26.0 and read by the
	 * formatter from 3.0. Cleared by {@link recycle} alongside the other
	 * sidecars.
	 */
	public zone?: string;
	/**
	 * For a time of day (grain `"time"`, #708), an instant on the day it is
	 * counted from, in epoch milliseconds: today's midnight for a clock time, the
	 * value's own instant for one written `as time`. The formatter shows the time alone and
	 * the days it has moved from this one beside it (`1:00:00 AM (+1 day)` for
	 * `11pm + 2 hours`), so the shift is fixed when the time is written rather
	 * than counted from whatever day it is displayed on. Carried through
	 * duration arithmetic with the grain. Cleared by {@link recycle} alongside
	 * the other sidecars.
	 */
	public timeAnchor?: number;
	/**
	 * That this quantity is the gap between two datetimes, rather than a
	 * duration someone wrote down.
	 *
	 * Both are milliseconds and both are a `Uom` in `"ms"`, so the unit cannot
	 * tell them apart, and the formatter used to render every one of them as a
	 * clock. That is right for `10:30 - 08:00`, which reads `2:30`, and wrong
	 * for `40ms + 120ms`, which read `0:00` instead of 190 ms: a latency budget
	 * is a quantity and not a time of day. Set where two datetimes subtract, and
	 * read only by the formatter.
	 *
	 * It survives the arithmetic that keeps a span a span: adding two spans,
	 * scaling one by a plain number, and totalling a column of them, so a
	 * timesheet still reads as a clock and half a shift is `0:30`. It does not
	 * survive a conversion, because `(10:30 - 08:00) in ms` asked for
	 * milliseconds and should be given them, nor combining with a quantity
	 * somebody typed. Cleared by {@link recycle} alongside the other sidecars.
	 */
	public datetimeSpan?: boolean;
	/**
	 * Where the live figures behind this value came from: the provider, how the
	 * engine came by each one, and when.
	 *
	 * A provenance sidecar, the same shape as the others and kept off the same
	 * paths: `value` is untouched, so every reader of the number is unchanged,
	 * and a value computed only from what the reader typed carries nothing. It is
	 * set where a live figure enters (a currency conversion reads the rate
	 * table's record, `createQueryResolver` stamps what it fetched) and merged by
	 * arithmetic, so `(10 USD in GBP) * 3` carries the rate's record and a host
	 * can mark the line as rate-dependent. The ADD/SUB/MUL/DIV fast paths decline
	 * a value carrying it, exactly as they decline a rational or an uncertainty.
	 * The list is shared, never mutated, so a value copied by {@link clone}
	 * shares it safely. See `vm/Provenance.ts`. Cleared by {@link recycle}
	 * alongside the other sidecars.
	 */
	public sources?: readonly ValueSource[];
	/**
	 * That this value is a frozen answer: when it was frozen, and the key it is
	 * stored under.
	 *
	 * Set only on what a `frozen` line answers with (see
	 * `engine/FrozenValues.ts`), and deliberately not carried by arithmetic: a
	 * value computed from a frozen one is new, and says so through
	 * {@link sources}, whose records carry the freeze date. Cleared by
	 * {@link recycle}.
	 */
	public frozen?: FrozenMark;
	/**
	 * The unit this plain number is measured in when the engine cannot spell
	 * it yet: `J·s` for `planck`, `C` (the coulomb) for `elementary charge`.
	 *
	 * Set only by the constants package (#648), on a physical constant whose unit
	 * needs a dimension the unit table does not have (charge, the mole). The
	 * value stays a Number, so `planck * 2` and `avogadro / 1000` are plain
	 * numbers as they always were; what the mark changes is a quantity meeting
	 * it. `planck * 5e14 Hz` read the constant as a bare number and answered in
	 * hertz, the other operand's unit, and is refused by name instead. Arithmetic
	 * does not carry it, since a computed value is not the constant any more; a
	 * variable holding the constant does, through {@link clone}. Cleared by
	 * {@link recycle} alongside the other sidecars.
	 */
	public unspelledUnit?: string;

	constructor(
		type: ValueType,
		value: number | bigint | string | boolean | MatrixData | RangeData | ColourData | SplitData | ChartData | IpCidrData | SymbolicNode,
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
	recycle(type: ValueType, value: number | bigint | string | boolean | MatrixData | RangeData | ColourData | SplitData | ChartData | IpCidrData | SymbolicNode, unit?: string): void {
		this.type = type;
		this.value = value;
		this.unit = unit;
		// Clear cache, value changed, cached number is stale.
		// Re-eager-cache for Number type (most common).
		this._cachedNumber = typeof value === 'number' ? value : undefined;
		// Clear timeout flag, recycled Values shouldn't inherit stale metadata.
		this.timedOut = undefined;
		// Clear the exact sidecar for the same reason: a reused Value that once
		// held money must not carry that money's decimal into a plain number.
		this.exact = undefined;
		// The rational sidecar clears with it: a reused Value that once held a
		// fraction must not carry that fraction into a plain number.
		this.rational = undefined;
		// The uncertainty sidecar clears the same way: a reused Value that once
		// carried a tolerance must not lend it to a plain number.
		this.uncertainty = undefined;
		// The display-precision sidecar clears too: a reused Value that once had
		// an explicit `to N dp` must not display a plain number at that precision.
		this.decimalPlaces = undefined;
		// The two datetime sidecars clear the same way: a reused Value that once
		// held a date in Tokyo must not lend that day, or that zone, to whatever
		// the arena hands out next.
		this.grain = undefined;
		this.zone = undefined;
		this.timeAnchor = undefined;
		this.datetimeSpan = undefined;
		// Provenance clears too: a reused Value that once held a converted
		// amount must not tell a host that a plain number came from a rate.
		this.sources = undefined;
		this.frozen = undefined;
		// A reused Value that once held `planck` must not refuse a quantity later.
		this.unspelledUnit = undefined;
	}

	/**
	 * A fresh Value carrying everything this one does: the payload, the unit,
	 * the cached number and every sidecar, present or future.
	 *
	 * The inverse of {@link recycle}, and written as a whole-object copy rather
	 * than a list of fields on purpose. `persistentValue()` used to name the
	 * sidecars it copied, and the two it did not name (`decimalPlaces`,
	 * `timedOut`) were silently dropped by every viewport evaluation, so
	 * `3.14159 to 4 dp` displayed as 3.14 there and as 3.1416 on a single line.
	 * A sidecar added later is carried here without this method knowing its
	 * name, which closes that class of bug rather than the one instance.
	 *
	 * Shallow, as the old copy was: a matrix, a chart or a symbolic tree is
	 * shared with the original, which is fine because a Value's payload is
	 * treated as immutable everywhere outside the arena's own `recycle()`.
	 *
	 * @returns A new Value equal to this one in every field.
	 */
	clone(): Value {
		const copy = new Value(this.type, this.value, this.unit);
		Object.assign(copy, this);
		return copy;
	}

	/**
	 * The value as plain JSON, for a host that logs, stores or posts a result.
	 *
	 * `JSON.stringify` of a Value used to throw "Do not know how to serialize a
	 * BigInt" as soon as the value carried an exact sidecar, which every decimal
	 * literal did and, since exact decimals and exact large integers, most
	 * computed answers do (#598). This writes the fields a host already reads
	 * (`type`, `value`, `unit`), then each sidecar that is set, with every
	 * bigint as its decimal string: `exact` as the decimal it stands for
	 * (`"0.3"`) and `rational` as `"n/d"`. The private cached number is left
	 * out. It is for reading, not a snapshot format; `engine.toJSON()` is the
	 * one that restores.
	 *
	 * @returns A JSON-safe object describing this value.
	 */
	toJSON(): Record<string, unknown> {
		const out: Record<string, unknown> = { type: this.type, value: jsonSafe(this.value) };
		if (this.unit !== undefined) out.unit = this.unit;
		if (this.exact !== undefined) out.exact = decimalToString(this.exact);
		if (this.rational !== undefined) out.rational = `${this.rational.n}/${this.rational.d}`;
		if (this.uncertainty !== undefined) out.uncertainty = this.uncertainty;
		if (this.decimalPlaces !== undefined) out.decimalPlaces = this.decimalPlaces;
		if (this.grain !== undefined) out.grain = this.grain;
		if (this.zone !== undefined) out.zone = this.zone;
		if (this.timeAnchor !== undefined) out.timeAnchor = this.timeAnchor;
		if (this.datetimeSpan !== undefined) out.datetimeSpan = this.datetimeSpan;
		if (this.timedOut !== undefined) out.timedOut = this.timedOut;
		if (this.sources !== undefined) out.sources = this.sources;
		if (this.frozen !== undefined) out.frozen = this.frozen;
		if (this.unspelledUnit !== undefined) out.unspelledUnit = this.unspelledUnit;
		return out;
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

	isColour(): this is Value & { value: ColourData } {
		return this.type === ValueType.Colour;
	}

	isChart(): this is Value & { value: ChartData } {
		return this.type === ValueType.Chart;
	}

	isIpCidr(): this is Value & { value: IpCidrData } {
		return this.type === ValueType.IpCidr;
	}

	isSymbolic(): this is Value & { value: SymbolicNode } {
		return this.type === ValueType.Symbolic;
	}

	/**
	 * An Error value: a fault carrying a code and message, propagated through the
	 * DAG when a plugin or opcode cannot produce a quantity.
	 *
	 * An Error reads as the number 0 through {@link toNumber}, so a numeric
	 * consumer that does not check this first cannot tell the fault apart from a
	 * real zero: exactly the silently-wrong result the engine guards against
	 * internally with {@link faultedOperand}. A host reading a live {@link Value}
	 * off a result should branch on this (or {@link isFault}) before trusting the
	 * number, and read {@link errorCode}/{@link errorMessage} for the detail.
	 */
	isError(): boolean {
		return this.type === ValueType.Error;
	}

	/**
	 * A Pending value: an async result that has not yet resolved, holding the
	 * query key it is waiting on. Reads as 0 through {@link toNumber}, the same
	 * caveat as {@link isError}: a settled value arrives on a later evaluation.
	 */
	isPending(): boolean {
		return this.type === ValueType.Pending;
	}

	/**
	 * Either fault, an Error or a Pending: the single predicate to check before
	 * trusting {@link toNumber}. It mirrors the internal {@link faultedOperand}
	 * rule that every opcode applies to its operands, so a host reading a result
	 * makes the same distinction the engine does rather than computing with a
	 * zero it cannot tell from a real one.
	 */
	isFault(): boolean {
		return this.type === ValueType.Error || this.type === ValueType.Pending;
	}

	/**
	 * The stable {@link ErrorFactory} code of an Error value, else `undefined`.
	 *
	 * The code is the machine-branchable identifier (the message is the
	 * human-facing text, {@link errorMessage}). It reads from the same slot
	 * {@link errorValue} writes, so it is defined for exactly the values
	 * {@link isError} accepts and `undefined` for every other type.
	 */
	get errorCode(): string | undefined {
		return this.type === ValueType.Error ? (this.value as string) : undefined;
	}

	/**
	 * The human-facing message of an Error value, else `undefined`. Paired with
	 * {@link errorCode}, which carries the branchable identifier.
	 */
	get errorMessage(): string | undefined {
		return this.type === ValueType.Error ? this.unit : undefined;
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
		// A colour is a struct of channels, not a scalar; like Matrix/Range it has
		// no single numeric reading. Callers branch on `.isColour()` first.
		if (this.type === ValueType.Colour) return 0;
		// A chart is a set of points, not a scalar; callers branch on `.isChart()`.
		if (this.type === ValueType.Chart) return 0;
		// An IP/CIDR reads as its 32-bit address where a number is wanted (`as int`).
		if (this.type === ValueType.IpCidr) return (this.value as IpCidrData).addr ?? 0;
		// A split is a structured multi-share result; its scalar reading is the
		// "each" (base) share, so a numeric consumer or the worker DTO's number
		// field still gets a sensible value where a caller does not branch first.
		if (this.type === ValueType.Split) return (this.value as SplitData).shares[0].value;
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
		if (this.type === ValueType.Colour) return false;
		if (this.type === ValueType.Split) return false;
		if (this.type === ValueType.Chart) return false;
		if (this.type === ValueType.IpCidr) return false;
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

/**
 * A Number that also carries the exact decimal it was written as.
 *
 * The type stays {@link ValueType.Number} and `value` stays the nearest double,
 * so this Value behaves exactly like any other number everywhere it is read as
 * one. The `exact` sidecar is what keeps later arithmetic exact: "$0.70 * 1.10"
 * against money, and "0.1 + 0.2" between plain numbers (see vm/ExactDecimals.ts).
 * Decimal-point literals are compiled to this (see the PUSH_DECIMAL opcode), and
 * so is an exact decimal result.
 */
export function numberValueExact(n: number, exact: DecimalData): Value {
	chargeAllocation(bigIntAllocationBytes(exact.coef), "decimal bytes");
	const v = numberValue(n);
	v.exact = exact;
	return v;
}

/**
 * A Number that also carries the exact rational it evaluates to.
 *
 * The rational counterpart of {@link numberValueExact}: the type stays
 * {@link ValueType.Number} and `value` stays the nearest double (recomputed
 * from the rational, so a chain of fraction operations never accumulates
 * float error), so this reads as an ordinary number everywhere. The `rational`
 * sidecar is what keeps the next fraction operation and any `as fraction`
 * exact. Integer division produces this (see the DIV opcode).
 */
export function numberValueRational(n: number, rational: Rational): Value {
	const v = numberValue(n);
	v.rational = rational;
	return v;
}

/**
 * A Number that also carries a one-sigma uncertainty (standard error).
 *
 * The uncertainty counterpart of {@link numberValueExact}: the type stays
 * {@link ValueType.Number} and `value` stays the center, so this reads as an
 * ordinary number everywhere. The `uncertainty` sidecar is what lets `+`, `-`,
 * `*`, `/` propagate the tolerance in quadrature. The `±` operator produces
 * this (see the MAKE_UNCERTAIN opcode), as does any of those four ops when an
 * operand already carries one. The magnitude is stored as given, callers pass a
 * non-negative value (`Math.abs` at the seam, quadrature results are already
 * non-negative).
 */
export function numberValueUncertain(n: number, uncertainty: number): Value {
	const v = numberValue(n);
	v.uncertainty = uncertainty;
	return v;
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

/**
 * A cheap, size-proportional proxy for the memory a bigint occupies, in bytes,
 * so arbitrary-precision growth can be charged against the allocation budget the
 * same way a matrix charges its cells.
 *
 * O(1) for any magnitude a double can size (the bit length is the exponent);
 * for larger values the hexadecimal length is linear in the size, where turning
 * it into decimal digits would not be. Mirrors `vm/VM.ts`'s `bigIntBitLength`,
 * kept here so the value constructors can charge without importing from the VM.
 */
function bigIntAllocationBytes(n: bigint): number {
	const magnitude = n < 0n ? -n : n;
	if (magnitude === 0n) return 1;
	const asDouble = Number(magnitude);
	const bits = Number.isFinite(asDouble)
		? Math.floor(Math.log2(asDouble)) + 1
		: magnitude.toString(16).length * 4;
	return Math.ceil(bits / 8);
}

/**
 * Create a BigInt-typed Value (arbitrary-precision integer).
 *
 * Charged on birth by its byte size, so a doubling chain like `b(n) = n * n`
 * nested deep trips the allocation budget (the running tally accumulates each
 * product) rather than building a multi-megabyte integer. The `^` and `<<`
 * operators refuse past their own bit ceiling before they reach here; multiply,
 * which has no such ceiling, is bounded by this charge.
 */
export function bigIntValue(n: bigint): Value {
	chargeAllocation(bigIntAllocationBytes(n), "bigint bytes");
	if (_arenaActive && _arena) return _arena.acquire(ValueType.BigInt, n);
	return new Value(ValueType.BigInt, n);
}

/**
 * Create a String-typed Value.
 *
 * Charged on birth by its length, the one place every string is born, so a
 * doubling chain like `d(s) = s + s` nested deep trips the allocation budget
 * rather than building a near-gigabyte string. The charge is a no-op outside an
 * evaluation (the formatter, snapshot restore and host callers), exactly like
 * {@link matrixValue}.
 */
export function stringValue(s: string): Value {
	chargeAllocation(s.length, "characters");
	if (_arenaActive && _arena) return _arena.acquire(ValueType.String, s);
	return new Value(ValueType.String, s);
}

/** Create a Unit-of-Measurement Value (typed number with unit annotation). */
export function uomValue(n: number, unit: string): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Uom, n, unit);
	return new Value(ValueType.Uom, n, unit);
}

/**
 * A unit-of-measurement Value that also carries an exact decimal magnitude.
 *
 * This is how money keeps its precision: `value` is the nearest double (so
 * `toNumber()` and every existing Uom path are unchanged), and `exact` is the
 * decimal the amount really is. Same-currency arithmetic reads `exact` to stay
 * exact, and the formatter reads it to round a half-cent the way a ledger does
 * rather than the way `toFixed` does on a double.
 */
export function uomValueExact(n: number, unit: string, exact: DecimalData): Value {
	chargeAllocation(bigIntAllocationBytes(exact.coef), "decimal bytes");
	const v = uomValue(n, unit);
	v.exact = exact;
	return v;
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

/**
 * Create a Colour value from canonical sRGB channels plus a display format.
 * Arena-backed like the other synchronous factories; the `ColourData` struct in
 * the `value` slot is immutable, so arena recycle is safe with no extra clearing
 * (matching {@link matrixValue}/{@link rangeValue}).
 */
export function colourValue(c: ColourData): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Colour, c);
	return new Value(ValueType.Colour, c);
}

/**
 * Create a Split value from its structured per-share payload. Arena-backed like
 * the other synchronous factories; the {@link SplitData} struct in the `value`
 * slot is immutable, so arena recycle is safe with no extra clearing (matching
 * {@link colourValue}/{@link rangeValue}).
 */
export function splitValue(data: SplitData): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Split, data);
	return new Value(ValueType.Split, data);
}

/** Create a Chart value from its specification. Arena-backed like the other
 * struct factories; the {@link ChartData} in the `value` slot is immutable, so
 * arena recycle is safe with no extra clearing. */
export function chartValue(data: ChartData): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.Chart, data);
	return new Value(ValueType.Chart, data);
}

/** Create an IPv4 address/subnet Value. Arena-backed; the {@link IpCidrData} is immutable. */
export function ipCidrValue(data: IpCidrData): Value {
	if (_arenaActive && _arena) return _arena.acquire(ValueType.IpCidr, data);
	return new Value(ValueType.IpCidr, data);
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

/**
 * Create a Datetime-typed Value (Unix timestamp in milliseconds).
 *
 * The two optional arguments are the sidecars described on {@link Value.grain}
 * and {@link Value.zone}. They are set only where the caller KNOWS the answer
 * (the opcode or the literal shape says so), never guessed from the number, so
 * an omitted grain means "not recorded" rather than "a calendar day".
 *
 * An instant past the calendar's range (see {@link DATE_RANGE_MS}), or not a
 * number at all, is refused here rather than carried on to show as `Invalid
 * Date` or throw where it is formatted: `99999999999 days ago` is a date no
 * calendar holds.
 *
 * @param n - The instant, in epoch milliseconds.
 * @param grain - What the instant anchors, when the caller knows.
 * @param zone - The zone reference the instant was named in, when the line named one.
 * @param timeAnchor - For a time of day, an instant on the day it is counted from. See {@link Value.timeAnchor}.
 * @returns The Datetime value, or a `DATE_OUT_OF_RANGE` error Value.
 */
export function datetimeValue(n: number, grain?: DatetimeGrain, zone?: string, timeAnchor?: number): Value {
	if (!(n >= -DATE_RANGE_MS && n <= DATE_RANGE_MS)) return dateOutOfRange();
	const v = _arenaActive && _arena ? _arena.acquire(ValueType.Datetime, n) : new Value(ValueType.Datetime, n);
	if (grain !== undefined) v.grain = grain;
	if (zone !== undefined) v.zone = zone;
	if (timeAnchor !== undefined) v.timeAnchor = timeAnchor;
	return v;
}

/**
 * How far either side of 1970 an instant can be, in milliseconds: 100,000,000
 * days, the range of a JavaScript `Date` and of `Temporal.Instant`, from 271821
 * BC to AD 275760.
 */
export const DATE_RANGE_MS = 8.64e15;

/** The refusal for a date past {@link DATE_RANGE_MS}. */
export function dateOutOfRange(): Value {
	return errorValue("DATE_OUT_OF_RANGE", "That date is past the range a calendar holds, which runs from 271821 BC to AD 275760.");
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
