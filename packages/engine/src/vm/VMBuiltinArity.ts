import { ErrorFactory } from "@solve-js/errors/EngineError";
import type { EngineError } from "@solve-js/errors/EngineError";

/**
 * How many arguments each builtin actually takes.
 *
 * Every implementation in `VMBuiltins.ts` indexes `args` positionally and none
 * of them checks the length first, so `sqrt()` reached `args[0].toNumber()`
 * with an empty array and threw a raw `TypeError`. That TypeError was caught by
 * `normalizeUnknownError()` and re-labelled `UNEXPECTED_ERROR` in category
 * INTERNAL, which told the host that a user's typo was an engine bug, in V8's
 * words, and named no function at all.
 *
 * The check belongs here rather than in each of the ~90 implementations because
 * the `CALL_BUILTIN` dispatch is the one place that knows both the index and
 * the argument count, and because a table can be read and audited against the
 * implementations in one sitting.
 *
 * `max` is `Infinity` for the genuinely variadic builtins (`min`, `max`,
 * `hypot`, the aggregates, `jacobian`). Everything else is strict in both
 * directions: an extra argument was silently discarded before, so `sqrt(1,2,3)`
 * answered 1 and the reader never learned that two thirds of what they typed
 * was thrown away.
 *
 * The name is the canonical one for the index. Several indices are reachable
 * under more than one spelling (`arcsin` and `asin` are both index 11, `fact`
 * and `factorial` are both 62) and several are reachable only through a phrase
 * parselet rather than by name at all, so this is the name the message uses
 * rather than whatever the reader typed, which the VM does not receive.
 */
