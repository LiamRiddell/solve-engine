/**
 * Datetime — next/last <Weekday> and until/since duration queries.
 *
 * Covers two previously-broken/unimplemented wiki features
 * (Provider/Core/Datetime.md):
 * - `next <Weekday>` / `last <Weekday>`: the actual next/previous
 *   occurrence of a named day of the week (the prior implementation was a
 *   blind ±7-day offset that ignored the weekday name entirely).
 * - `<unit> until <Datetime>` / `<unit> since <Datetime>`: the signed
 *   elapsed span between now and a target datetime, in the given unit
 *   (previously entirely unwired — UNTIL/SINCE were lexed but had no
 *   parselet).
 */

import { registerPackageForTesting } from "@tools/testUtils";
import { ARITHMETIC_PACKAGE, DATETIME_PACKAGE, UOM_PACKAGE } from "@solve-js/packages";
import { describe, expect, test, jest, afterEach } from "@jest/globals";
import { Lexer } from "@solve-js/lexer/Lexer";
import { TokenTypes } from "@solve-js/lexer/Token";
import { Parser } from "@solve-js/parser/Parser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";

import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { createEngineContext } from "@solve-js/engine/EngineContext";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { Value, ValueType } from "@solve-js/vm/Value";
import { TokenNormalizer } from "@solve-js/normalizer";
import { untilSinceNormalizerRule } from "@solve-js/packages/datetime/normalizer/UntilSinceNormalizerRule";

const normalizer = new TokenNormalizer();
const DATE_CONTEXT = createEngineContext({ calendar: "date" });
const DATE_CONTEXT_NOW = createEngineContext({ calendar: "date", relativeDays: "now" });
normalizer.register(untilSinceNormalizerRule());

function tokenize(lexer: Lexer, input: string) {
  lexer.reset(input);
  const tokens = [];
  for (const t of lexer) {
    if (t.type === TokenTypes.WS || t.type === "NEWLINE") continue;
    tokens.push(t);
  }
  return tokens;
}

function parseAndExecute(input: string, context = DATE_CONTEXT): Value {
  const lexer = new Lexer();
  const rawTokens = tokenize(lexer, input);
  const tokens = normalizer.normalize(rawTokens);
  const registry = new ParseletRegistry();
  registerPackageForTesting(ARITHMETIC_PACKAGE, registry);
  registerPackageForTesting(DATETIME_PACKAGE, registry);
  registerPackageForTesting(UOM_PACKAGE, registry);
  const parser = new Parser(registry);
  const builder = new BytecodeBuilder();
  parser.load(tokens);
  parser.parseExpression(0, builder);
  const program = builder.build();
  const vmUint8 = new Uint8Array(program.opcodes);
  const vmFloat64 = new Float64Array(program.numbers);
  // The Date backend, pinned: these tests fix `now` by mocking Date.now, which
  // native Temporal's clock does not read, so on Node 26 the default backend
  // computed from the real day (#621).
  const vm = createVM(sharedOpRegistry, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, context);
  const result = executeBytecode(
    { opcodes: vmUint8, numbers: vmFloat64, strings: program.strings },
    vm
  );
  return unwrapEvalResult(result);
}

