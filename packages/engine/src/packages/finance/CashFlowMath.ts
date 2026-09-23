/**
 * The pure maths of a cash-flow appraisal: net present value, internal rate of
 * return and payback period over a series of flows, one per period, the first
 * of them today.
 *
 * Every flow arrives here as an exact decimal (see `CashFlowPluginFunctions.ts`
 * for how a Value becomes one), so the sums a person could check by hand come
 * out exactly: `-100, 110` at 10% is a net present value of 0, not the 1.4e-14
 * a double leaves behind, and a payback period is the ratio of two exact totals.
 *
 * The convention is that flow `t` arrives `t` periods from now, so the first is
 * today and is not discounted. A spreadsheet's `NPV()` discounts the first flow
 * as well (it treats every value as arriving at the end of a period); the two
 * answers differ by exactly one period's discount, and this module keeps the
 * reading a finance textbook uses.
 */
import {
	type DecimalData,
	DEFAULT_DIVISION_SCALE,
	decimalAdd,
	decimalDivide,
	decimalFromInteger,
	decimalMultiply,
	decimalNegate,
	decimalRound,
	decimalToNumber,
	makeDecimal,
} from "@solve-js/decimal";

const ZERO: DecimalData = decimalFromInteger(0);
const ONE: DecimalData = decimalFromInteger(1);

/**
 * How many significant digits the running discount factor keeps once it stops
 * being short. `(1 + r)^t` is exact while it fits; past this it is rounded, far
 * below anything a result displays, so a long series at an awkward rate costs a
 * bounded amount of work rather than a coefficient that grows with every period.
 */
const FACTOR_SIGNIFICANT_DIGITS = 60;

/**
 * The exact decimal a finite double prints as.
 *
 * `String(n)` is the shortest decimal that reads back as `n`, so it is the
 * number the person typed wherever they typed one (`0.1`, not the binary
 * fraction nearest it). Scientific notation is expanded (`1e-7`, `1.5e+21`), so
 * every finite double has an answer.
 *
 * @param n - A finite number.
 */
export function decimalOfNumber(n: number): DecimalData {
	const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(n));
	if (match === null) return ZERO;
	const fraction = match[3] ?? "";
	const exponent = match[4] === undefined ? 0 : Number(match[4]);
	const scale = fraction.length - exponent;
	// A positive exponent past the written digits appends zeros; a bigint `**`
	// is not used, since the build lowers it to Math.pow, which rejects bigints.
	const digits = match[2] + fraction + (scale < 0 ? "0".repeat(-scale) : "");
	const coef = BigInt(digits);
	return makeDecimal(match[1] === "-" ? -coef : coef, Math.max(0, scale));
}

/** Rounds a positive decimal to a number of significant digits, keeping a non-negative scale. */
function toSignificant(d: DecimalData, digits: number): DecimalData {
	const excess = d.coef.toString().length - digits;
	if (excess <= 0 || d.scale === 0) return d;
	return decimalRound(d, Math.max(0, d.scale - excess));
}

/**
 * The net present value of a series at a rate per period: what the whole
 * series is worth today, each flow divided by `(1 + rate)` once for every
 * period it waits. Flow 0 is today and is not discounted.
 *
 * Returns null when the answer is beyond the range a number can hold (a rate
 * close to -100% over a long series makes each later flow astronomically
 * larger), so the caller can say so rather than print Infinity.
 *
 * @param flows - The flows, one per period, the first today.
 * @param rate - The rate per period as a proportion (`0.1` for 10%). The
 * caller guarantees it is above -1, where `1 + rate` is positive.
 */
export function netPresentValue(flows: readonly DecimalData[], rate: DecimalData): DecimalData | null {
	if (flows.length === 0) return ZERO;
	const growth = decimalAdd(ONE, rate);
	const logGrowth = Math.log10(decimalToNumber(growth));
	let factor = ONE;
	let total = flows[0];
	for (let t = 1; t < flows.length; t++) {
		// log10 of this period's discount factor, (1 + rate)^t.
		const exponent = t * logGrowth;
		// Past 10^400 every later flow is divided below anything a double can
		// show, and the factor only grows from here, so the rest adds nothing.
		if (exponent > 400) break;
		factor = toSignificant(decimalMultiply(factor, growth), FACTOR_SIGNIFICANT_DIGITS);
		const flow = flows[t];
		if (flow.coef === 0n) continue;
		// A factor this small multiplies the flow past the largest double.
		if (Math.log10(Math.abs(decimalToNumber(flow))) - exponent > 308.25) return null;
		total = decimalAdd(total, decimalDivide(flow, factor, DEFAULT_DIVISION_SCALE));
	}
	return Number.isFinite(decimalToNumber(total)) ? total : null;
}

/** Why a series has no single internal rate of return, or the rate it has. */
export type IrrOutcome =
	| { readonly kind: "rate"; readonly rate: number }
	/** Every flow has the same sign, so no rate can bring the total to zero. */
	| { readonly kind: "noSignChange" }
	/** The flows change sign, but no rate above -100% makes the NPV zero. */
	| { readonly kind: "none" }
	/** More than one rate makes the NPV zero; all of them, ascending. */
	| { readonly kind: "several"; readonly rates: readonly number[] }
	/** Two rates lie too close together to be told apart in a double. */
	| { readonly kind: "unresolved" };

