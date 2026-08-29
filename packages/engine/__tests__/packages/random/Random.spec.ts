/**
 * Randomness and identifiers. These results are non-deterministic, so the tests
 * assert shape and membership over many draws rather than a fixed value.
 */
import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type MatrixData } from "@solve-js/vm/Value";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");
const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("uuid", () => {
	test("matches the version-4 pattern", () => {
		const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		for (let i = 0; i < 50; i++) expect(shown("uuid")).toMatch(re);
	});

	test("two draws differ", () => {
		expect(shown("uuid")).not.toBe(shown("uuid"));
	});
});

describe("coin", () => {
	test("is always heads or tails, and both occur", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 100; i++) {
			const r = shown("coin");
			expect(["heads", "tails"]).toContain(r);
			seen.add(r);
		}
		expect(seen.size).toBe(2);
	});
});

describe("random hex", () => {
	test("gives the requested number of hex digits", () => {
		expect(shown("random hex 8")).toMatch(/^[0-9a-f]{8}$/);
		expect(shown("random hex 32")).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe("pick", () => {
	test("returns one of its options", () => {
		for (let i = 0; i < 50; i++) {
			expect(["a", "b", "c"]).toContain(shown('pick("a", "b", "c")'));
		}
	});
});

describe("shuffle", () => {
	test("is a permutation of the input list", () => {
		for (let i = 0; i < 20; i++) {
			const v = value("shuffle [1, 2, 3, 4, 5]");
			expect(v.type).toBe(ValueType.Matrix);
			const data = [...(v.value as MatrixData).data].sort((a, b) => (a as number) - (b as number));
			expect(data).toEqual([1, 2, 3, 4, 5]);
		}
	});
});

describe("the random package is removable", () => {
	test("without it, uuid is not a keyword", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-random") });
		let made = false;
		try {
			made = slim.evaluateLine(1, "uuid").type === ValueType.String;
		} catch {
			made = false;
		}
		expect(made).toBe(false);
	});
});