describe("next/last <Weekday>", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Monday 2024-01-01, noon local time — a fixed, known weekday to pin `now` to.
  const MONDAY_NOON = new Date(2024, 0, 1, 12, 0, 0).getTime();
  // The start of that Monday: `next` and `last` name a day, at its midnight.
  const MONDAY_START = new Date(2024, 0, 1).getTime();

  function withFixedNow<T>(fn: () => T): T {
    jest.spyOn(Date, "now").mockReturnValue(MONDAY_NOON);
    try {
      return fn();
    } finally {
      jest.restoreAllMocks();
    }
  }

  test("next Saturday lands on a Saturday strictly after now", () => {
    const result = withFixedNow(() => parseAndExecute("next Saturday"));
    expect(result.type).toBe(ValueType.Datetime);
    const resultMs = result.value as number;
    expect(new Date(resultMs).getDay()).toBe(6); // Saturday
    expect(resultMs).toBeGreaterThan(MONDAY_NOON);
    expect(resultMs - MONDAY_START).toBe(5 * 86400000);
  });

  test("next Monday from a Monday jumps a full week ahead (not +0)", () => {
    const result = withFixedNow(() => parseAndExecute("next Monday"));
    const resultMs = result.value as number;
    expect(new Date(resultMs).getDay()).toBe(1); // Monday
    expect(resultMs - MONDAY_START).toBe(7 * 86400000);
  });

  test("last Saturday lands on a Saturday strictly before now", () => {
    const result = withFixedNow(() => parseAndExecute("last Saturday"));
    expect(result.type).toBe(ValueType.Datetime);
    const resultMs = result.value as number;
    expect(new Date(resultMs).getDay()).toBe(6); // Saturday
    expect(resultMs).toBeLessThan(MONDAY_NOON);
    expect(MONDAY_START - resultMs).toBe(2 * 86400000);
  });

  test("last Monday from a Monday jumps a full week back (not -0)", () => {
    const result = withFixedNow(() => parseAndExecute("last Monday"));
    const resultMs = result.value as number;
    expect(new Date(resultMs).getDay()).toBe(1); // Monday
    expect(MONDAY_START - resultMs).toBe(7 * 86400000);
  });

  test("next Sunday and last Sunday are 7 days apart from each other, straddling now", () => {
    const next = withFixedNow(() => parseAndExecute("next Sunday"));
    const last = withFixedNow(() => parseAndExecute("last Sunday"));
    const nextMs = next.value as number;
    const lastMs = last.value as number;
    expect(new Date(nextMs).getDay()).toBe(0);
    expect(new Date(lastMs).getDay()).toBe(0);
    expect(nextMs).toBeGreaterThan(MONDAY_NOON);
    expect(lastMs).toBeLessThan(MONDAY_NOON);
    expect(Math.round((nextMs - lastMs) / 86400000)).toBe(7);
  });

  test("with relativeDays \"now\", next and last keep the time of day", () => {
    const next = withFixedNow(() => parseAndExecute("next Saturday", DATE_CONTEXT_NOW));
    const last = withFixedNow(() => parseAndExecute("last Saturday", DATE_CONTEXT_NOW));
    expect((next.value as number) - MONDAY_NOON).toBe(5 * 86400000);
    expect(MONDAY_NOON - (last.value as number)).toBe(2 * 86400000);
  });

  test("next/last without a following weekday throws a clear parse error", () => {
    expect(() => parseAndExecute("next + 1")).toThrow(/day of the week/i);
    expect(() => parseAndExecute("last")).toThrow(/day of the week/i);
  });
});

describe("<unit> until/since <Datetime>", () => {
  test("days until tomorrow is ~1", () => {
    const result = parseAndExecute("days until tomorrow");
    expect(result.type).toBe(ValueType.Uom);
    expect(result.unit).toBe("days");
    expect(result.value as number).toBeCloseTo(1, 1);
  });

  test("days since yesterday is ~1", () => {
    const result = parseAndExecute("days since yesterday");
    expect(result.type).toBe(ValueType.Uom);
    expect(result.unit).toBe("days");
    expect(result.value as number).toBeCloseTo(1, 1);
  });

  test("hours until tomorrow is the hours left in today, since tomorrow starts at midnight", () => {
    const result = parseAndExecute("hours until tomorrow");
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    const expected = (tomorrow.getTime() - Date.now()) / 3600000;
    expect(result.type).toBe(ValueType.Uom);
    expect(result.unit).toBe("hours");
    expect(Math.abs((result.value as number) - expected)).toBeLessThan(0.01);
    expect(result.value as number).toBeGreaterThan(0);
    expect(result.value as number).toBeLessThanOrEqual(25.1);
  });

  test("with relativeDays \"now\", hours until tomorrow is ~24", () => {
    const result = parseAndExecute("hours until tomorrow", DATE_CONTEXT_NOW);
    // 24 hours, but 23 or 25 when the day ahead crosses a daylight-saving boundary.
    expect(result.value as number).toBeGreaterThanOrEqual(22.9);
    expect(result.value as number).toBeLessThanOrEqual(25.1);
  });

  test("days until yesterday is negative (target is in the past)", () => {
    const result = parseAndExecute("days until yesterday");
    expect(result.value as number).toBeLessThan(0);
    expect(result.value as number).toBeCloseTo(-1, 1);
  });

  test("days since tomorrow is negative (target is in the future)", () => {
    const result = parseAndExecute("days since tomorrow");
    expect(result.value as number).toBeLessThan(0);
    expect(result.value as number).toBeCloseTo(-1, 1);
  });

  test("hours until now is ~0", () => {
    const result = parseAndExecute("hours until now");
    expect(result.type).toBe(ValueType.Uom);
    expect(result.value as number).toBeCloseTo(0, 1);
  });

  test("weeks until now counts from the start of today, so it is under a day's worth of a week", () => {
    const result = parseAndExecute("weeks until now");
    expect(result.type).toBe(ValueType.Uom);
    expect(result.value as number).toBeGreaterThanOrEqual(0);
    expect(result.value as number).toBeLessThanOrEqual(25 / 168);
  });

  test("with relativeDays \"now\", weeks until now is ~0", () => {
    expect(parseAndExecute("weeks until now", DATE_CONTEXT_NOW).value as number).toBeCloseTo(0, 1);
  });
});
