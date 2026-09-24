/**
 * A symbolic tree turned into an ordinary function of one real number.
 *
 * The numeric methods (the root search in `NumericSolve.ts`, the quadrature in
 * `Quadrature.ts`, the limits in `Limit.ts`) all need to ask what an expression
 * is worth at thousands of points. Walking the tree and converting each exact
 * rational constant to a double on every visit would spend most of that time on
 * bigint division, so the tree is compiled once into nested closures with every
 * constant already a double, and the closures are what gets called.
 *
 * A point where the expression has no real value comes back as `NaN`: the square
 * root of a negative, the logarithm of zero's left, an inverse sine past one.
 * That is a statement about the point, not a failure of the compilation, and the
 * callers each decide what a gap in the domain means for them.
 *
 * Compilation itself fails, with a reason, for a tree the numeric methods cannot
 * evaluate at all: one that still names a second unknown, one carrying an
 * imaginary constant, or one calling a function with no numeric form here. Those
 * are refusals the caller passes on, never something to approximate around.
 *
 * Each function below evaluates the way the engine's own builtin of the same name
 * does (see `vm/VMBuiltins.ts`), so a root found here is a root of the expression
 * the reader typed, not of a lookalike.
 */

import type { SymbolicNode } from "@solve-js/symbolic/SymbolicNode";
import { rationalToNumber } from "@solve-js/symbolic/Rational";

/** A real function of one real variable, `NaN` wherever it has no real value. */
export type RealFunction = (x: number) => number;

/** The result of compiling a tree: the function, or the reason there is none. */
export type CompiledFunction =
	| { readonly ok: true; readonly fn: RealFunction }
	| { readonly ok: false; readonly reason: string };

/**
 * How deep a tree may nest before compilation declines it.
 *
 * The compiled closures call each other as deep as the tree is, so a pathological
 * nesting would overflow the native stack while being evaluated rather than while
 * being built. Far past anything written by hand.
 */
const MAX_COMPILE_DEPTH = 400;

/**
 * `base ^ exponent` the way the engine's `^` computes it.
 *
 * `Math.pow(1, Infinity)` is `NaN` in JavaScript and `1` everywhere else; the VM's
 * own `power()` in `vm/VMConversion.ts` follows the C99 rule, and this matches it
 * so the two cannot disagree at the edge.
 */
function power(base: number, exponent: number): number {
	if (Number.isFinite(exponent)) return Math.pow(base, exponent);
	if (base === 1) return 1;
	if (base === -1 && !Number.isNaN(exponent)) return 1;
	return Math.pow(base, exponent);
}

/** `n!` for a whole number up to 170, `NaN` for anything else, matching the `fact` builtin's domain. */
function factorial(n: number): number {
	if (!Number.isInteger(n) || n < 0 || n > 170) return Number.NaN;
	let total = 1;
	for (let i = 2; i <= n; i++) total *= i;
	return total;
}

/**
 * A one-argument function's numeric form, keyed by the name a `call` node
 * records. A Map rather than an object, since the name comes from the
 * expression: an object lookup of `constructor` would find the prototype.
 */
const UNARY: ReadonlyMap<string, (v: number) => number> = new Map(Object.entries({
	sqrt: Math.sqrt,
	abs: Math.abs,
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	log: Math.log,
	ceil: Math.ceil,
	floor: Math.floor,
	round: Math.round,
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan,
	sinh: Math.sinh,
	cosh: Math.cosh,
	tanh: Math.tanh,
	asinh: Math.asinh,
	acosh: Math.acosh,
	atanh: Math.atanh,
	cbrt: Math.cbrt,
	expm1: Math.expm1,
	exp: Math.exp,
	log10: Math.log10,
	log1p: Math.log1p,
	log2: Math.log2,
	sign: Math.sign,
	trunc: Math.trunc,
	degtorad: v => (v * Math.PI) / 180,
	radtodeg: v => (v * 180) / Math.PI,
	fact: factorial,
}));

