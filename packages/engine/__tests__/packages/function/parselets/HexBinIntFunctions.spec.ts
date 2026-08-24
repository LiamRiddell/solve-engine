/**
 * `hex()` / `bin()` / `int()` call-syntax builtins.
 *
 * These used to return a String, matching Python, where `hex(255)` is the
 * text "0xff". The convention was deliberate and has been reversed, because
 * the analogy broke at the one point that mattered: Python raises a TypeError
 * on `hex(255) + 1`, and this engine evaluated it to 1, since a String reads as
 * zero in arithmetic. A silently wrong number is worse than either a string or
 * an error.
 *
 * They now return a ValueType.Hex, which is what `<expr> as hex` has always
 * returned: a real number that happens to display in another base. So
 * `hex(255) + 1` is 256, and the two spellings of "show me this in hex" agree
 * with each other instead of producing different types.
 *
 * "hex"/"bin" are reused locale keywords: they previously lexed ONLY as
 * CONVERTER_NAME (for "as hex"/"as bin"); this change moves them to FUNC
 * (for call syntax) and widens AsConverterParselet's token-type check so
 * "as hex"/"as bin" keep working unchanged — see that parselet's class
 * doc for the full reasoning. The `ConvertersParselets.spec.ts` file
 * covers "as hex"/"as bin" directly; the last describe block here is a
 * focused regression guard specifically for that widening.
 */

import { registerPackageForTesting } from "@tools/testUtils";
import { ARITHMETIC_PACKAGE, CONVERTERS_PACKAGE, FUNCTION_PACKAGE, PERCENTAGE_PACKAGE } from "@solve-js/packages";
import { describe, expect, test } from "@jest/globals";
import { Lexer } from "@solve-js/lexer/Lexer";
import { TokenTypes } from "@solve-js/lexer/Token";
import { Parser } from "@solve-js/parser/Parser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";

import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { Value, ValueType, numberValue } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { builtinFunctions } from "@solve-js/vm/VMBuiltins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

function tokenize(lexer: Lexer, input: string) {
  lexer.reset(input);
  const tokens = [];
  for (const t of lexer) {
    if (t.type === TokenTypes.WS || t.type === "NEWLINE") continue;
    tokens.push(t);
  }
  return tokens;
}

function parseAndExecute(input: string): Value {
  const lexer = new Lexer();
  const tokens = tokenize(lexer, input);
  const registry = new ParseletRegistry();
  registerPackageForTesting(ARITHMETIC_PACKAGE, registry);
  registerPackageForTesting(FUNCTION_PACKAGE, registry);
  registerPackageForTesting(CONVERTERS_PACKAGE, registry);
  registerPackageForTesting(PERCENTAGE_PACKAGE, registry);
  const parser = new Parser(registry);
  const builder = new BytecodeBuilder();
  parser.load(tokens);
  parser.parseExpression(0, builder);
  const program = builder.build();
  const vmUint8 = new Uint8Array(program.opcodes);
  const vmFloat64 = new Float64Array(program.numbers);
  const vm = createVM(sharedOpRegistry);
  const result = executeBytecode(
    { opcodes: vmUint8, numbers: vmFloat64, strings: program.strings },
    vm
  );
  return unwrapEvalResult(result);
}

describe("builtinFunctions[48/49/50] — direct unit coverage of hex()/bin()/int()", () => {
  const hex = builtinFunctions[48];
  const bin = builtinFunctions[49];
  const int = builtinFunctions[50];

  test("hex(255) is 255, displayed as 0xFF", () => {
    const result = hex([numberValue(255)]);
    expect(result.type).toBe(ValueType.Hex);
    expect(result.value).toBe(255);
    expect(formatValue(result)).toBe("= 0xFF");
  });

  test("hex(0) -> 0x0", () => {
    expect(formatValue(hex([numberValue(0)]))).toBe("= 0x0");
  });

  test("hex(-255) keeps the sign outside the literal", () => {
    expect(formatValue(hex([numberValue(-255)]))).toBe("= -0xFF");
  });

  test("hex() truncates fractional input toward zero first", () => {
    expect(formatValue(hex([numberValue(255.9)]))).toBe("= 0xFF");
  });

  test("bin(10) is 10, displayed as 0b1010", () => {
    const result = bin([numberValue(10)]);
    expect(result.type).toBe(ValueType.Hex);
    expect(result.value).toBe(10);
    expect(formatValue(result)).toBe("= 0b1010");
  });

  test("bin(0) -> 0b0", () => {
    expect(formatValue(bin([numberValue(0)]))).toBe("= 0b0");
  });

  test("bin(-10) keeps the sign outside the literal", () => {
    expect(formatValue(bin([numberValue(-10)]))).toBe("= -0b1010");
  });

  test("int(5.7) -> 5", () => {
    const result = int([numberValue(5.7)]);
    expect(result.type).toBe(ValueType.Number);
    expect(result.toNumber()).toBe(5);
  });

  test("int(-5.7) -> -5 (truncates toward zero, not floor)", () => {
    expect(int([numberValue(-5.7)]).toNumber()).toBe(-5);
  });

  test("int(5) -> 5 (already an integer)", () => {
    expect(int([numberValue(5)]).toNumber()).toBe(5);
  });
});

