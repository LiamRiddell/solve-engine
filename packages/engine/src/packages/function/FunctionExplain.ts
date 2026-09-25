import type { ExplainCall, ExplainContext, ExplanationStep } from "@solve-js/explain/Explanation";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { builtinNameToIndex } from "./parselets/FunctionCallParselet";

/** A list read aloud: `3`, `3 and 4`, `3, 4 and 5`. */
function spoken(items: readonly string[]): string {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `2nd`, `3rd`, `4th`, `21st`, for `root(n, x)`. */
function ordinal(n: string): string {
	const tens = n.length > 1 ? n[n.length - 2] : "";
	const last = n[n.length - 1];
	if (tens !== "1" && last === "1") return `${n}st`;
	if (tens !== "1" && last === "2") return `${n}nd`;
	if (tens !== "1" && last === "3") return `${n}rd`;
	return `${n}th`;
}

type Describer = (args: readonly string[], raw: readonly Value[]) => string;

/**
 * The wording for each function, from its arguments as the engine displays
 * them. A function not listed here is described by its call as written
 * (`gcd(12, 18)`), which is still a step: it names the call and its answer.
 */
const WORDING: Record<string, Describer> = {
	sqrt: ([x]) => `the square root of ${x}`,
	cbrt: ([x]) => `the cube root of ${x}`,
	root: ([n, x]) => `the ${ordinal(n)} root of ${x}`,
	abs: ([x]) => `the absolute value of ${x}`,
	round: ([x, places], raw) =>
		places === undefined
			? `${x} rounded to the nearest whole number`
			: `${x} rounded to ${places} decimal place${raw[1]?.toNumber() === 1 ? "" : "s"}`,
	floor: ([x]) => `${x} rounded down`,
	ceil: ([x]) => `${x} rounded up`,
	trunc: ([x]) => `${x} with its fraction dropped`,
	int: ([x]) => `${x} with its fraction dropped`,
	min: (xs) => `the smallest of ${spoken(xs)}`,
	max: (xs) => `the largest of ${spoken(xs)}`,
	pow: ([x, y]) => `${x} to the power of ${y}`,
	exp: ([x]) => `e to the power of ${x}`,
	log: ([x, base]) => (base === undefined ? `the natural logarithm of ${x}` : `the base-${base} logarithm of ${x}`),
	ln: ([x]) => `the natural logarithm of ${x}`,
	log10: ([x]) => `the base-10 logarithm of ${x}`,
	log2: ([x]) => `the base-2 logarithm of ${x}`,
	sin: ([x]) => `the sine of ${x}`,
	cos: ([x]) => `the cosine of ${x}`,
	tan: ([x]) => `the tangent of ${x}`,
	sind: ([x]) => `the sine of ${x} degrees`,
	cosd: ([x]) => `the cosine of ${x} degrees`,
	tand: ([x]) => `the tangent of ${x} degrees`,
	asin: ([x]) => `the angle whose sine is ${x}`,
	acos: ([x]) => `the angle whose cosine is ${x}`,
	atan: ([x]) => `the angle whose tangent is ${x}`,
	hypot: (xs) => `the hypotenuse of sides ${spoken(xs)}`,
	fact: ([n]) => `${n} factorial`,
	gcd: ([a, b]) => `the greatest common divisor of ${a} and ${b}`,
	lcm: ([a, b]) => `the least common multiple of ${a} and ${b}`,
};

/**
 * The kinds of value a one-sentence description reads well for. A matrix or a
 * symbolic formula has no inline form a sentence can carry, and those areas are
 * outside what the derivation covers, so a call on one is left undescribed.
 */
const SCALAR: ReadonlySet<ValueType> = new Set([ValueType.Number, ValueType.Hex, ValueType.BigInt, ValueType.Percentage, ValueType.Uom]);

/** The builtins a reader can call by name, `sqrt(...)`, and so the ones this package describes. */
const CALLABLE = new Set(Object.keys(builtinNameToIndex));

/**
 * Describe a named function call (`sqrt(16)`, `round(3.14159, 2)`) as one
 * step: what the function does to its arguments, arriving at the call's own
 * result.
 *
 * Only builtins a reader can write as `name(...)`, on plain numbers and
 * quantities, are described here. A builtin reached through a phrase (a
 * finance form, an average) belongs to the package that owns the phrase,
 * which describes it in its own terms; this hook declines it.
 *
 * @param call - The call to describe; only `"builtin"` calls are.
 * @param context - The formatting the engine hands every hook.
 * @returns One step, or `undefined` for a call this package does not own.
 */
export function explainFunctionCall(call: ExplainCall, context: ExplainContext): readonly ExplanationStep[] | undefined {
	if (call.kind !== "builtin") return undefined;
	const name = call.name.toLowerCase();
	if (!CALLABLE.has(name)) return undefined;
	if (!SCALAR.has(call.result.type) || call.args.some((arg) => !SCALAR.has(arg.type))) return undefined;
	const args = call.args.map((arg) => context.format(arg));
	const wording = WORDING[name];
	const description = wording !== undefined ? wording(args, call.args) : `${call.name}(${args.join(", ")})`;
	return [{ description, value: call.result }];
}
