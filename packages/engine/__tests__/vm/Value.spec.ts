import { describe, expect, test } from "@jest/globals";
import { ValueType, numberValue, stringValue, bigIntValue, hexValue, rowVectorValue, uomValue, errorValue, pendingValue, type MatrixData } from "@solve-js/vm/Value";

describe("Value", () => {
  test("numberValue creates number type", () => {
    const v = numberValue(42);
    expect(v.type).toBe(ValueType.Number);
    expect(v.value).toBe(42);
    expect(v.isNumber()).toBe(true);
    expect(v.toNumber()).toBe(42);
  });

test("stringValue creates string type", () => {
     const v = stringValue("hello");
     expect(v.type).toBe(ValueType.String);
     expect(v.value).toBe("hello");
     expect(v.isString()).toBe(true);
     expect(v.toNumber()).toBe(0);
   });

  test("hexValue creates hex type", () => {
    const v = hexValue(255);
    expect(v.type).toBe(ValueType.Hex);
    expect(v.value).toBe(255);
    expect(v.isHex()).toBe(true);
    expect(v.toNumber()).toBe(255);
  });

  test("bigIntValue creates bigint type", () => {
    const v = bigIntValue(BigInt(9007199254740991));
    expect(v.type).toBe(ValueType.BigInt);
    expect(v.value).toBe(BigInt(9007199254740991));
    expect(v.isBigInt()).toBe(true);
    expect(v.toNumber()).toBe(9007199254740991);
  });

  test("rowVectorValue creates a 1xN Matrix type", () => {
    const v2 = rowVectorValue([1, 2]);
    expect(v2.type).toBe(ValueType.Matrix);
    expect(v2.isMatrix()).toBe(true);
    expect(v2.isVectorShape()).toBe(true);
    expect((v2.value as MatrixData).rows).toBe(1);
    expect((v2.value as MatrixData).cols).toBe(2);
    expect((v2.value as MatrixData).data).toEqual([1, 2]);

    const v3 = rowVectorValue([1, 2, 3]);
    expect(v3.type).toBe(ValueType.Matrix);
    expect(v3.isMatrix()).toBe(true);
    expect(v3.isVectorShape()).toBe(true);

    const v4 = rowVectorValue([1, 2, 3, 4]);
    expect(v4.type).toBe(ValueType.Matrix);
    expect(v4.isMatrix()).toBe(true);
    expect(v4.isVectorShape()).toBe(true);
  });

  test("uomValue creates uom type with unit", () => {
    const v = uomValue(100, "USD");
    expect(v.type).toBe(ValueType.Uom);
    expect(v.value).toBe(100);
    expect(v.unit).toBe("USD");
  });

  test("toNumber converts numeric string", () => {
    const v = stringValue("42.5");
    expect(v.toNumber()).toBe(42.5);
  });

test("toNumber returns 0 for non-numeric string", () => {
     const v = stringValue("hello");
     expect(v.toNumber()).toBe(0);
   });

  describe("fault guards", () => {
    test("isError / errorCode / errorMessage on an Error value", () => {
      const v = errorValue("UNIT_MISMATCH", "cannot convert kg to seconds");
      expect(v.isError()).toBe(true);
      expect(v.isPending()).toBe(false);
      expect(v.isFault()).toBe(true);
      expect(v.errorCode).toBe("UNIT_MISMATCH");
      expect(v.errorMessage).toBe("cannot convert kg to seconds");
      // The fault still reads as 0 numerically: the whole point of the guard.
      expect(v.toNumber()).toBe(0);
    });

    test("isPending on a Pending value", () => {
      const v = pendingValue("query:btc-usd");
      expect(v.isPending()).toBe(true);
      expect(v.isError()).toBe(false);
      expect(v.isFault()).toBe(true);
      // A Pending is not an Error, so the error accessors stay undefined.
      expect(v.errorCode).toBeUndefined();
      expect(v.errorMessage).toBeUndefined();
      expect(v.toNumber()).toBe(0);
    });

    test("a plain value carries no fault", () => {
      const v = numberValue(0);
      expect(v.isError()).toBe(false);
      expect(v.isPending()).toBe(false);
      expect(v.isFault()).toBe(false);
      // A real zero must be indistinguishable from a fault ONLY by the number,
      // never by the guard: this is the distinction the guard restores.
      expect(v.toNumber()).toBe(0);
      expect(v.errorCode).toBeUndefined();
      expect(v.errorMessage).toBeUndefined();
    });

    test("errorCode is undefined for non-error types", () => {
      expect(stringValue("hello").errorCode).toBeUndefined();
      expect(numberValue(42).errorMessage).toBeUndefined();
    });
  });
});