describe("hex()/bin()/int() — lightweight parselet-registry harness (call syntax)", () => {
  test("hex(255)", () => {
    const result = parseAndExecute("hex(255)");
    expect(result.type).toBe(ValueType.Hex);
    expect(formatValue(result)).toBe("= 0xFF");
  });

  test("bin(10)", () => {
    const result = parseAndExecute("bin(10)");
    expect(result.type).toBe(ValueType.Hex);
    expect(formatValue(result)).toBe("= 0b1010");
  });

  test("int(5.7)", () => {
    const result = parseAndExecute("int(5.7)");
    expect(result.type).toBe(ValueType.Number);
    expect(result.toNumber()).toBe(5);
  });

  test("int(-5.7)", () => {
    expect(parseAndExecute("int(-5.7)").toNumber()).toBe(-5);
  });

  test("int() also coerces a percentage, matching trunc()'s universal toNumber() coercion", () => {
    // 50% -> 0.5 as a raw number; int(...) truncates it to 0.
    expect(parseAndExecute("int(50%)").toNumber()).toBe(0);
  });
});

describe("hex()/bin()/int() — real engine wiring (newTrackedEngine(\"en\"))", () => {
  test("hex(255) -> 0xFF via the real, default-constructed ExpressionEngine", () => {
    const engine = newTrackedEngine();
    const value = engine.evaluateExpression("hex(255)");
    expect(value.type).toBe(ValueType.Hex);
    expect(formatValue(value)).toBe("= 0xFF");
  });

  test("a hex result still does arithmetic, which is the whole reason for the type", () => {
    const engine = newTrackedEngine();
    // The bug this replaced: a String operand read as zero, so this was 1.
    expect(engine.evaluateExpression("hex(255) + 1").toNumber()).toBe(256);
    expect(engine.evaluateExpression("bin(5) + 1").toNumber()).toBe(6);
  });

  test("bin(10) -> 0b1010 via the real engine", () => {
    const engine = newTrackedEngine();
    expect(formatValue(engine.evaluateExpression("bin(10)"))).toBe("= 0b1010");
  });

  test("int(5.7) -> 5 via the real engine", () => {
    const engine = newTrackedEngine();
    const value = engine.evaluateExpression("int(5.7)");
    expect(value.toNumber()).toBe(5);
  });

  test("int(-5.7) -> -5 via the real engine", () => {
    const engine = newTrackedEngine();
    const value = engine.evaluateExpression("int(-5.7)");
    expect(value.toNumber()).toBe(-5);
  });
});

describe("regression guard: 'as hex' / 'as bin' still work after hex/bin became FUNC keywords", () => {
  test("255 as hex still produces a Hex value (unchanged, via CALL-syntax-capable FUNC token now)", () => {
    const result = parseAndExecute("255 as hex");
    expect(result.type).toBe(ValueType.Hex);
    expect(result.value).toBe(255);
  });

  test("10 as bin still produces 0b1010", () => {
    const result = parseAndExecute("10 as bin");
    expect(formatValue(result)).toBe("= 0b1010");
    expect(result.value).toBe(10);
  });

  test("255 as hex via the real engine, end to end", () => {
    const engine = newTrackedEngine();
    const value = engine.evaluateExpression("255 as hex");
    expect(value.type).toBe(ValueType.Hex);
    expect(value.value).toBe(255);
  });
});
