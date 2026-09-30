import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Found question: `x:3` answers 3. Is it a label or should it be refused?
 *
 * It is a label, and stays one. The labels page's rule is that words and then a
 * colon name the figure after them, whatever the figure is, and a single letter
 * is a word: `x: 3` in a ledger (`A: 40`, `B: 55`) is the same shape as
 * `Rent: 1200`. Nothing else the colon could mean fits: a ratio is written
 * `ratio(x, 3)` precisely because a colon between two numbers is a clock time
 * (`2:3` is 2:03), and a variable is assigned with `:x = 3` or `x = 3`, never
 * `x:3`. Refusing it would break `Note: 5` for every one-letter name, and
 * reading it as anything that uses `x` would guess. So a label never reads or
 * writes the variable of the same name: with `x = 2`, `x:3` is 3 and `x` is
 * still 2. The spec pins that, through every entry point.
 */

function shown(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? `ERROR ${v.errorMessage}` : formatValue(v);
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the decision, pinned", () => {
	test.each([
		["x:3", "= 3"],
		["x: 3", "= 3"],
		["x : 3", "= 3"],
		["Note: 5", "= 5"],
		["A: 40", "= 40"],
		["x:3 + 1", "= 4"],
		["x: $5", "= $5.00"],
	])("%s is the labelled figure, %s", (line, answer) => {
		expect(shown(line)).toBe(answer);
	});

	test("a label never reads or writes the variable of the same name", () => {
		const { batch, incremental } = expectHonestDocument("x = 2\nx:3\nx + 1\ntotal above");
		expect(batch).toEqual(["= 2", "= 3", "= 3", "= 8"]);
		expect(incremental).toEqual(batch);
	});

	test("a colon between two numbers is a clock time, and a colon before a name assigns it", () => {
		expect(shown("2:3")).toMatch(/2:03:00 AM$/);
		expect(newTrackedEngine().parseDocument(":x = 3\nx * 2").lines.map((l) => (l.result ? formatValue(l.result) : l.error))).toEqual(["= 3", "= 6"]);
	});

	test("the single-expression entry point agrees with the documents", () => {
		const engine = newTrackedEngine();
		expect(formatValue(engine.evaluateLine(1, "x:3"))).toBe("= 3");
		expect(formatValue(engine.evaluateLine(2, "Note: 5"))).toBe("= 5");
	});

	test("a label with nothing after the colon is refused, and a name read after one is still a read", () => {
		expect(shown("x:")).toBe('THROWS Expected an operator or the end of the line, but found ":"');
		expect(shown("x:3 + x")).toBe("THROWS Undefined variable: x");
	});
});

describe("adversarial", () => {
	test("security: prototype words as the label, markup after the figure, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const out = expectHonestLine(`${word}:3`);
				expect({ word, text: out.kind === "value" ? out.text : out.kind }).toEqual({ word, text: "= 3" });
			}
		});
		for (const line of fill("x:3 X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestLine(`${"x".repeat(1_000)}:3`);
	});

	test("realistic: a ledger of one-letter labels totals, and a check over a label reads its figure", () => {
		const { batch, incremental } = expectHonestDocument("A: 40\nB: 55\ntotal above\ncheck line 1 < line 2");
		expect(batch).toEqual(["= 40", "= 55", "= 95", "= ✓"]);
		expect(incremental).toEqual(batch);
	});

	test("edge: every numeric edge as the figure, and CRLF around the line", () => {
		for (const line of fill("x: X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(expectHonestDocument("x:3\r\nx:4\r\n").batch.slice(0, 2)).toEqual(["= 3", "= 4"]);
	});
});