/**
 * Compiles a tree into a function of `variable`.
 *
 * @param node - The expression.
 * @param variable - The one name it may depend on. Any other free name is a
 * refusal, since there is no number to put there.
 * @returns The function, or the reason it could not be built.
 */
export function compileRealFunction(node: SymbolicNode, variable: string): CompiledFunction {
	try {
		return { ok: true, fn: compile(node, variable, 0) };
	} catch (e) {
		if (e instanceof CompileRefusal) return { ok: false, reason: e.message };
		throw e;
	}
}

/**
 * The value of a tree with no unknown in it, or `null` when it has none.
 *
 * Used to read an exact result that the simplifier left symbolic (`sin(1)`, a
 * surd) as the number it stands for.
 *
 * @param node - A tree with no free variable.
 * @returns Its value, which may be `NaN` or infinite, or `null` when the tree
 * cannot be evaluated here at all.
 */
export function evaluateConstant(node: SymbolicNode): number | null {
	const compiled = compileRealFunction(node, "");
	return compiled.ok ? compiled.fn(0) : null;
}

/**
 * A number as a numeric method's message should show it: at most ten
 * significant figures, no trailing zeros, and no exponent for anything a
 * reader would write out in full.
 *
 * @param n - The number.
 * @returns Its text, `1000000` rather than `1e6` and `0.3333333333` rather than
 * seventeen digits of it.
 */
export function describeNumber(n: number): string {
	if (!Number.isFinite(n)) return n > 0 ? "∞" : n < 0 ? "-∞" : "NaN";
	// Number's own text already avoids an exponent between 1e-6 and 1e21.
	return String(Number(n.toPrecision(10)) + 0);
}

/** Thrown inside {@link compile} and caught at its entry point, so a refusal deep in the tree unwinds in one step. */
class CompileRefusal extends Error {}

/** Why a tree carrying `i` cannot be evaluated here. */
const IMAGINARY_REFUSAL = "it involves an imaginary number, and the numeric methods work on the real line";

/** Why a tree naming a second unknown cannot be evaluated here. */
function otherUnknownRefusal(name: string): string {
	return `it still contains the unknown "${name}", which has no value to evaluate with`;
}

/** Recursive worker for {@link compileRealFunction}. */
function compile(node: SymbolicNode, variable: string, depth: number): RealFunction {
	if (depth > MAX_COMPILE_DEPTH) throw new CompileRefusal("the expression is nested too deeply to evaluate numerically");
	const next = depth + 1;
	switch (node.kind) {
		case "const": {
			const value = rationalToNumber(node.value);
			return () => value;
		}
		case "complex":
			throw new CompileRefusal(IMAGINARY_REFUSAL);
		case "var":
			if (node.name !== variable) throw new CompileRefusal(otherUnknownRefusal(node.name));
			return x => x;
		case "neg": {
			const operand = compile(node.operand, variable, next);
			return x => -operand(x);
		}
		case "add": {
			const left = compile(node.left, variable, next);
			const right = compile(node.right, variable, next);
			return x => left(x) + right(x);
		}
		case "sub": {
			const left = compile(node.left, variable, next);
			const right = compile(node.right, variable, next);
			return x => left(x) - right(x);
		}
		case "mul": {
			const left = compile(node.left, variable, next);
			const right = compile(node.right, variable, next);
			return x => left(x) * right(x);
		}
		case "div": {
			const left = compile(node.left, variable, next);
			const right = compile(node.right, variable, next);
			return x => left(x) / right(x);
		}
		case "pow": {
			const base = compile(node.base, variable, next);
			const exponent = compile(node.exponent, variable, next);
			return x => power(base(x), exponent(x));
		}
		case "call":
			return compileCall(node.name, node.args.map(arg => compile(arg, variable, next)));
	}
}

