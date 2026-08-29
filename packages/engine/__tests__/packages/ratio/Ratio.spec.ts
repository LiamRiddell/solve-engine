/** Ratio reduction, pure and through the engine. */
import { describe, expect, test } from "@jest/globals";
import { reduceRatio } from "@solve-js/packages/ratio/RatioOps";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType } from "@solve-js/vm/Value";

const shown = (source: string) => formatValue(newTrackedEngine().evaluateExpression(source)).replace(/^=\s*/, "");
const value = (source: string) => newTrackedEngine().evaluateExpression(source);

describe("reduceRatio (pure)", () => {
	test.each([
		[[1920, 1080], "16:9"],
		[[4, 8], "1:2"],
		[[2, 4, 6], "1:2:3"],
		[[1080, 1920], "9:16"],
		[[5, 5], "1:1"],
	])("%j -> %s", (parts, expected) => expect(reduceRatio(parts)).toBe(expected));

	test("invalid inputs are null", () => {
		expect(reduceRatio([1])).toBeNull();
		expect(reduceRatio([1.5, 2])).toBeNull();
		expect(reduceRatio([-4, 8])).toBeNull();
		expect(reduceRatio([0, 5])).toBeNull();
	});
});

describe("through the engine", () => {
	test("ratio(...)", () => {
		expect(shown("ratio(1920, 1080)")).toBe("16:9");
		expect(shown("ratio(2, 4, 6)")).toBe("1:2:3");
	});
	test("a bad ratio faults", () => {
		expect(value("ratio(1.5, 2)").type).toBe(ValueType.Error);
	});
});

describe("the ratio package is removable", () => {
	test("without it, ratio(...) is not a known function", async () => {
		const { ExpressionEngine } = await import("@solve-js/engine/ExpressionEngine");
		const { BUILTIN_PACKAGES } = await import("@solve-js/packages/builtins");
		const slim = new ExpressionEngine({ packages: BUILTIN_PACKAGES.filter((p) => p.name !== "solve-ratio") });
		let ok = false;
		try {
			ok = slim.evaluateLine(1, "ratio(16, 9)").type === ValueType.String;
		} catch {
			ok = false;
		}
		expect(ok).toBe(false);
	});
});