/**
 * The internal rate of return: the rate per period at which the series' net
 * present value is exactly zero, the break-even discount rate.
 *
 * Finding a root is easy; knowing it is the only one is the hard part, and a
 * series whose sign changes more than once can have two (the textbook
 * `-100, 230, -132` is zero at both 10% and 20%). A spreadsheet's `IRR()`
 * returns whichever one its guess happens to converge to. This does not guess.
 *
 * The NPV is a polynomial in `x = 1 / (1 + r)`, and every rate above -100% is
 * one positive `x`. Its roots are isolated exactly, on the flows' own integer
 * coefficients, with Descartes' rule of signs (the Vincent-Collins-Akritas
 * method): a stretch of `x` whose transformed coefficients change sign once
 * holds exactly one root, one with no change holds none, and anything else is
 * halved until it is one or the other. Each isolated root is then refined in
 * floating point inside its certified bracket. So the count of rates is exact,
 * and a single answer is only given when there is exactly one.
 *
 * @param flows - The flows, one per period, the first today.
 */
export function internalRateOfReturn(flows: readonly DecimalData[]): IrrOutcome {
	// Every flow on the widest scale, so the coefficients are integers. Raising
	// a scale only appends zeros, so the rounding never rounds anything.
	const scale = Math.max(...flows.map((f) => f.scale));
	let p = flows.map((f) => decimalRound(f, scale).coef);
	// A leading zero flow multiplies the polynomial by x (a root at r = infinity,
	// no rate at all) and a trailing one only lowers its degree: neither moves a
	// root, so both are dropped.
	let first = 0;
	while (first < p.length && p[first] === 0n) first++;
	let last = p.length - 1;
	while (last >= first && p[last] === 0n) last--;
	p = p.slice(first, last + 1);
	if (signChanges(p) === 0) return { kind: "noSignChange" };

	const rates: number[] = [];
	// A root at x = 1 is a rate of exactly zero: the flows sum to nothing. It is
	// divided out exactly (x - 1 is monic, so the quotient stays integral), so
	// no bracket below ever ends on a root.
	let atZero = false;
	while (p.length > 1 && sum(p) === 0n) {
		p = divideByXMinusOne(p);
		atZero = true;
	}
	if (atZero) rates.push(0);

	const budget = { nodes: 0 };
	// x in (0, 1) is a rate above zero, r = 1/x - 1.
	const aboveZero = isolateRoots(p, budget);
	// x in (1, infinity) is a rate between -100% and zero. Reversing the
	// coefficients maps it to u = 1/x in (0, 1), and then r = u - 1.
	const belowZero = isolateRoots(p.slice().reverse(), budget);
	if (aboveZero === null || belowZero === null) return { kind: "unresolved" };
	for (const x of aboveZero) rates.push(1 / x - 1);
	for (const u of belowZero) rates.push(u - 1);

	if (rates.length === 0) return { kind: "none" };
	if (rates.length === 1) return { kind: "rate", rate: rates[0] };
	return { kind: "several", rates: rates.sort((a, b) => a - b) };
}

/** Sign changes along a coefficient list, zeros skipped: Descartes' bound on its positive roots. */
function signChanges(p: readonly bigint[]): number {
	let changes = 0;
	let previous = 0n;
	for (const c of p) {
		if (c === 0n) continue;
		if (previous !== 0n && (c < 0n) !== (previous < 0n)) changes++;
		previous = c;
	}
	return changes;
}

/** The polynomial's value at 1. */
function sum(p: readonly bigint[]): bigint {
	let total = 0n;
	for (const c of p) total += c;
	return total;
}

/** Divides out the factor `x - 1`, which the caller has checked divides exactly. */
function divideByXMinusOne(p: readonly bigint[]): bigint[] {
	const q = new Array<bigint>(p.length - 1);
	let carry = 0n;
	for (let k = p.length - 1; k >= 1; k--) {
		carry += p[k];
		q[k - 1] = carry;
	}
	return q;
}

/** `p(y + 1)`, the Taylor shift by one, in exact integers. */
function shiftByOne(p: readonly bigint[]): bigint[] {
	const q = p.slice();
	const n = q.length - 1;
	for (let i = 0; i < n; i++) {
		for (let j = n - 1; j >= i; j--) q[j] += q[j + 1];
	}
	return q;
}

/**
 * The upper bound on the roots of `p` inside (0, 1): the sign changes of
 * `(1 + y)^n p(1 / (1 + y))`, which maps (0, 1) onto every positive `y`.
 */
function rootsBoundInUnitInterval(p: readonly bigint[]): number {
	return signChanges(shiftByOne(p.slice().reverse()));
}

/** Deeper than this, two roots are closer than a double can tell apart. */
const MAX_DEPTH = 50;
/** A ceiling on the whole search, so a pathological series answers rather than stalls. */
const MAX_NODES = 2000;

