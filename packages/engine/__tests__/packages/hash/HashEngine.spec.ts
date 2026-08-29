/**
 * The hash functions reached through the engine's call grammar (the pure
 * digests themselves are pinned against vectors in Hashes.spec.ts).
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");
const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("call forms produce the digest", () => {
	test("sha256", () => {
		expect(shown('sha256("hello")')).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
	});
	test("crc32", () => {
		expect(shown('crc32("hello")')).toBe("3610a686");
	});
	test("md5 and sha1 too", () => {
		expect(shown('md5("hello")')).toBe("5d41402abc4b2a76b9719d911017c592");
		expect(shown('sha1("hello")')).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
	});
});

describe("a non-text input faults", () => {
	test("sha256 of a number is an error", () => {
		expect(value("sha256(42)").type).toBe(ValueType.Error);
	});
});

describe("the hash package is removable", () => {
	test("without it, sha256 is not a known function", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-hash") });
		let digested = false;
		try {
			digested = slim.evaluateLine(1, 'sha256("hello")').type === ValueType.String;
		} catch {
			digested = false;
		}
		expect(digested).toBe(false);
	});
});
