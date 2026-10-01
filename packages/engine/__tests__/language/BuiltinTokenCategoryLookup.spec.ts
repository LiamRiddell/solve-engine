/**
 * `builtinTokenCategory`, the built-in half of every category lookup.
 *
 * Highlighting asks for a category per token, so the lookup is on the
 * per-keystroke path. It read the built-in table through
 * `Object.prototype.hasOwnProperty.call`, which reads the global `Object` on
 * every call; inside a `vm` context, where the benchmarks run, that made a
 * 100-token line highlight about three times slower once every lookup went
 * through the per-engine table (#710). The table is now a `Map` built once.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { builtinTokenCategory, TokenCategoryTable } from "@solve-js/language/TokenCategoryMap";
import { LanguageService } from "@solve-js/language/LanguageService";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

describe("builtinTokenCategory", () => {
	test("answers the built-in table's categories", () => {
		expect(builtinTokenCategory("NUMBER")).toBe("number");
		expect(builtinTokenCategory("FLOAT")).toBe("number");
		expect(builtinTokenCategory("STRING")).toBe("string");
		expect(builtinTokenCategory("PI")).toBe("keyword");
	});

	test("an unknown, empty or differently cased type has no category", () => {
		expect(builtinTokenCategory("NOT_A_TOKEN_TYPE")).toBeUndefined();
		expect(builtinTokenCategory("")).toBeUndefined();
		expect(builtinTokenCategory("number")).toBeUndefined();
		expect(builtinTokenCategory(" NUMBER")).toBeUndefined();
	});

	test("a type named like an Object.prototype property reaches nothing", () => expectPrototypeUntouched(() => {
		for (const word of PROTOTYPE_WORDS) expect(builtinTokenCategory(word)).toBeUndefined();
	}));

	test("the lookup reads no global on each call", () => {
		// The source check the benchmark relies on: a global read inside the
		// function is what made it slow under a vm context.
		const source = fs.readFileSync(path.resolve(__dirname, "../../src/language/TokenCategoryMap.ts"), "utf8");
		const body = /export function builtinTokenCategory\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
		expect(body).toContain("BUILTIN_CATEGORIES.get(");
		expect(body).not.toMatch(/\bObject\b|hasOwnProperty/);
	});
});

describe("the per-engine table over it", () => {
	test("a package's category wins, and deleting it restores the built-in one", () => {
		const table = new TokenCategoryTable();
		expect(table.get("NUMBER")).toBe("number");
		table.set("NUMBER", "keyword");
		expect(table.get("NUMBER")).toBe("keyword");
		table.delete("NUMBER");
		expect(table.get("NUMBER")).toBe("number");
	});

	test("a package may give a prototype-named type a category of its own", () => expectPrototypeUntouched(() => {
		const table = new TokenCategoryTable();
		table.set("constructor", "function");
		expect(table.get("constructor")).toBe("function");
		expect(table.get("__proto__")).toBeUndefined();
	}));

	test("a highlighted long line still carries its categories", () => {
		const service = new LanguageService(new ExpressionEngine({ packages: BUILTIN_PACKAGES }));
		const tokens = service.getSemanticTokens(Array(50).fill("1+1").join(" + "), 1);
		// Fifty `1+1` joined by `+`: a hundred numbers, each coloured as one.
		expect(tokens.filter((t) => t.category === "number")).toHaveLength(100);
		expect(tokens.every((t) => t.category !== undefined)).toBe(true);
	});
});
