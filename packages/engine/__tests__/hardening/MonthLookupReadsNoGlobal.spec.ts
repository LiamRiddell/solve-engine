/**
 * The month-name lookups hold only their own keys and read no global.
 *
 * `datetime:month-name-date` has no leading shape, so it is tried at every
 * token of every line. Once it guarded its table with
 * `Object.prototype.hasOwnProperty.call` (so `5 constructor` stopped reading
 * as a date), each call read the global `Object`, which inside a `vm` context
 * costs hundreds of nanoseconds: the benchmark gate confirmed the normaliser
 * suite at 1.35 times its merge base, a 200-word prose line at about 150 µs
 * against 87 µs. Both month tables are now `Map`s built once.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

const SRC = path.resolve(__dirname, "../../src/packages");

function bodyOf(file: string, signature: RegExp): string {
	const source = fs.readFileSync(path.join(SRC, file), "utf8");
	const start = source.search(signature);
	expect(start).toBeGreaterThanOrEqual(0);
	return source.slice(start, source.indexOf("\n}", start));
}

describe("the month lookups read no global per call", () => {
	test("monthOf in the month-name date rule", () => {
		const body = bodyOf("datetime/normalizer/MonthNameDateNormalizerRule.ts", /function monthOf\(/);
		expect(body).toContain("MONTH_NUMBERS.get(");
		expect(body).not.toMatch(/hasOwnProperty|\bObject\./);
	});

	test("the stocks date phrase", () => {
		const source = fs.readFileSync(path.join(SRC, "stocks/DatePhrase.ts"), "utf8");
		expect(source).not.toMatch(/hasOwnProperty\.call\(MONTH_NAMES/);
		expect(source).toContain("MONTH_INDEX.has(");
	});
});

describe("what the lookups read", () => {
	// A refusal may be thrown (a parse error) or returned; either is honest.
	const show = (line: string): string => {
		try {
			return formatValue(newTrackedEngine().evaluateExpression(line));
		} catch (error) {
			return `refused: ${(error as Error).message}`;
		}
	};

	test("a month name still reads as a date, in any case", () => {
		expect(show("25 Dec 2026")).toBe(show("25 december 2026"));
		expect(show("1 Oct 2026")).toBe(show("1 OCT 2026"));
		expect(show("25 Dec 2026")).not.toMatch(/Error|not a real date/);
	});

	test("a prototype word is never a month", () => expectPrototypeUntouched(() => {
		for (const word of PROTOTYPE_WORDS) {
			expect(show(`5 ${word} 2026`)).not.toMatch(/not a real date|NaN|undefined/);
		}
	}));

	test("a prose line normalises without a month read as one", () => {
		const engine = newTrackedEngine();
		const line = Array(200).fill("word").join(" ");
		expect(() => engine.parseDocument(line)).not.toThrow();
	});
});
