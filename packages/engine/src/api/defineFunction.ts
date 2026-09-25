import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import {
  Value,
  ValueType,
  numberValue,
  stringValue,
  boolValue,
} from "@solve-js/vm/Value";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import type { CompletionItem } from "@solve-js/language/LanguageService";

/**
 * A higher-level, declarative way to contribute a single `name(args)`
 * function, sitting ON TOP OF the package contract rather than replacing it.
 *
 * The low-level contract (allocate a plugin function index, write a parselet,
 * emit `CALL_PLUGIN`) stays exactly as it was and remains the way to add
 * anything that needs custom parsing. This module derives that same wiring
 * from a declaration for the common case, a function called with parenthesised
 * arguments, so adding `vat(x)` costs a spec object rather than an
 * understanding of the parser and the VM. See `defineFunction`.
 */

/** The value types a declared argument or return may take. */
export type FunctionValueType = "number" | "string" | "boolean";

/** The JavaScript type a {@link FunctionValueType} maps to at the `call` boundary. */
type JsValue<T extends FunctionValueType> = T extends "number"
  ? number
  : T extends "string"
    ? string
    : boolean;

/** One declared parameter: a name (for error messages) and a value type. */
export interface FunctionArg {
  /** Parameter name, used only in the generated type-mismatch messages. */
  name: string;
  /** The value type this parameter accepts. */
  type: FunctionValueType;
}

/** Map a tuple of {@link FunctionArg} specs to the tuple of JS values `call` receives. */
type CallArgs<A extends readonly FunctionArg[]> = {
  [K in keyof A]: JsValue<A[K]["type"]>;
};

/**
 * A declarative function definition.
 *
 * `A` and `R` are inferred from the literal `args`/`returns` (via
 * `defineFunction`'s `const` type parameter), so `call`'s parameters and
 * return are typed from the declaration with no annotations: an
 * `{ type: "number" }` argument arrives as a `number`, and a `returns:
 * "string"` demands a `string` back.
 */
export interface FunctionSpec<
  A extends readonly FunctionArg[] = readonly FunctionArg[],
  R extends FunctionValueType = FunctionValueType,
> {
  /**
   * The call name, a single identifier (`/^[a-z_][a-z0-9_]*$/i`). It becomes
   * the call only where `(` follows it, matched case-insensitively, and stays
   * an ordinary word everywhere else, so `:price = 5` and a `price:` label
   * keep working beside `price(10)`. A name the engine already reads as
   * something else (a keyword, a built-in function, a unit) could never become
   * the call, so registering it throws `PLUGIN_CALL_FUSION_UNREACHABLE`.
   */
  name: string;
  /** The parameters, in order. A fixed-length list: variadic and optional args are out of scope (see {@link defineFunction}). */
  args: A;
  /** The value type the function returns. */
  returns: R;
  /** The implementation, receiving plain JS values and returning one. Must be synchronous (see {@link defineFunction}). */
  call: (...args: CallArgs<A>) => JsValue<R>;
}

/**
 * Error codes the declarative function API raises. Kept as a co-located const
 * (the convention `errors/ErrorCode.ts` documents for a domain's own codes) so
 * the strings have one source of truth.
 */
export const DefineFunctionErrorCodes = {
  /** The spec's `name` is not a single identifier. Thrown by `defineFunction`, before any engine sees it. */
  DEFINE_FUNCTION_INVALID_NAME: "DEFINE_FUNCTION_INVALID_NAME",
  /** The spec is otherwise malformed (bad `args`, unsupported type, missing `call`). Thrown by `defineFunction`. */
  DEFINE_FUNCTION_INVALID_SPEC: "DEFINE_FUNCTION_INVALID_SPEC",
  /** The call site passed the wrong number of arguments. Raised at evaluation time. */
  DEFINE_FUNCTION_ARITY_MISMATCH: "DEFINE_FUNCTION_ARITY_MISMATCH",
  /** An argument was the wrong value type. Raised at evaluation time. */
  DEFINE_FUNCTION_ARGUMENT_TYPE: "DEFINE_FUNCTION_ARGUMENT_TYPE",
  /** The `call` implementation returned a value that did not match `returns`. Raised at evaluation time, an authoring bug rather than a user one. */
  DEFINE_FUNCTION_RETURN_TYPE: "DEFINE_FUNCTION_RETURN_TYPE",
} as const;