/** A function application, by the name the `call` node records. */
function compileCall(name: string, args: readonly RealFunction[]): RealFunction {
	const unary = UNARY.get(name);
	if (unary !== undefined && args.length === 1) {
		const [arg] = args;
		return x => unary(arg(x));
	}
	switch (name) {
		case "round":
			// round(x, n): n decimal places, the builtin's two-argument form.
			if (args.length === 2) {
				const [value, places] = args;
				return x => {
					const scale = Math.pow(10, Math.trunc(places(x)));
					return Math.round(value(x) * scale) / scale;
				};
			}
			break;
		case "atan2":
			if (args.length === 2) {
				const [y, xArg] = args;
				return x => Math.atan2(y(x), xArg(x));
			}
			break;
		case "hypot":
			return x => Math.hypot(...args.map(arg => arg(x)));
		case "root":
			// root(n, x) is the n-th root of x, the builtin's own argument order.
			if (args.length === 2) {
				const [degree, radicand] = args;
				return x => power(radicand(x), 1 / degree(x));
			}
			break;
	}
	throw new CompileRefusal(`"${name}" has no numeric form here`);
}

/** A computed value and a bound on how far rounding may have moved it. */
export interface BoundedValue {
	readonly value: number;
	readonly error: number;
}

/** A function returning its value together with that value's rounding-error bound. */
export type BoundedFunction = (x: number) => BoundedValue;

/** The result of compiling a tree with error bounds. */
export type CompiledBoundedFunction =
	| { readonly ok: true; readonly fn: BoundedFunction }
	| { readonly ok: false; readonly reason: string };

/** Machine epsilon, the spacing of doubles just above one. */
const EPSILON = Number.EPSILON;

/**
 * The size of a one-argument function's slope at `u`, used to carry an error in
 * the argument through to the result. `fu` is the function's value there, which
 * several slopes are cheapest to read from.
 */
const UNARY_SLOPE: ReadonlyMap<string, (u: number, fu: number) => number> = new Map(Object.entries({
	sqrt: (_u, fu) => 0.5 / fu,
	abs: () => 1,
	sin: u => Math.cos(u),
	cos: u => Math.sin(u),
	tan: (_u, fu) => 1 + fu * fu,
	log: u => 1 / u,
	ceil: () => 0,
	floor: () => 0,
	round: () => 0,
	trunc: () => 0,
	sign: () => 0,
	fact: () => 0,
	asin: u => 1 / Math.sqrt(1 - u * u),
	acos: u => 1 / Math.sqrt(1 - u * u),
	atan: u => 1 / (1 + u * u),
	sinh: u => Math.cosh(u),
	cosh: u => Math.sinh(u),
	tanh: (_u, fu) => 1 - fu * fu,
	asinh: u => 1 / Math.sqrt(u * u + 1),
	acosh: u => 1 / Math.sqrt(u * u - 1),
	atanh: u => 1 / (1 - u * u),
	cbrt: (_u, fu) => 1 / (3 * fu * fu),
	expm1: u => Math.exp(u),
	exp: (_u, fu) => fu,
	log10: u => 1 / (u * Math.LN10),
	log1p: u => 1 / (1 + u),
	log2: u => 1 / (u * Math.LN2),
	degtorad: () => Math.PI / 180,
	radtodeg: () => 180 / Math.PI,
}));

/** `|slope| * error`, reading a zero error as contributing nothing even where the slope is infinite. */
function carried(slope: number, error: number): number {
	return error === 0 ? 0 : Math.abs(slope) * error;
}

/**
 * Compiles a tree into a function that also bounds its own rounding error.
 *
 * Every operation adds the rounding it commits itself (about one unit in the last
 * place of its result) to the error it inherits from its operands, scaled by how
 * sharply it responds to them. The bound is first-order, so it is an estimate
 * rather than a proof, but it is the right size, and that is what it is for:
 * telling a value that is mostly signal from one that is mostly noise.
 *
 * The case it exists for is cancellation. `(1-cos(x))/x^2` near zero tends to one
 * half, but once `x` is below about `1e-8` the double nearest `cos(x)` is exactly
 * one, the numerator is exactly zero, and the quotient is a confident, perfectly
 * steady, wrong zero. Its bound at that point is larger than the value it would
 * need to be, which is how a limit knows to look elsewhere.
 *
 * @param node - The expression.
 * @param variable - The one name it may depend on, whose value is taken as exact.
 * @returns The function, or the reason it could not be built, exactly as
 * {@link compileRealFunction} would give it.
 */
