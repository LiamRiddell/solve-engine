import { describe, expect, test, beforeEach } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { serializeValue } from "@solve-js/worker/serialize";
import type { SerializedValue } from "@solve-js/worker/dto";

/**
 * Issue #154: a non-finite number INSIDE a matrix cell broke the DTO round-trip.
 *
 * #141 guarded the scalar top-level `number` field, but `serializeMatrix` passed
 * numeric cells through raw, so a `[1/0, 2]` matrix carried `Infinity` straight
 * into `SerializedMatrix.cells`. `structuredClone` preserved it but
 * `JSON.stringify` turned it into `null`, so the two paths diverged — the same
 * bug #141 fixed, one container deeper.
 *
 * The matrix path now tags a non-finite cell with the same string form the scalar
 * `nonFinite` field uses, and a host recovers it via `Number(cell)`.
 */
describe("Issue #154: a non-finite matrix cell survives the DTO's JSON round-trip", () => {
  let engine: ExpressionEngine;
  beforeEach(() => {
    engine = new ExpressionEngine("en", false);
  });

  const dtoOf = (source: string): SerializedValue => serializeValue(engine.evaluateExpression(source)[0]);

  function expectPortable(dto: SerializedValue): void {
    expect(structuredClone(dto)).toEqual(dto);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  }

  test("a row vector with an Infinity cell is portable and recoverable", () => {
    const dto = dtoOf("[1/0, 2]");
    expect(dto.matrix).toBeDefined();
    expect(dto.matrix!.cells).toEqual(["Infinity", 2]);
    expectPortable(dto);
    expect(Number(dto.matrix!.cells[0])).toBe(Infinity);
  });

  test("a matrix with a NaN cell is portable", () => {
    const dto = dtoOf("[0/0, 1; 2, 3]");
    expect(dto.matrix!.cells).toContain("NaN");
    expectPortable(dto);
    expect(Number(dto.matrix!.cells[dto.matrix!.cells.indexOf("NaN")])).toBeNaN();
  });

  test("-Infinity is tagged too", () => {
    const dto = dtoOf("[-1/0, 5]");
    expect(dto.matrix!.cells).toEqual(["-Infinity", 5]);
    expectPortable(dto);
    expect(Number(dto.matrix!.cells[0])).toBe(-Infinity);
  });

  test("a wholly finite matrix keeps plain numeric cells", () => {
    const dto = dtoOf("[1, 2; 3, 4]");
    expect(dto.matrix!.cells).toEqual([1, 3, 2, 4]);
    expect(dto.matrix!.cells.every((c) => typeof c === "number")).toBe(true);
    expectPortable(dto);
  });
});