/**
 * The prefix a declared function's plugin-function name carries. Plugin-function
 * names are engine-wide and the built-in packages use plain words (the tags
 * package's `sum`), so a function called `sum` would have taken over `total of
 * #a` (#659). The prefix is internal: an explain hook sees the declared name
 * (see {@link declaredFunctionName}).
 */
export const DEFINED_FUNCTION_PREFIX = "define:";

/**
 * The name a package author declared, from a plugin-function name: a declared
 * function's without its {@link DEFINED_FUNCTION_PREFIX}, any other unchanged.
 *
 * @param pluginName - The name the function is registered under.
 */
export function declaredFunctionName(pluginName: string): string {
  return pluginName.startsWith(DEFINED_FUNCTION_PREFIX) ? pluginName.slice(DEFINED_FUNCTION_PREFIX.length) : pluginName;
}

/** A single identifier: a letter or underscore, then letters, digits, or underscores. */
const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i;

const SUPPORTED_TYPES: ReadonlySet<string> = new Set(["number", "string", "boolean"]);

/** "1 argument" / "2 arguments", so a count reads as English either way. Mirrors `VMBuiltinArity.ts`. */
function plural(count: number): string {
  return count === 1 ? "1 argument" : `${count} arguments`;
}

/**
 * A human noun for the type a Value actually carries, for the "was given ..."
 * half of a mismatch message. Covers the three declarable types by their own
 * names and everything else by a readable category, so the message never reads
 * "given a 6".
 */
function describeValueType(v: Value): string {
  switch (v.type) {
    case ValueType.Number:
    case ValueType.Hex:
      return "a number";
    case ValueType.String:
      return "a string";
    case ValueType.Boolean:
      return "a boolean";
    case ValueType.BigInt:
      return "a big integer";
    case ValueType.Percentage:
      return "a percentage";
    case ValueType.Uom:
      return "a value with a unit";
    case ValueType.Datetime:
      return "a date";
    case ValueType.Matrix:
      return "a matrix";
    case ValueType.Range:
      return "a range";
    case ValueType.Symbolic:
      return "a symbolic expression";
    default:
      return "an unsupported value";
  }
}

/**
 * Read one runtime Value as the JS primitive its declared type promises, or
 * raise the engine's structured type error.
 *
 * A "number" accepts a plain number or a based literal (`0xFF`), both of which
 * ARE numbers written differently, and reads it with `toNumber()`. Nothing
 * else is coerced: a percentage, a unit-bearing value or a string is a
 * genuinely different kind of value, and silently reinterpreting it is the
 * class of wrong-answer this API exists to avoid.
 */
function coerceArgument(
  value: Value,
  arg: FunctionArg,
  fnName: string,
): number | string | boolean {
  switch (arg.type) {
    case "number":
      // Hex is a number in another base (see `hexValue`), so it reads as one here.
      if (value.type === ValueType.Number || value.type === ValueType.Hex) {
        return value.toNumber();
      }
      break;
    case "string":
      if (value.type === ValueType.String) return value.value as string;
      break;
    case "boolean":
      if (value.type === ValueType.Boolean) return value.value as boolean;
      break;
  }
  throw ErrorFactory.execution({
    code: DefineFunctionErrorCodes.DEFINE_FUNCTION_ARGUMENT_TYPE,
    message: `${fnName}() expects "${arg.name}" to be a ${arg.type}, but was given ${describeValueType(value)}`,
    expected: `a ${arg.type}`,
    found: describeValueType(value),
    context: { functionName: fnName, argName: arg.name, expectedType: arg.type },
  });
}

/**
 * Wrap the `call` result back into a Value of the declared return type, or
 * raise a structured error if the implementation handed back something else.
 *
 * The type check here catches an authoring mistake (a function declared to
 * return a number that returns `undefined`, or a Promise from an accidental
 * `async`), turning it into a named error rather than a Value that lies about
 * its own type downstream.
 */
function wrapReturn(result: unknown, returns: FunctionValueType, fnName: string): Value {
  switch (returns) {
    case "number":
      if (typeof result === "number") return numberValue(result);
      break;
    case "string":
      if (typeof result === "string") return stringValue(result);
      break;
    case "boolean":
      if (typeof result === "boolean") return boolValue(result);
      break;
  }
  throw ErrorFactory.internal({
    code: DefineFunctionErrorCodes.DEFINE_FUNCTION_RETURN_TYPE,
    message: `${fnName}() is declared to return a ${returns}, but its implementation returned ${typeof result}`,
    expected: `a ${returns}`,
    found: typeof result,
    context: { functionName: fnName, expectedType: returns },
  });
}