export function compileBoundedFunction(node: SymbolicNode, variable: string): CompiledBoundedFunction {
	try {
		return { ok: true, fn: compileBounded(node, variable, 0) };
	} catch (e) {
		if (e instanceof CompileRefusal) return { ok: false, reason: e.message };
		throw e;
	}
}

/** Recursive worker for {@link compileBoundedFunction}. */
function compileBounded(node: SymbolicNode, variable: string, depth: number): BoundedFunction {
	if (depth > MAX_COMPILE_DEPTH) throw new CompileRefusal("the expression is nested too deeply to evaluate numerically");
	const next = depth + 1;
	switch (node.kind) {
		case "const": {
			const value = rationalToNumber(node.value);
			// A whole number within the safe range is held exactly; anything else
			// was rounded once on its way to a double.
			const bounded = { value, error: Number.isSafeInteger(value) ? 0 : EPSILON * Math.abs(value) };
			return () => bounded;
		}
		case "complex":
			throw new CompileRefusal(IMAGINARY_REFUSAL);
		case "var":
			if (node.name !== variable) throw new CompileRefusal(otherUnknownRefusal(node.name));
			return x => ({ value: x, error: 0 });
		case "neg": {
			const operand = compileBounded(node.operand, variable, next);
			return x => {
				const o = operand(x);
				return { value: -o.value, error: o.error };
			};
		}
		case "add":
		case "sub": {
			const left = compileBounded(node.left, variable, next);
			const right = compileBounded(node.right, variable, next);
			const sign = node.kind === "add" ? 1 : -1;
			return x => {
				const l = left(x);
				const r = right(x);
				const value = l.value + sign * r.value;
				return { value, error: l.error + r.error + EPSILON * Math.abs(value) };
			};
		}
		case "mul": {
			const left = compileBounded(node.left, variable, next);
			const right = compileBounded(node.right, variable, next);
			return x => {
				const l = left(x);
				const r = right(x);
				const value = l.value * r.value;
				return {
					value,
					error: carried(l.value, r.error) + carried(r.value, l.error) + l.error * r.error + EPSILON * Math.abs(value),
				};
			};
		}
		case "div": {
			const left = compileBounded(node.left, variable, next);
			const right = compileBounded(node.right, variable, next);
			return x => {
				const l = left(x);
				const r = right(x);
				const value = l.value / r.value;
				const room = Math.abs(r.value) - r.error;
				// A divisor that rounding could have made zero leaves the quotient unbounded.
				const error = room <= 0 ? Number.POSITIVE_INFINITY : (l.error + carried(value, r.error)) / room + EPSILON * Math.abs(value);
				return { value, error };
			};
		}
		case "pow": {
			const base = compileBounded(node.base, variable, next);
			const exponent = compileBounded(node.exponent, variable, next);
			return x => {
				const b = base(x);
				const e = exponent(x);
				const value = power(b.value, e.value);
				const fromBase = b.error === 0 ? 0 : carried(e.value * power(b.value, e.value - 1), b.error);
				const fromExponent = e.error === 0 ? 0 : carried(value * Math.log(Math.abs(b.value)), e.error);
				return { value, error: fromBase + fromExponent + 2 * EPSILON * Math.abs(value) };
			};
		}
		case "call":
			return compileBoundedCall(node.name, node.args.map(arg => compileBounded(arg, variable, next)));
	}
}