interface SearchNode {
	/** The polynomial in local coordinates: its (0, 1) is the node's stretch of x. */
	readonly p: bigint[];
	readonly lo: number;
	readonly width: number;
	readonly depth: number;
}

/**
 * Every root of `p` strictly inside (0, 1), or null when two cannot be
 * separated. The caller guarantees `p` is non-zero at both 0 and 1, and each
 * split keeps that true of the halves: a root found exactly at a midpoint is
 * recorded and divided out before either half is searched.
 */
function isolateRoots(p: bigint[], budget: { nodes: number }): number[] | null {
	const roots: number[] = [];
	const stack: SearchNode[] = [{ p, lo: 0, width: 1, depth: 0 }];
	while (stack.length > 0) {
		const node = stack.pop()!;
		if (++budget.nodes > MAX_NODES) return null;
		const bound = rootsBoundInUnitInterval(node.p);
		if (bound === 0) continue;
		if (bound === 1) {
			roots.push(node.lo + node.width * refineSingleRoot(node.p));
			continue;
		}
		if (node.depth >= MAX_DEPTH) return null;
		const n = node.p.length - 1;
		const half = node.width / 2;
		const mid = node.lo + half;
		// The left half, 2^n p(y / 2), whose (0, 1) is the node's (0, 1/2).
		let left = node.p.map((c, k) => c << BigInt(n - k));
		let midpointRoot = false;
		while (left.length > 1 && sum(left) === 0n) {
			left = divideByXMinusOne(left);
			midpointRoot = true;
		}
		if (midpointRoot) roots.push(mid);
		// The right half is the left one shifted by one: its (0, 1) is (1/2, 1).
		stack.push({ p: shiftByOne(left), lo: mid, width: half, depth: node.depth + 1 });
		stack.push({ p: left, lo: node.lo, width: half, depth: node.depth + 1 });
	}
	return roots;
}

/**
 * The one root of `p` inside (0, 1), in floating point, by Newton's method
 * held inside a bisection bracket so a bad step can never leave it.
 *
 * The bracket's end signs come from the exact coefficients (`p(0)` is the
 * constant term, `p(1)` their sum), so they are right even where a float
 * evaluation near a root would not be. The coefficients are scaled by a common
 * power of two before they become doubles, so a deep search's large integers
 * cannot overflow; the scaling does not move the root.
 */
function refineSingleRoot(p: readonly bigint[]): number {
	let bits = 0;
	for (const c of p) bits = Math.max(bits, (c < 0n ? -c : c).toString(2).length);
	const shift = BigInt(Math.max(0, bits - 960));
	const coefficients = p.map((c) => Number(c >> shift));
	const signAtZero = p[0] < 0n ? -1 : 1;

	let lo = 0;
	let hi = 1;
	let y = 0.5;
	for (let i = 0; i < 200; i++) {
		let value = 0;
		let slope = 0;
		for (let k = coefficients.length - 1; k >= 0; k--) {
			slope = slope * y + value;
			value = value * y + coefficients[k];
		}
		if (value === 0) return y;
		if (Math.sign(value) === signAtZero) lo = y;
		else hi = y;
		let next = y - value / slope;
		if (!(next > lo && next < hi)) next = (lo + hi) / 2;
		if (next === y || hi - lo <= Number.EPSILON * hi) return next;
		y = next;
	}
	return y;
}

/** How long a series takes to repay its outlay, or why it never does. */
export type PaybackOutcome =
	| { readonly kind: "period"; readonly periods: number }
	/** The running total is still below zero after the last flow; how far below. */
	| { readonly kind: "never"; readonly shortfall: DecimalData }
	/** The running total is never below zero, so there is nothing to pay back. */
	| { readonly kind: "noOutlay" };

/**
 * The payback period: how many periods pass before the running total of the
 * flows, undiscounted, climbs back to zero and stays there.
 *
 * The flow in the period that crosses zero is taken to arrive evenly through
 * it, so the answer is fractional: `-1000, 300, 400, 500` is 700 short after
 * one period, 300 short after two, and the third period's 500 covers the last
 * 300 three-fifths of the way through, which is 2.6. A series that dips below
 * zero again after first paying back (a later outlay) pays back the last time it
 * recovers, since the money is not back until it stays back.
 *
 * @param flows - The flows, one per period, the first today.
 */
export function paybackPeriod(flows: readonly DecimalData[]): PaybackOutcome {
	let running = ZERO;
	let lastShort = -1;
	let shortBy = ZERO;
	for (let t = 0; t < flows.length; t++) {
		running = decimalAdd(running, flows[t]);
		if (running.coef < 0n) {
			lastShort = t;
			shortBy = running;
		}
	}
	if (lastShort === -1) return { kind: "noOutlay" };
	if (lastShort === flows.length - 1) return { kind: "never", shortfall: decimalNegate(shortBy) };
	// The next flow lifts the total from below zero to at least zero, so it is
	// positive and at least the amount still owed: the fraction is in (0, 1].
	const fraction = decimalDivide(decimalNegate(shortBy), flows[lastShort + 1], DEFAULT_DIVISION_SCALE);
	return { kind: "period", periods: lastShort + decimalToNumber(fraction) };
}
