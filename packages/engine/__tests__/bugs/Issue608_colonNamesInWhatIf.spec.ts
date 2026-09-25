import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #608: a what-if written with `:name` added instead of substituting.
 * The docs teach `:price = 100` for a definition, so a reader asks
 * `line 2 with :price = 300`; the colon kept the what-if rule from firing,
 * `with` stayed the English word for `+`, and the line answered 420 and
 * overwrote `:price`. A what-if, a sweep and a goal seek now read `:name` as
 * the name, as they read `name`.
 */

function lines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		const v = line.result;
		if (v == null) return line.error ? `ERROR ${line.error}` : "";
		return v.isError() ? `ERROR ${String(v.errorMessage)}` : formatValue(v);
	});
}
const batch = (text: string) => lines(newTrackedEngine().parseDocument(text));
const incremental = (text: string) => lines(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text));

describe(":name in a what-if, a sweep and a goal seek", () => {
	test("the what-if substitutes and leaves the variable alone, both passes", () => {
		const text = ":price = 100\n:total = :price * 1.2\nline 2 with :price = 300\n:price";
		const expected = ["= 100", "= 120", "= 360", "= 100"];
		expect(batch(text)).toEqual(expected);
		expect(incremental(text)).toEqual(expected);
	});

	test("a second input joined by and may carry the colon too", () => {
		const text = ":price = 100\n:qty = 2\n:price * :qty\nline 3 with price = 300 and :qty = 3\n:qty";
		expect(batch(text)).toEqual(["= 100", "= 2", "= 200", "= 900", "= 2"]);
		expect(incremental(text)).toEqual(batch(text));
	});

	test("the sweep steps the variable, both passes", () => {
		const text = ":price = 100\n:total = :price * 1.2\nline 2 for :price from 100 to 300 step 100";
		expect(batch(text)[2]).toBe("= [120, 240, 360]");
		expect(incremental(text)[2]).toBe("= [120, 240, 360]");
	});

	test("goal seek solves for it through the incremental pass", () => {
		expect(incremental(":price = 100\n:price * 1.2\nsolve line 2 for :price = 150")[2]).toBe("= 125");
	});
});

describe("adversarial: the colon form agrees with the bare form, and refusals stay refusals", () => {
	test.each([
		[":a = 5\n:b = :a * 2\nline 2 with :a = 7", ":a = 5\n:b = :a * 2\nline 2 with a = 7"],
		["a = 5\nb = a * 2\nline 2 with :a = 7", "a = 5\nb = a * 2\nline 2 with a = 7"],
		[":r = 3%\n:y = :r * 100\nline 2 for :r from 1% to 3% step 1%", ":r = 3%\n:y = :r * 100\nline 2 for r from 1% to 3% step 1%"],
	])("%j answers as its bare spelling", (withColon, bare) => {
		expect(batch(withColon)).toEqual(batch(bare));
		expect(incremental(withColon)).toEqual(incremental(bare));
	});

	test("an input no line uses is still refused by name", () => {
		expect(batch("x = 1\nline 1 with :x = 2 and :y = 3")[1]).toMatch(/uses y/);
	});

	test("a colon with no name after it is not a what-if input", () => {
		expect(batch("a = 1\nb = a * 2\nline 2 with : = 5")[2]).toMatch(/^ERROR/);
	});

	test("with still means + where no name and = follow", () => {
		expect(batch("5 with 3")[0]).toBe("= 8");
	});
});
