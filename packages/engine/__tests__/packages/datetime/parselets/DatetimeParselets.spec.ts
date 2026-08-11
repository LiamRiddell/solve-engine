import { registerPackageForTesting } from "@tools/testUtils";
import { ARITHMETIC_PACKAGE, DATETIME_PACKAGE, UOM_PACKAGE } from "@solve-js/packages";
import { describe, expect, test } from "@jest/globals";
import { Lexer } from "@solve-js/lexer/Lexer";
import { TokenTypes } from "@solve-js/lexer/Token";
import { Parser } from "@solve-js/parser/Parser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";



import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { Value, ValueType } from "@solve-js/vm/Value";

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
  registerPackageForTesting(DATETIME_PACKAGE, registry);
  registerPackageForTesting(UOM_PACKAGE, registry);
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

describe("Datetime Parselets", () => {
  test("now returns current time", () => {
    const before = Date.now();
    const result = parseAndExecute("now");
    const after = Date.now();
    expect(result.type).toBe(ValueType.Datetime);
    expect((result.value as number)).toBeGreaterThanOrEqual(before);
    expect((result.value as number)).toBeLessThanOrEqual(after);
  });

  test("today returns current time", () => {
    const before = Date.now();
    const result = parseAndExecute("today");
    const after = Date.now();
    expect(result.type).toBe(ValueType.Datetime);
    expect((result.value as number)).toBeGreaterThanOrEqual(before);
    expect((result.value as number)).toBeLessThanOrEqual(after);
  });

  test("now + 1 day lands on tomorrow's date at the same time of day", () => {
    const now = new Date();
    parseAndExecute("now"); // warmup
    const result = parseAndExecute("now + 1 day").value as number;
    // Derived from the calendar rather than hardcoded to 86,400,000: the day
    // a zone changes its offset is 23 or 25 hours long, and the answer still
    // has to be tomorrow at the same time on it. The 100ms window is the
    // original tolerance for the clock ticking between the two readings.
    const expected = new Date(now);
    expected.setDate(expected.getDate() + 1);
    expect(result - expected.getTime()).toBeGreaterThanOrEqual(0);
    expect(result - expected.getTime()).toBeLessThanOrEqual(100);
  });

  test("now - 1 day lands on yesterday's date at the same time of day", () => {
    const now = new Date();
    const result = parseAndExecute("now - 1 day").value as number;
    const expected = new Date(now);
    expected.setDate(expected.getDate() - 1);
    expect(result - expected.getTime()).toBeGreaterThanOrEqual(0);
    expect(result - expected.getTime()).toBeLessThanOrEqual(100);
  });

  test("now + 2 hours yields timestamp + 7200000", () => {
    const now = Date.now();
    const result = parseAndExecute("now + 2 hours");
    const elapsed = (result.value as number) - now;
    // Allow for up to 100ms variance due to system clock precision
    expect(elapsed).toBeGreaterThanOrEqual(7199900);
    expect(elapsed).toBeLessThanOrEqual(7200100);
  });

  test("now + 30 minutes yields timestamp + 1800000", () => {
    const now = Date.now();
    const result = parseAndExecute("now + 30 minutes");
    const elapsed = (result.value as number) - now;
    // Allow for up to 100ms variance due to system clock precision
    expect(elapsed).toBeGreaterThanOrEqual(1799900);
    expect(elapsed).toBeLessThanOrEqual(1800100);
  });

  test("now + 2 weeks lands fourteen calendar days on", () => {
    const now = new Date();
    const result = parseAndExecute("now + 2 weeks").value as number;
    // Same reasoning as the "+ 1 day" test above: a fortnight containing a
    // daylight-saving transition is not 14 x 86,400,000 ms long.
    const expected = new Date(now);
    expected.setDate(expected.getDate() + 14);
    expect(result - expected.getTime()).toBeGreaterThanOrEqual(0);
    expect(result - expected.getTime()).toBeLessThanOrEqual(100);
  });

  test("now + 3 months lands three calendar months on, not ninety days on", () => {
    // This used to assert exactly 7,776,000,000 ms, which is the unit table's
    // fixed 30-day month times three. Three real months are 89 to 92 days, so
    // that was wrong on nearly every date: from January it landed a day early,
    // from July two days early. The expectation is worked out from the
    // calendar instead, clamping the day of the month because a 31st has no
    // counterpart in a 30-day month (November 30 plus three months is
    // February 28, never March 2).
    const now = new Date();
    const result = new Date(parseAndExecute("now + 3 months").value as number);

    const targetMonthCount = now.getFullYear() * 12 + now.getMonth() + 3;
    const expectedYear = Math.floor(targetMonthCount / 12);
    const expectedMonth = targetMonthCount % 12;
    const lastDayOfExpectedMonth = new Date(expectedYear, expectedMonth + 1, 0).getDate();

    expect(result.getFullYear()).toBe(expectedYear);
    expect(result.getMonth()).toBe(expectedMonth);
    expect(result.getDate()).toBe(Math.min(now.getDate(), lastDayOfExpectedMonth));
  });

  test("now + 1 year lands on the same date next year, not 365 days on", () => {
    // 31,536,000,000 ms is 365 days, a day short of a year whenever a
    // February 29 falls inside the span. The leap day itself is the one date
    // with no counterpart a year later, and clamps back to February 28.
    const now = new Date();
    const result = new Date(parseAndExecute("now + 1 year").value as number);
    const isLeapDay = now.getMonth() === 1 && now.getDate() === 29;

    expect(result.getFullYear()).toBe(now.getFullYear() + 1);
    expect(result.getMonth()).toBe(now.getMonth());
    expect(result.getDate()).toBe(isLeapDay ? 28 : now.getDate());
  });

  test("now + 10 seconds yields timestamp + ~10000", () => {
    const now = Date.now();
    const result = parseAndExecute("now + 10 seconds");
    const elapsed = (result.value as number) - now;
    expect(elapsed).toBeGreaterThanOrEqual(9950);
    expect(elapsed).toBeLessThanOrEqual(10050); // 50ms tolerance for parse+execution overhead
  });

  test("now - 10 seconds yields timestamp - ~10000", () => {
    const now = Date.now();
    const result = parseAndExecute("now - 10 seconds");
    const elapsed = (result.value as number) - now;
    expect(elapsed).toBeGreaterThanOrEqual(-10050);
    expect(elapsed).toBeLessThanOrEqual(-9950); // 50ms tolerance for parse+execution overhead
  });

  test("now + 5 minutes yields ~300000", () => {
    const now = Date.now();
    const result = parseAndExecute("now + 5 minutes");
    const elapsed = (result.value as number) - now;
    expect(elapsed).toBeGreaterThanOrEqual(299000);
    expect(elapsed).toBeLessThanOrEqual(301000);
  });

  test("now + 2 hours yields ~7200000", () => {
    const now = Date.now();
    const result = parseAndExecute("now + 2 hours");
    const elapsed = (result.value as number) - now;
    expect(elapsed).toBeGreaterThanOrEqual(7190000);
    expect(elapsed).toBeLessThanOrEqual(7210000);
  });

  test("today + 3 days yields ~259200000", () => {
    const now = Date.now();
    const result = parseAndExecute("today + 3 days");
    const elapsed = (result.value as number) - now;
    expect(elapsed).toBeGreaterThanOrEqual(259000000);
    expect(elapsed).toBeLessThanOrEqual(260000000);
  });

  test("yesterday + 1 day = tomorrow", () => {
    const yesterday = parseAndExecute("yesterday");
    const result = parseAndExecute("yesterday + 1 day");
    const diff = (result.value as number) - (yesterday.value as number);
    expect(diff).toBeCloseTo(86400000, -2);
  });

  test("tomorrow - 1 day = today (or yesterday)", () => {
    const tomorrow = parseAndExecute("tomorrow");
    const result = parseAndExecute("tomorrow - 1 day");
    const diff = (result.value as number) - (tomorrow.value as number);
    expect(diff).toBeCloseTo(-86400000, -2);
  });

  test("now + 1 week yields ~604800000", () => {
    const now = Date.now();
    const result = parseAndExecute("now + 1 week");
    const elapsed = (result.value as number) - now;
    expect(elapsed).toBeGreaterThanOrEqual(604000000);
    expect(elapsed).toBeLessThanOrEqual(606000000);
  });

  test("14 days returns ValueType.Uom", () => {
    const result = parseAndExecute("14 days");
    expect(result.type).toBe(ValueType.Uom);
    expect(result.value).toBe(14);
    expect(result.unit).toBe("days");
  });

  test("now + 14 days works with ValueType.Uom", () => {
    const now = Date.now();
    const result = parseAndExecute("now + 14 days");
    const elapsed = (result.value as number) - now;
    const expectedMs = 14 * 24 * 60 * 60 * 1000;
    expect(elapsed).toBeGreaterThanOrEqual(expectedMs - 100);
    expect(elapsed).toBeLessThanOrEqual(expectedMs + 100);
  });

  test("5 years in days conversion", () => {
    const result = parseAndExecute("5 years in days");
    expect(result.type).toBe(ValueType.Uom);
    // 5 years * 365 days/year = 1825 days (using convert)
    expect(result.value).toBeCloseTo(1825, 0); 
    expect(result.unit).toBe("days");
  });
});
