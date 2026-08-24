/**
 * `defineFunction`, the higher-level API from issue #102.
 *
 * The low-level package contract (allocate an index, write a parselet, emit
 * `CALL_PLUGIN`) is the floor, and it stays. This suite proves the declarative
 * form sitting on top of it: a spec compiles to a working `name(args)` call,
 * wrong arity and wrong argument types surface the engine's own structured
 * errors, a malformed spec is refused at definition time, and a hand-written
 * low-level package still works unchanged alongside a generated one.
 */

import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages";
import { defineFunction, DefineFunctionErrorCodes } from "@solve-js/api/defineFunction";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { EngineError, ErrorCategory } from "@solve-js/errors/UnifiedErrorFramework";
import { PrefixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { allocatePluginFunctionIndex } from "@solve-js/vm/VMBuiltins";
import { numberValue, type Value } from "@solve-js/vm/Value";

/** A fresh engine carrying the built-ins plus whatever packages a test adds. */
function engineWith(...packages: IEnginePackage[]): ExpressionEngine {
  return new ExpressionEngine({ packages: [
    ...BUILTIN_PACKAGES,
    ...packages,
  ] });
}

/** The first result Value of an expression. */
function evaluate(engine: ExpressionEngine, expression: string): Value {
  return engine.evaluateExpression(expression);
}

/** Evaluate expecting a throw, and return the structured error it threw. */
function evaluateError(engine: ExpressionEngine, expression: string): EngineError {
  try {
    engine.evaluateExpression(expression);
  } catch (e) {
    return e as EngineError;
  }
  throw new Error(`expected "${expression}" to throw, but it did not`);
}

describe("defineFunction: the declared function evaluates", () => {
  test("the headline example, vat(amount)", () => {
    const engine = engineWith(
      defineFunction({
        name: "vat",
        args: [{ name: "amount", type: "number" }],
        returns: "number",
        call: (amount) => amount * 1.2,
      }),
    );

    expect(evaluate(engine, "vat(100)").toNumber()).toBeCloseTo(120, 10);
  });

  test("the result composes into a larger expression", () => {
    const engine = engineWith(
      defineFunction({
        name: "double",
        args: [{ name: "x", type: "number" }],
        returns: "number",
        call: (x) => x * 2,
      }),
    );

    // The call is an ordinary operand: it multiplies, nests, and reads args
    // that are themselves expressions.
    expect(evaluate(engine, "double(5) + 1").toNumber()).toBe(11);
    expect(evaluate(engine, "double(double(3))").toNumber()).toBe(12);
    expect(evaluate(engine, "double(2 + 3)").toNumber()).toBe(10);
  });

  test("several arguments, in order", () => {
    const engine = engineWith(
      defineFunction({
        name: "mix",
        args: [
          { name: "a", type: "number" },
          { name: "b", type: "number" },
          { name: "c", type: "number" },
        ],
        returns: "number",
        call: (a, b, c) => a * 100 + b * 10 + c,
      }),
    );

    expect(evaluate(engine, "mix(1, 2, 3)").toNumber()).toBe(123);
  });

  test("a zero-argument function", () => {
    const engine = engineWith(
      defineFunction({
        name: "answer",
        args: [],
        returns: "number",
        call: () => 42,
      }),
    );

    expect(evaluate(engine, "answer()").toNumber()).toBe(42);
  });

  test("string arguments and a string return", () => {
    const engine = engineWith(
      defineFunction({
        name: "greet",
        args: [{ name: "who", type: "string" }],
        returns: "string",
        call: (who) => `hello ${who}`,
      }),
    );

    expect(evaluate(engine, 'greet("world")').value).toBe("hello world");
  });

  test("a boolean return", () => {
    const engine = engineWith(
      defineFunction({
        name: "ispositive",
        args: [{ name: "x", type: "number" }],
        returns: "boolean",
        call: (x) => x > 0,
      }),
    );

    expect(evaluate(engine, "ispositive(5)").value).toBe(true);
    expect(evaluate(engine, "ispositive(-5)").value).toBe(false);
  });

  test("a based literal reads as a number argument", () => {
    const engine = engineWith(
      defineFunction({
        name: "numid",
        args: [{ name: "x", type: "number" }],
        returns: "number",
        call: (x) => x,
      }),
    );

    // 0xFF is 255 written in another base, so it is a number here.
    expect(evaluate(engine, "numid(0xFF)").toNumber()).toBe(255);
  });

  test("the call name is matched case-insensitively", () => {
    const engine = engineWith(
      defineFunction({
        name: "vat",
        args: [{ name: "amount", type: "number" }],
        returns: "number",
        call: (amount) => amount * 1.2,
      }),
    );

    // The lexer lowercases before keyword lookup, so casing at the call site
    // does not matter.
    expect(evaluate(engine, "VAT(100)").toNumber()).toBeCloseTo(120, 10);
  });
});

describe("defineFunction: wrong arity yields the engine's structured error", () => {
  function engine(): ExpressionEngine {
    return engineWith(
      defineFunction({
        name: "vat",
        args: [{ name: "amount", type: "number" }],
        returns: "number",
        call: (amount) => amount * 1.2,
      }),
    );
  }

  test("too few arguments", () => {
    const error = evaluateError(engine(), "vat()");
    expect(error).toBeInstanceOf(EngineError);
    expect(error.code).toBe(DefineFunctionErrorCodes.DEFINE_FUNCTION_ARITY_MISMATCH);
    expect(error.category).toBe(ErrorCategory.EXECUTION);
    expect(error.message).toContain("vat() takes 1 argument, but was given none");
  });

  test("too many arguments", () => {
    const error = evaluateError(engine(), "vat(1, 2)");
    expect(error.code).toBe(DefineFunctionErrorCodes.DEFINE_FUNCTION_ARITY_MISMATCH);
    expect(error.message).toContain("takes 1 argument, but was given 2 arguments");
  });
});

describe("defineFunction: wrong argument type yields the engine's structured error", () => {
  function engine(): ExpressionEngine {
    return engineWith(
      defineFunction({
        name: "greet",
        args: [{ name: "who", type: "string" }],
        returns: "string",
        call: (who) => `hello ${who}`,
      }),
    );
  }

  test("a number where a string is declared", () => {
    const error = evaluateError(engine(), "greet(5)");
    expect(error).toBeInstanceOf(EngineError);
    expect(error.code).toBe(DefineFunctionErrorCodes.DEFINE_FUNCTION_ARGUMENT_TYPE);
    expect(error.category).toBe(ErrorCategory.EXECUTION);
    expect(error.message).toContain('greet() expects "who" to be a string, but was given a number');
    expect(error.expected).toBe("a string");
    expect(error.found).toBe("a number");
  });

  test("a unit-bearing value is not silently read as a number", () => {
    const numberEngine = engineWith(
      defineFunction({
        name: "half",
        args: [{ name: "x", type: "number" }],
        returns: "number",
        call: (x) => x / 2,
      }),
    );

    // "5 km" is a value with a unit, a genuinely different kind of value, so
    // it is refused rather than reinterpreted as the bare number 5.
    const error = evaluateError(numberEngine, "half(5 km)");
    expect(error.code).toBe(DefineFunctionErrorCodes.DEFINE_FUNCTION_ARGUMENT_TYPE);
    expect(error.message).toContain("to be a number");
  });
});

describe("defineFunction: a return that does not match its declaration", () => {
  test("an implementation returning the wrong type is a named error", () => {
    const engine = engineWith(
      defineFunction({
        name: "liar",
        args: [],
        returns: "number",
        // Deliberately returns a string despite declaring a number return.
        call: (() => "not a number") as unknown as () => number,
      }),
    );

    const error = evaluateError(engine, "liar()");
    expect(error.code).toBe(DefineFunctionErrorCodes.DEFINE_FUNCTION_RETURN_TYPE);
    expect(error.category).toBe(ErrorCategory.INTERNAL);
    expect(error.message).toContain("is declared to return a number");
  });
});

describe("defineFunction: a malformed spec is refused at definition time", () => {
  test("a name that is not an identifier throws before any engine sees it", () => {
    let thrown: EngineError | undefined;
    try {
      defineFunction({
        name: "2bad",
        args: [],
        returns: "number",
        call: () => 1,
      });
    } catch (e) {
      thrown = e as EngineError;
    }
    expect(thrown).toBeInstanceOf(EngineError);
    expect(thrown?.code).toBe(DefineFunctionErrorCodes.DEFINE_FUNCTION_INVALID_NAME);
    expect(thrown?.category).toBe(ErrorCategory.CONFIG);
  });

  test("an unsupported argument type throws", () => {
    expect(() =>
      defineFunction({
        name: "bad",
        // A type outside the supported set, cast past the compile-time guard
        // to prove the runtime validation.
        args: [{ name: "x", type: "date" as unknown as "number" }],
        returns: "number",
        call: (x) => x,
      }),
    ).toThrow(/unsupported type/);
  });

  test("an unsupported return type throws", () => {
    expect(() =>
      defineFunction({
        name: "bad",
        args: [],
        returns: "date" as unknown as "number",
        call: () => 1,
      }),
    ).toThrow(/unsupported return type/);
  });
});

describe("the low-level contract still works unchanged", () => {
  test("a built-in low-level function is unaffected", () => {
    const engine = engineWith();
    expect(evaluate(engine, "sqrt(16)").toNumber()).toBe(4);
  });

  test("a hand-written CALL_PLUGIN package coexists with a generated one", () => {
    // A package written the old way: allocate an index, write a parselet that
    // emits CALL_PLUGIN by hand, register the plugin function. This is exactly
    // what defineFunction generates, kept here in longhand to prove the floor
    // is untouched.
    const rawIndex = allocatePluginFunctionIndex();

    class RawTripleParselet implements PrefixParselet {
      readonly category = "Test";
      parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
        parser.consume("LPAREN");
        parser.parseExpression(0, builder);
        parser.consume("RPAREN");
        builder.emitOpcode(OpCode.CALL_PLUGIN);
        builder.emitIndex(rawIndex);
        builder.emitIndex(1);
      }
    }

    const rawPackage: IEnginePackage = {
      name: "test-raw-lowlevel",
      lexerVocabulary: { keywords: { rawtriple: "RAW_TRIPLE_FN" } },
      prefixParselets: [{ tokenType: "RAW_TRIPLE_FN", parselet: new RawTripleParselet() }],
      pluginFunctions: [
        { index: rawIndex, handler: (args: Value[]) => numberValue(args[0].toNumber() * 3) },
      ],
    };

    const generated = defineFunction({
      name: "quadruple",
      args: [{ name: "x", type: "number" }],
      returns: "number",
      call: (x) => x * 4,
    });

    const engine = engineWith(rawPackage, generated);

    // Both dispatch through CALL_PLUGIN, side by side, in one expression.
    expect(evaluate(engine, "rawtriple(2)").toNumber()).toBe(6);
    expect(evaluate(engine, "quadruple(2)").toNumber()).toBe(8);
    expect(evaluate(engine, "rawtriple(2) + quadruple(2)").toNumber()).toBe(14);
  });
});