interface BuiltinArity {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

/** One entry per index in `builtinFunctions`. Kept in the same order as that table. */
const BUILTIN_ARITY: Record<number, BuiltinArity> = {
  0:  { name: "sqrt",     min: 1, max: 1 },
  1:  { name: "abs",      min: 1, max: 1 },
  2:  { name: "sin",      min: 1, max: 1 },
  3:  { name: "cos",      min: 1, max: 1 },
  4:  { name: "tan",      min: 1, max: 1 },
  5:  { name: "log",      min: 1, max: 1 },
  6:  { name: "ceil",     min: 1, max: 1 },
  7:  { name: "floor",    min: 1, max: 1 },
  8:  { name: "round",    min: 1, max: 2 },
  // min/max compare as many operands as they are given.
  9:  { name: "min",      min: 1, max: Infinity },
  10: { name: "max",      min: 1, max: Infinity },
  11: { name: "asin",     min: 1, max: 1 },
  12: { name: "acos",     min: 1, max: 1 },
  13: { name: "atan",     min: 1, max: 1 },
  14: { name: "atan2",    min: 2, max: 2 },
  15: { name: "sinh",     min: 1, max: 1 },
  16: { name: "cosh",     min: 1, max: 1 },
  17: { name: "tanh",     min: 1, max: 1 },
  18: { name: "asinh",    min: 1, max: 1 },
  19: { name: "acosh",    min: 1, max: 1 },
  20: { name: "atanh",    min: 1, max: 1 },
  21: { name: "cbrt",     min: 1, max: 1 },
  22: { name: "clz32",    min: 1, max: 1 },
  23: { name: "expm1",    min: 1, max: 1 },
  24: { name: "exp",      min: 1, max: 1 },
  25: { name: "fround",   min: 1, max: 1 },
  // hypot is the length of a vector with as many components as it is given.
  26: { name: "hypot",    min: 1, max: Infinity },
  27: { name: "imul",     min: 2, max: 2 },
  28: { name: "log10",    min: 1, max: 1 },
  29: { name: "log1p",    min: 1, max: 1 },
  30: { name: "log2",     min: 1, max: 1 },
  31: { name: "pow",      min: 2, max: 2 },
  32: { name: "random",   min: 0, max: 0 },
  33: { name: "sign",     min: 1, max: 1 },
  34: { name: "trunc",    min: 1, max: 1 },
  35: { name: "degtorad", min: 1, max: 1 },
  36: { name: "radtodeg", min: 1, max: 1 },
  37: { name: "roll",     min: 2, max: 2 },
  38: { name: "gcd",      min: 2, max: 2 },
  39: { name: "lcm",      min: 2, max: 2 },
  40: { name: "permutation", min: 2, max: 2 },
  41: { name: "combination", min: 2, max: 2 },
  // The aggregates back "average of X, Y, Z" and friends, so they take a
  // list. Their implementations already answer for an empty list rather
  // than indexing into it, and the phrase parselets can emit an empty one,
  // so the minimum stays 0 here instead of being tightened on the way past.
  42: { name: "average",  min: 0, max: Infinity },
  43: { name: "median",   min: 0, max: Infinity },
  44: { name: "total",    min: 0, max: Infinity },
  45: { name: "count",    min: 0, max: Infinity },
  46: { name: "proportion", min: 3, max: 3 },
  47: { name: "clamp",    min: 3, max: 3 },
  48: { name: "hex",      min: 1, max: 1 },
  49: { name: "bin",      min: 1, max: 1 },
  50: { name: "int",      min: 1, max: 1 },
  51: { name: "compoundInterest",     min: 3, max: 3 },
  52: { name: "interestEarned",       min: 3, max: 3 },
  53: { name: "compoundInterestRate", min: 3, max: 3 },
  54: { name: "compoundInterestYears", min: 3, max: 3 },
  55: { name: "loanRepayment",        min: 4, max: 4 },
  56: { name: "loanInterest",         min: 4, max: 4 },
  57: { name: "monthlyPayment",       min: 3, max: 3 },
  58: { name: "taxAdd",     min: 2, max: 2 },
  59: { name: "taxRemove",  min: 2, max: 2 },
  60: { name: "inflationAdjust", min: 3, max: 3 },
  61: { name: "root",       min: 2, max: 2 },
  62: { name: "fact",       min: 1, max: 1 },
  63: { name: "transpose",  min: 1, max: 1 },
  64: { name: "det",        min: 1, max: 1 },
  65: { name: "inv",        min: 1, max: 1 },
  66: { name: "dot",        min: 2, max: 2 },
  67: { name: "expand",     min: 1, max: 1 },
  68: { name: "factor",     min: 1, max: 1 },
  // solve pushes the two sides of the equation and then the unknown's name.
  69: { name: "solve",      min: 3, max: 3 },
  // der's order of differentiation is optional and defaults to 1.
  70: { name: "der",        min: 2, max: 3 },
  71: { name: "integral",   min: 2, max: 2 },
  72: { name: "taylor",     min: 4, max: 4 },
  // jacobian differentiates however many functions it is handed.
  73: { name: "jacobian",   min: 1, max: Infinity },
  74: { name: "imaginary",  min: 1, max: 1 },
  75: { name: "conj",       min: 1, max: 1 },
  76: { name: "re",         min: 1, max: 1 },
  77: { name: "im",         min: 1, max: 1 },
  78: { name: "cancel",     min: 1, max: 1 },
  79: { name: "apart",      min: 1, max: 1 },
  80: { name: "compoundInterestEvery",        min: 4, max: 4 },
  81: { name: "compoundInterestEarnedEvery",  min: 4, max: 4 },
  82: { name: "presentValue",      min: 3, max: 3 },
  83: { name: "roi",               min: 2, max: 2 },
  84: { name: "annualisedReturn",  min: 3, max: 3 },
  85: { name: "taxIn",   min: 2, max: 2 },
  86: { name: "taxOn",   min: 2, max: 2 },
  87: { name: "sind",    min: 1, max: 1 },
  88: { name: "cosd",    min: 1, max: 1 },
  89: { name: "tand",    min: 1, max: 1 },
  90: { name: "asind",   min: 1, max: 1 },
  91: { name: "acosd",   min: 1, max: 1 },
  92: { name: "atand",   min: 1, max: 1 },
  93: { name: "daysCount",  min: 1, max: 1 },
  94: { name: "asTwoUnits", min: 3, max: 3 },
  95: { name: "makeRate",   min: 2, max: 2 },
  96: { name: "atRate",     min: 2, max: 2 },
  // Not reachable by name, only through `<value> to <n> dp`; see
  // converters/parselets/RoundingParselets.ts.
  97: { name: "roundToPlaces", min: 2, max: 2 },
  98: { name: "splitEach", min: 2, max: 2 },
};

/** "1 argument" / "2 arguments", so the message reads as English either way. */
function plural(count: number): string {
  return count === 1 ? "1 argument" : `${count} arguments`;
}

/** How the expected count reads: exact, "at least", or a range. */
function expectation(arity: BuiltinArity): string {
  if (arity.max === Infinity) return `at least ${plural(arity.min)}`;
  if (arity.min === arity.max) return plural(arity.min);
  return `${arity.min} to ${plural(arity.max)}`;
}

/**
 * Checks a builtin call's argument count before the implementation runs.
 *
 * @param index - The builtin index, the first operand of `OpCode.CALL_BUILTIN`.
 * @param argCount - The number of arguments the bytecode says were pushed.
 * @returns An `EngineError` to throw when the count is wrong, or `undefined`
 * when the call is well formed. Returned rather than thrown so the caller keeps
 * the throw at its own site, where the VM's own containment can see it.
 *
 * An index with no entry passes, which keeps a package that registers its own
 * builtin index working rather than making this table a gate on extensibility.
 */
export function builtinArityError(index: number, argCount: number): EngineError | undefined {
  const arity = BUILTIN_ARITY[index];
  if (arity === undefined) return undefined;
  if (argCount >= arity.min && argCount <= arity.max) return undefined;

  return ErrorFactory.execution(
    "BUILTIN_ARITY_MISMATCH",
    `${arity.name}() takes ${expectation(arity)}, but was given ${argCount === 0 ? "none" : plural(argCount)}`,
    { functionName: arity.name, expectedMin: arity.min, expectedMax: arity.max, actual: argCount },
  );
}