/**
 * The call-syntax parselet generated for one declared function.
 *
 * Identical in shape to the built-in `FunctionCallParselet`: consume the open
 * paren, parse a comma-separated argument list, then emit `CALL_PLUGIN` with
 * the function's index and the argument count. The count is whatever was
 * written, arity is checked at the dispatch point (see {@link makeHandler}),
 * the same place the built-in arity check lives.
 */
class DefinedFunctionParselet implements PrefixParselet {
  readonly category = "Function";

  constructor(
    private readonly pluginName: string,
  ) {}

  parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
    parser.consume("LPAREN");

    let argCount = 0;
    if (parser.peek()?.type !== "RPAREN") {
      parser.parseExpression(BindingPower.Lowest, builder);
      argCount++;
      while (parser.match("COMMA")) {
        parser.parseExpression(BindingPower.Lowest, builder);
        argCount++;
      }
    }

    parser.consume("RPAREN");

    builder.emitPluginCall(this.pluginName, argCount);
  }
}

/**
 * Build the plugin function that checks arity and argument types, calls the
 * host implementation, and wraps the result.
 *
 * The VM has already screened out faulted arguments (an errored or still
 * pending operand short-circuits before the handler runs, see
 * `VM.ts`'s `CALL_PLUGIN` case), so every Value reaching here carries a real
 * result. Arity is checked first, before any argument is read, so a wrong
 * count is reported as a wrong count rather than as a type error on a missing
 * argument.
 */
function makeHandler(spec: FunctionSpec): (args: Value[]) => Value {
  const arity = spec.args.length;
  return (args: Value[]): Value => {
    if (args.length !== arity) {
      throw ErrorFactory.execution({
        code: DefineFunctionErrorCodes.DEFINE_FUNCTION_ARITY_MISMATCH,
        message: `${spec.name}() takes ${plural(arity)}, but was given ${args.length === 0 ? "none" : plural(args.length)}`,
        expected: plural(arity),
        found: args.length === 0 ? "none" : plural(args.length),
        context: { functionName: spec.name, expected: arity, actual: args.length },
      });
    }

    const jsArgs: (number | string | boolean)[] = new Array(arity);
    for (let i = 0; i < arity; i++) {
      jsArgs[i] = coerceArgument(args[i], spec.args[i], spec.name);
    }

    const result = (spec.call as (...a: (number | string | boolean)[]) => unknown)(...jsArgs);
    return wrapReturn(result, spec.returns, spec.name);
  };
}

/** The completion entry for a declared function: its name, and the signature as the detail. */
function completionItem(spec: FunctionSpec): CompletionItem {
  const params = spec.args.map((arg) => `${arg.name}: ${arg.type}`).join(", ");
  return { label: spec.name, category: "function", detail: `${spec.name}(${params}): ${spec.returns}` };
}

/** Reject a spec that could not produce a working function, before any engine sees it. */
function validateSpec(spec: FunctionSpec): void {
  if (typeof spec?.name !== "string" || !NAME_PATTERN.test(spec.name)) {
    throw ErrorFactory.config({
      code: DefineFunctionErrorCodes.DEFINE_FUNCTION_INVALID_NAME,
      message: `defineFunction: name must be a single identifier, got ${JSON.stringify(spec?.name)}`,
      suggestion: 'e.g. "vat" or "net_price"',
      context: { name: spec?.name },
    });
  }
  if (!Array.isArray(spec.args)) {
    throw ErrorFactory.config({
      code: DefineFunctionErrorCodes.DEFINE_FUNCTION_INVALID_SPEC,
      message: `defineFunction: "${spec.name}" args must be an array`,
      context: { name: spec.name },
    });
  }
  for (const arg of spec.args) {
    if (typeof arg?.name !== "string" || arg.name.length === 0) {
      throw ErrorFactory.config({
        code: DefineFunctionErrorCodes.DEFINE_FUNCTION_INVALID_SPEC,
        message: `defineFunction: "${spec.name}" has an argument with no name`,
        context: { name: spec.name },
      });
    }
    if (!SUPPORTED_TYPES.has(arg.type)) {
      throw ErrorFactory.config({
        code: DefineFunctionErrorCodes.DEFINE_FUNCTION_INVALID_SPEC,
        message: `defineFunction: "${spec.name}" argument "${arg.name}" has unsupported type ${JSON.stringify(arg.type)}`,
        suggestion: "supported argument types are number, string, boolean",
        context: { name: spec.name, argName: arg.name, type: arg.type },
      });
    }
  }
  if (!SUPPORTED_TYPES.has(spec.returns)) {
    throw ErrorFactory.config({
      code: DefineFunctionErrorCodes.DEFINE_FUNCTION_INVALID_SPEC,
      message: `defineFunction: "${spec.name}" has unsupported return type ${JSON.stringify(spec.returns)}`,
      suggestion: "supported return types are number, string, boolean",
      context: { name: spec.name, returns: spec.returns },
    });
  }
  if (typeof spec.call !== "function") {
    throw ErrorFactory.config({
      code: DefineFunctionErrorCodes.DEFINE_FUNCTION_INVALID_SPEC,
      message: `defineFunction: "${spec.name}" is missing a call implementation`,
      context: { name: spec.name },
    });
  }
}

