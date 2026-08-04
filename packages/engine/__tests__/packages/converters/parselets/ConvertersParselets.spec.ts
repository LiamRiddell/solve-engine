/**
 * Converters package — the general `<expr> as <type>` mechanism.
 */

import { registerPackageForTesting } from "@tools/testUtils";
import { ARITHMETIC_PACKAGE, CONVERTERS_PACKAGE, PERCENTAGE_PACKAGE } from "@solve-js/packages";
import { describe, expect, test, afterEach } from "@jest/globals";
import { Lexer } from "@solve-js/lexer/Lexer";
import { TokenTypes } from "@solve-js/lexer/Token";
import { Parser } from "@solve-js/parser/Parser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";

import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { Value, ValueType, numberValue } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { registerAsConverter, unregisterAsConverter } from "@solve-js/vm/VMBuiltins";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
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
  registerPackageForTesting(PERCENTAGE_PACKAGE, registry);
  registerPackageForTesting(CONVERTERS_PACKAGE, registry);
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

describe("as percent / as %", () => {
  test("0.5 as percent -> 50%", () => {
    const result = parseAndExecute("0.5 as percent");
    expect(result.type).toBe(ValueType.Percentage);
    expect(result.value).toBeCloseTo(0.5);
  });

  test("0.5 as % -> 50% (bare symbol form)", () => {
    const result = parseAndExecute("0.5 as %");
    expect(result.type).toBe(ValueType.Percentage);
    expect(result.value).toBeCloseTo(0.5);
  });
});

describe("as decimal / as dec / as number", () => {
  test("(800 to 1000) as decimal -> 0.25 (a real Percentage value, unwrapped)", () => {
    const result = parseAndExecute("(800 to 1000) as decimal");
    expect(result.type).toBe(ValueType.Number);
    expect(result.value).toBeCloseTo(0.25);
  });

  test("(800 to 1000) as dec -> 0.25", () => {
    expect(parseAndExecute("(800 to 1000) as dec").toNumber()).toBeCloseTo(0.25);
  });

  test("(800 to 1000) as number -> 0.25 (alias of 'as decimal' — see doc comment)", () => {
    expect(parseAndExecute("(800 to 1000) as number").toNumber()).toBeCloseTo(0.25);
  });

  test("5 as decimal -> 5 (no-op on a plain number)", () => {
    expect(parseAndExecute("5 as decimal").toNumber()).toBe(5);
  });
});

describe("as hex", () => {
  test("255 as hex -> Hex value", () => {
    const result = parseAndExecute("255 as hex");
    expect(result.type).toBe(ValueType.Hex);
    expect(result.value).toBe(255);
  });
});

describe("as fraction", () => {
  test("0.5 as fraction -> \"1/2\"", () => {
    const result = parseAndExecute("0.5 as fraction");
    expect(result.type).toBe(ValueType.String);
    expect(result.value).toBe("1/2");
  });

  test("0.25 as fraction -> \"1/4\"", () => {
    expect(parseAndExecute("0.25 as fraction").value).toBe("1/4");
  });

  test("1.5 as fraction -> \"3/2\" (whole + fractional part)", () => {
    expect(parseAndExecute("1.5 as fraction").value).toBe("3/2");
  });

  test("4 as fraction -> \"4\" (already a whole number)", () => {
    expect(parseAndExecute("4 as fraction").value).toBe("4");
  });
});

describe("as multiplier", () => {
  test("(800 to 1000) as multiplier -> \"1.25x\" (a 25% increase is a 1.25x multiplier)", () => {
    expect(parseAndExecute("(800 to 1000) as multiplier").value).toBe("1.25x");
  });
});

describe("as sci", () => {
  test("1500000 as sci -> \"1.5e+6\"", () => {
    expect(parseAndExecute("1500000 as sci").value).toBe("1.5e+6");
  });

  test("1500000 as scientific -> \"1.5e+6\" (alias)", () => {
    expect(parseAndExecute("1500000 as scientific").value).toBe("1.5e+6");
  });
});

describe("as binary / as octal", () => {
  // These assert the display and the underlying value separately, because the
  // pair is the point. A base is a way of writing a number, so the value has to
  // stay a number and only the rendering changes. Asserting the string alone is
  // what let `(255 as binary) + 1` evaluate to 1 for as long as it did.
  test("10 as binary displays as 0b1010 and is still ten", () => {
    const value = parseAndExecute("10 as binary");
    expect(formatValue(value)).toBe("= 0b1010");
    expect(value.value).toBe(10);
    expect(value.type).toBe(ValueType.Hex);
  });

  test("10 as bin -> 0b1010 (alias)", () => {
    expect(formatValue(parseAndExecute("10 as bin"))).toBe("= 0b1010");
  });

  test("8 as octal displays as 0o10 and is still eight", () => {
    const value = parseAndExecute("8 as octal");
    expect(formatValue(value)).toBe("= 0o10");
    expect(value.value).toBe(8);
  });

  test("8 as oct -> 0o10 (alias)", () => {
    expect(formatValue(parseAndExecute("8 as oct"))).toBe("= 0o10");
  });

  test("a converted number still does arithmetic", () => {
    expect(parseAndExecute("(255 as binary) + 1").toNumber()).toBe(256);
    expect(parseAndExecute("(255 as octal) + 1").toNumber()).toBe(256);
    expect(parseAndExecute("(255 as hex) + 1").toNumber()).toBe(256);
  });

  test("a negative keeps the sign outside the literal", () => {
    // -255 rendered as `0x-FF` until the sign was taken off before conversion.
    expect(formatValue(parseAndExecute("-255 as hex"))).toBe("= -0xFF");
    expect(formatValue(parseAndExecute("-255 as binary"))).toBe("= -0b11111111");
  });

  test("a fraction truncates rather than growing fractional digits", () => {
    // `255.7 as hex` used to render 0xFF.B3333333333.
    expect(formatValue(parseAndExecute("255.7 as hex"))).toBe("= 0xFF");
  });
});

describe("custom asConverters (SDK extension point)", () => {
  afterEach(() => {
    unregisterAsConverter("double");
  });

  test("an unrecognized name falls through to the runtime asConverterRegistry", () => {
    registerAsConverter("double", (v) => numberValue(v.toNumber() * 2));
    expect(parseAndExecute("21 as double").toNumber()).toBe(42);
  });

  test("an unregistered custom name produces an honest error, not a silent wrong value", () => {
    const result = parseAndExecute("5 as totallyMadeUp");
    expect(result.type).toBe(ValueType.Error);
  });
});

describe("CONVERTERS_PACKAGE — real engine wiring", () => {
  test("as hex works via the real, default-constructed ExpressionEngine", () => {
    const engine = newTrackedEngine("en");
    const [value] = engine.evaluateExpression("255 as hex");
    expect(value.type).toBe(ValueType.Hex);
    expect(value.value).toBe(255);
  });

  test("asConverters registered via a custom IEnginePackage works end-to-end", () => {
    const customPackage: IEnginePackage = {
      name: "test-roman-converter",
      asConverters: {
        triple: (v: Value) => numberValue(v.toNumber() * 3),
      },
    };
    const engine = newTrackedEngine("en", false, undefined, undefined, [
      ...BUILTIN_PACKAGES,
      customPackage,
    ]);
    const [value] = engine.evaluateExpression("7 as triple");
    expect(value.toNumber()).toBe(21);
  });
});