/** A function application with error bounds, by the name the `call` node records. */
function compileBoundedCall(name: string, args: readonly BoundedFunction[]): BoundedFunction {
	const unary = UNARY.get(name);
	const slope = UNARY_SLOPE.get(name);
	if (unary !== undefined && slope !== undefined && args.length === 1) {
		const [arg] = args;
		return x => {
			const u = arg(x);
			const value = unary(u.value);
			// The standard functions are accurate to about one unit in the last place.
			return { value, error: carried(slope(u.value, value), u.error) + 2 * EPSILON * Math.abs(value) };
		};
	}
	switch (name) {
		case "round":
			if (args.length === 2) {
				const [value, places] = args;
				return x => {
					const scale = Math.pow(10, Math.trunc(places(x).value));
					return { value: Math.round(value(x).value * scale) / scale, error: 0 };
				};
			}
			break;
		case "atan2":
			if (args.length === 2) {
				const [yArg, xArg] = args;
				return x => {
					const y = yArg(x);
					const xv = xArg(x);
					const value = Math.atan2(y.value, xv.value);
					const radius = y.value * y.value + xv.value * xv.value;
					const error = radius === 0 ? Number.POSITIVE_INFINITY : (carried(xv.value, y.error) + carried(y.value, xv.error)) / radius;
					return { value, error: error + 2 * EPSILON * Math.abs(value) };
				};
			}
			break;
		case "hypot":
			return x => {
				const parts = args.map(arg => arg(x));
				const value = Math.hypot(...parts.map(p => p.value));
				// No argument can move a Euclidean length by more than its own error.
				return { value, error: parts.reduce((sum, p) => sum + p.error, 0) + 2 * EPSILON * Math.abs(value) };
			};
		case "root":
			if (args.length === 2) {
				const [degree, radicand] = args;
				return x => {
					const n = degree(x);
					const r = radicand(x);
					const value = power(r.value, 1 / n.value);
					const fromRadicand = r.error === 0 ? 0 : carried((1 / n.value) * power(r.value, 1 / n.value - 1), r.error);
					const fromDegree = n.error === 0 ? 0 : carried((value * Math.log(Math.abs(r.value))) / (n.value * n.value), n.error);
					return { value, error: fromRadicand + fromDegree + 2 * EPSILON * Math.abs(value) };
				};
			}
			break;
	}
	throw new CompileRefusal(`"${name}" has no numeric form here`);
}

/**
 * Whether a tree is continuous at every real value of `variable`, read from its
 * shape alone.
 *
 * A sufficient test, not a complete one: it says yes only for sums, products and
 * whole powers of pieces that have no gap, pole or jump anywhere (the variable,
 * constants, `sin`, `cos`, `exp`, `atan`, `abs` and their kin), and a constant
 * base raised to a continuous power. Anything that divides by the variable, takes
 * a logarithm or a square root of it, or rounds it, answers no, even where it
 * happens to be continuous over the range in question. A definite integral uses
 * this to decide when the antiderivative can be trusted without a numeric
 * cross-check, so a false no only costs a little time and a false yes would cost
 * a wrong answer.
 *
 * @param node - The expression, in any number of unknowns: continuity read
 * from the shape holds in each of them at once.
 * @returns True only when continuity everywhere is certain.
 */
export function isContinuousEverywhere(node: SymbolicNode): boolean {
	switch (node.kind) {
		case "const":
		case "var":
			return true;
		case "complex":
			return false;
		case "neg":
			return isContinuousEverywhere(node.operand);
		case "add":
		case "sub":
		case "mul":
			return isContinuousEverywhere(node.left) && isContinuousEverywhere(node.right);
		case "div": {
			// Dividing by a non-zero constant is scaling, which cannot open a pole.
			const divisor = node.right.kind === "const" ? rationalToNumber(node.right.value) : Number.NaN;
			return divisor !== 0 && Number.isFinite(divisor) && isContinuousEverywhere(node.left);
		}
		case "pow": {
			const exponent = node.exponent;
			if (exponent.kind === "const" && exponent.value.d === 1n && exponent.value.n >= 0n) {
				return isContinuousEverywhere(node.base);
			}
			const base = node.base;
			if (base.kind === "const" && base.value.n > 0n) return isContinuousEverywhere(exponent);
			return false;
		}
		case "call":
			return CONTINUOUS_FUNCTIONS.has(node.name) && node.args.every(arg => isContinuousEverywhere(arg));
	}
}

/** Functions with no gap, pole or jump anywhere on the real line. */
const CONTINUOUS_FUNCTIONS: ReadonlySet<string> = new Set([
	"sin", "cos", "exp", "sinh", "cosh", "tanh", "atan", "asinh", "abs", "cbrt", "expm1", "hypot",
]);