/**
 * Turn a declarative {@link FunctionSpec} into a ready-to-register
 * {@link IEnginePackage}.
 *
 * This is the higher-level API from issue #102. It derives, from the
 * declaration alone, everything the low-level contract asks an author to write
 * by hand: a named plugin function (the engine assigns its `CALL_PLUGIN`
 * index), a call word that becomes the call only where `(` follows it (the
 * built-in `sha256(` shape, through `callFusions`), a call-syntax parselet
 * emitting that call by name, a `function` highlight and a completion entry
 * carrying the signature, and a handler that checks arity and argument types (yielding
 * the engine's own structured errors) before invoking `call` and wrapping its
 * result. Anything needing custom parsing keeps writing a raw parselet exactly
 * as before, this sits on top of that contract and does not change it.
 *
 * @example
 * ```ts
 * const engine = new ExpressionEngine({ packages: [
 *   ...BUILTIN_PACKAGES,
 *   defineFunction({
 *     name: "vat",
 *     args: [{ name: "amount", type: "number" }],
 *     returns: "number",
 *     call: (amount) => amount * 1.2,
 *   }),
 * ] });
 * engine.evaluateExpression("vat(100)"); // 120
 * ```
 *
 * The returned package is self-contained and composes with any others through
 * the engine's `packages` array; register several functions by passing several
 * packages. Its name is `solve-fn-<name>`.
 *
 * Scope: arguments are a fixed-length list of `number`/`string`/`boolean`, and
 * `call` is synchronous. Variadic and optional arguments, other value types
 * (units, percentages, dates, matrices), and async work are deliberately out
 * of scope, a function needing any of those keeps using the low-level
 * contract, whose parselets and async resolvers are unchanged.
 *
 * @throws {EngineError} (category CONFIG) if the spec is malformed, at the
 * point `defineFunction` is called, before the package reaches an engine.
 */
export function defineFunction<
  const A extends readonly FunctionArg[],
  R extends FunctionValueType,
>(spec: FunctionSpec<A, R>): IEnginePackage {
  validateSpec(spec as FunctionSpec);

  const name = spec.name;
  // Uppercased so the generated type is a valid, collision-resistant token
  // type; the name pattern guarantees it forms one. Distinct from the
  // built-in FUNC type, so this never routes through the builtin name map.
  const tokenType = `DEFINE_FN_${name.toUpperCase()}`;
  // Prefixed so it cannot be a built-in's plugin-function name; see
  // DEFINED_FUNCTION_PREFIX.
  const pluginName = `${DEFINED_FUNCTION_PREFIX}${name}`;

  return {
    name: `solve-fn-${name}`,
    // A call word, not a keyword (#659). A keyword claimed the name on every
    // line, so `:price = 5`, `price * 2` and a `price:` label stopped parsing
    // once `price` was defined. A fusion fires only where `(` follows and never
    // after `:`, the way the built-in `sha256(` works. Lower-cased because the
    // engine matches call words case-insensitively.
    callFusions: { [name.toLowerCase()]: tokenType },
    tokenCategories: { [tokenType]: "function" },
    completionItems: [completionItem(spec as FunctionSpec)],
    prefixParselets: {
      [tokenType]: new DefinedFunctionParselet(pluginName),
    },
    pluginFunctions: {
      [pluginName]: makeHandler(spec as FunctionSpec),
    },
  };
}
