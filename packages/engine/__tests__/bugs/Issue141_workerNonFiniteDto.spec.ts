import { describe, expect, test, beforeEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { serializeValue } from "@solve-js/worker/serialize";
import type { SerializedValue } from "@solve-js/worker/dto";

/**
 * Issue #141: a non-finite reading (1/0 -> Infinity, 0/0 -> NaN, an overflow)
 * broke the worker DTO's documented JSON round-trip. `structuredClone` preserves
 * Infinity/NaN but `JSON.stringify` turns them into `null`, so the two paths
 * diverged and the serialized value could not be cached and reloaded.
 *
 * The DTO now keeps `number` finite (0) and names the true value in `nonFinite`,
 * so both round-trips agree.
 */
describe("Issue #141: a non-finite reading survives the DTO's JSON round-trip", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
  });

  const dtoOf = (source: string): SerializedValue => serializeValue(engine.evaluateExpression(source));

  function expectPortable(dto: SerializedValue): void {
    expect(structuredClone(dto)).toEqual(dto);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  }

  test.each([
    ["1/0", "Infinity"],
    ["-1/0", "-Infinity"],
    ["0/0", "NaN"],
    ["1e308 * 10", "Infinity"],
  ])("%s serialises portably as %s", (source, sentinel) => {
    const dto = dtoOf(source);
    expect(Number.isFinite(dto.number)).toBe(true);
    expect(dto.number).toBe(0);
    expect(dto.nonFinite).toBe(sentinel);
    expectPortable(dto);
    // A host reconstructs the true reading from the sentinel.
    expect(Number(dto.nonFinite)).toBe(Number(source === "0/0" ? NaN : source.startsWith("-") ? -Infinity : Infinity));
  });

  test("a finite result carries no nonFinite marker", () => {
    const dto = dtoOf("2 + 2");
    expect(dto.number).toBe(4);
    expect(dto.nonFinite).toBeUndefined();
    expectPortable(dto);
  });
});
