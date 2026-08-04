import { describe, expect, test } from "@jest/globals";
import { tokenClassName, createTokenClassName, DEFAULT_TOKEN_CLASS_PREFIX } from "@solve-js/language/tokenClassName";

describe("tokenClassName", () => {
  test("prefixes built-in categories with solve-", () => {
    expect(tokenClassName("number")).toBe("solve-number");
    expect(tokenClassName("string")).toBe("solve-string");
    expect(tokenClassName("keyword")).toBe("solve-keyword");
    expect(tokenClassName("operator")).toBe("solve-operator");
    expect(tokenClassName("comparison")).toBe("solve-comparison");
    expect(tokenClassName("bitwise")).toBe("solve-bitwise");
    expect(tokenClassName("function")).toBe("solve-function");
    expect(tokenClassName("variable")).toBe("solve-variable");
    expect(tokenClassName("unit")).toBe("solve-unit");
    expect(tokenClassName("datetime")).toBe("solve-datetime");
    expect(tokenClassName("vector")).toBe("solve-vector");
    expect(tokenClassName("punctuation")).toBe("solve-punctuation");
    expect(tokenClassName("error")).toBe("solve-error");
  });

  test("carries no editor's naming convention", () => {
    expect(tokenClassName("number").startsWith("cm-")).toBe(false);
  });

  test("works for arbitrary plugin-contributed category strings with no changes here", () => {
    expect(tokenClassName("osrs-item")).toBe("solve-osrs-item");
    expect(tokenClassName("anything-a-future-package-invents")).toBe("solve-anything-a-future-package-invents");
  });

  test("accepts a caller-supplied prefix", () => {
    expect(tokenClassName("number", "cm-solve-")).toBe("cm-solve-number");
    expect(tokenClassName("number", "app__tok-")).toBe("app__tok-number");
  });

  test("an empty prefix produces the bare category name", () => {
    expect(tokenClassName("number", "")).toBe("number");
  });

  test("the default prefix is the exported constant", () => {
    expect(DEFAULT_TOKEN_CLASS_PREFIX).toBe("solve-");
    expect(tokenClassName("number", DEFAULT_TOKEN_CLASS_PREFIX)).toBe(tokenClassName("number"));
  });
});

describe("createTokenClassName", () => {
  test("binds a prefix once and applies it to every category", () => {
    const className = createTokenClassName("cm-solve-");
    expect(className("number")).toBe("cm-solve-number");
    expect(className("unit")).toBe("cm-solve-unit");
    expect(className("osrs-item")).toBe("cm-solve-osrs-item");
  });

  test("agrees with passing the same prefix directly", () => {
    const className = createTokenClassName("x-");
    expect(className("keyword")).toBe(tokenClassName("keyword", "x-"));
  });

  test("each bound function keeps its own prefix", () => {
    const a = createTokenClassName("a-");
    const b = createTokenClassName("b-");
    expect(a("number")).toBe("a-number");
    expect(b("number")).toBe("b-number");
  });
});
