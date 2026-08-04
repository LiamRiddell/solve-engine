import { describe, expect, test } from "@jest/globals";
import { completionItemToOption } from "@solve-js/language/adapters/codemirror";

describe("codemirror adapter — completionItemToOption", () => {
  test("maps each mapped category to its CM6 completion type", () => {
    expect(completionItemToOption({ label: "pi", category: "keyword" })).toEqual({ label: "pi", type: "keyword", detail: undefined });
    expect(completionItemToOption({ label: "sqrt", category: "function" })).toEqual({ label: "sqrt", type: "function", detail: undefined });
    expect(completionItemToOption({ label: "x", category: "variable" })).toEqual({ label: "x", type: "variable", detail: undefined });
    expect(completionItemToOption({ label: "km", category: "unit", detail: "length" })).toEqual({ label: "km", type: "type", detail: "length" });
    expect(completionItemToOption({ label: "now", category: "datetime" })).toEqual({ label: "now", type: "keyword", detail: undefined });
    expect(completionItemToOption({ label: "vec2", category: "vector" })).toEqual({ label: "vec2", type: "type", detail: undefined });
    expect(completionItemToOption({ label: "==", category: "comparison" })).toEqual({ label: "==", type: "keyword", detail: undefined });
    expect(completionItemToOption({ label: "&", category: "bitwise" })).toEqual({ label: "&", type: "keyword", detail: undefined });
    expect(completionItemToOption({ label: "+", category: "operator" })).toEqual({ label: "+", type: "keyword", detail: undefined });
  });

  test("falls back to 'text' for unmapped categories, including plugin-contributed ones", () => {
    expect(completionItemToOption({ label: "Iron Axe", category: "osrs-item", detail: "OSRS item" })).toEqual({
      label: "Iron Axe",
      type: "text",
      detail: "OSRS item",
    });
    expect(completionItemToOption({ label: "5", category: "number" })).toEqual({ label: "5", type: "text", detail: undefined });
  });

  test("preserves detail when present", () => {
    expect(completionItemToOption({ label: "km", category: "unit", detail: "length" }).detail).toBe("length");
  });
});
