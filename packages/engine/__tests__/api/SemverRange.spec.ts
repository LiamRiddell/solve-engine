import { describe, expect, test } from "@jest/globals";
import { coerceVersion, isValidRange, satisfies, type SemverVersion } from "@solve-js/api/SemverRange";

/**
 * The internal semver-range checker that replaced the `semver` dependency for
 * engine-version package gating. These pin the grammar it supports and the
 * node-semver behaviours the engine relies on, independently of the
 * EngineVersionCompatibility layer that consumes it.
 */
describe("coerceVersion", () => {
  test("parses a plain version", () => {
    expect(coerceVersion("1.2.3")).toEqual([1, 2, 3]);
  });
  test("drops a prerelease tail, so a beta reads as its release", () => {
    expect(coerceVersion("1.0.0-beta.0")).toEqual([1, 0, 0]);
    expect(coerceVersion("2.3.4-rc.1+build.5")).toEqual([2, 3, 4]);
  });
  test("returns null when there is no major.minor.patch core", () => {
    expect(coerceVersion("garbage")).toBeNull();
    expect(coerceVersion("1.2")).toBeNull();
  });
});

describe("isValidRange", () => {
  test.each(["1.2.0", "^1.2.0", "^0.1.0", "~1.2.0", ">=0.2.0 <1.0.0", "^1.0.0 || ^2.0.0", "*", "x", ">1.0.0", "<=2.0.0"])(
    "accepts %s",
    (range) => {
      expect(isValidRange(range)).toBe(true);
    },
  );
  test.each(["garbage", "not valid", "not-a-semver-range", ">=x.y.z", "^", "1.2.3.4"])("rejects %s", (range) => {
    expect(isValidRange(range)).toBe(false);
  });
});

describe("satisfies", () => {
  const v = (s: string): SemverVersion => coerceVersion(s)!;

  test("caret on a >0 major spans to the next major", () => {
    expect(satisfies(v("1.0.0"), "^1.0.0")).toBe(true);
    expect(satisfies(v("1.9.9"), "^1.0.0")).toBe(true);
    expect(satisfies(v("2.0.0"), "^1.0.0")).toBe(false);
    expect(satisfies(v("0.9.9"), "^1.0.0")).toBe(false);
  });

  test("caret on 0.x narrows to the minor (node-semver's documented rule)", () => {
    expect(satisfies(v("0.1.0"), "^0.1.0")).toBe(true);
    expect(satisfies(v("0.1.5"), "^0.1.0")).toBe(true);
    expect(satisfies(v("0.2.0"), "^0.1.0")).toBe(false);
  });

  test("caret on 0.0.x narrows to the patch", () => {
    expect(satisfies(v("0.0.3"), "^0.0.3")).toBe(true);
    expect(satisfies(v("0.0.4"), "^0.0.3")).toBe(false);
  });

  test("tilde spans the patch range within a minor", () => {
    expect(satisfies(v("1.2.0"), "~1.2.0")).toBe(true);
    expect(satisfies(v("1.2.9"), "~1.2.0")).toBe(true);
    expect(satisfies(v("1.3.0"), "~1.2.0")).toBe(false);
  });

  test("exact matches only itself", () => {
    expect(satisfies(v("1.2.0"), "1.2.0")).toBe(true);
    expect(satisfies(v("1.2.1"), "1.2.0")).toBe(false);
  });

  test("comparators, AND-joined by whitespace", () => {
    expect(satisfies(v("0.5.0"), ">=0.2.0 <1.0.0")).toBe(true);
    expect(satisfies(v("0.1.0"), ">=0.2.0 <1.0.0")).toBe(false);
    expect(satisfies(v("1.0.0"), ">=0.2.0 <1.0.0")).toBe(false);
    expect(satisfies(v("2.0.0"), ">1.0.0")).toBe(true);
    expect(satisfies(v("1.0.0"), ">1.0.0")).toBe(false);
  });

  test("OR clauses, either side satisfies", () => {
    expect(satisfies(v("1.5.0"), "^1.0.0 || ^2.0.0")).toBe(true);
    expect(satisfies(v("2.5.0"), "^1.0.0 || ^2.0.0")).toBe(true);
    expect(satisfies(v("3.0.0"), "^1.0.0 || ^2.0.0")).toBe(false);
  });

  test("the wildcard matches anything", () => {
    expect(satisfies(v("0.0.1"), "*")).toBe(true);
    expect(satisfies(v("99.0.0"), "x")).toBe(true);
  });

  test("an invalid range is satisfied by nothing", () => {
    expect(satisfies(v("1.0.0"), "garbage")).toBe(false);
  });
});
