import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { Explanation } from "@solve-js/explain/Explanation";
import { EngineError } from "@solve-js/errors/EngineError";

/**
 * Found bug: `explainLine` gave no steps for a three-factor money chain such as
 * `$5 * 3 * 2`. Already fixed on the current engine: each product in the chain
 * is a step, the money kept exact through it. Pinned here with the spellings
 * of money the reader has (a symbol, a code, a word) and chains of other
 * lengths, so a step that goes missing again shows under this name.
 */

function explain(line: string): Explanation {
	return newTrackedEngine().explainLine(line);
}

function steps(line: string): string[] {
	return explain(line).steps.map((step) => `${step.description} = ${formatValue(step.value).replace(/^=\s*/, "")}`);
}

/** Explaining a line either lays out its steps or refuses with an EngineError, never a raw JavaScript error. */
function expectEngineErrorOrSteps(line: string): void {
	try {
		expect(Array.isArray(explain(line).steps)).toBe(true);
	} catch (e) {
		expect({ line, engineError: e instanceof EngineError }).toEqual({ line, engineError: true });
	}
}

describe("the lines that exposed it", () => {
	test.each([
		["$5 * 3 * 2", ["$5 times 3 = $15.00", "$15.00 times 2 = $30.00"]],
		["5 USD * 3 * 2", ["5 USD times 3 = $15.00", "$15.00 times 2 = $30.00"]],
		["£5 * 3 * 2", ["£5 times 3 = £15.00", "£15.00 times 2 = £30.00"]],
		["$5 * 3 * 2 * 4", ["$5 times 3 = $15.00", "$15.00 times 2 = $30.00", "$30.00 times 4 = $120.00"]],
		["$5 * 3", ["$5 times 3 = $15.00"]],
		["5 * 3 * 2", ["5 times 3 = 15", "15 times 2 = 30"]],
	])("%s explains as %j", (line, expected) => {
		expect(steps(line)).toEqual(expected);
	});

	test("the explained answer is the line's answer", () => {
		for (const line of ["$5 * 3 * 2", "$0.10 * 3 * 3", "$1,000.01 * 7 * 13"]) {
			const explained = explain(line).result;
			expect(explained && formatValue(explained)).toBe(formatValue(newTrackedEngine().evaluateExpression(line)));
		}
	});
});

describe("adversarial", () => {
	test("security: prototype words in the chain, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expectEngineErrorOrSteps(`$5 * ${word} * 2`);
		});
	});

	test("security: a long chain is explained within its budget, and markup is text", () => {
		const started = performance.now();
		const long = explain(`$1 * ${Array.from({ length: 200 }, () => "1").join(" * ")}`);
		expect(performance.now() - started).toBeLessThan(5_000);
		expect(long.steps.length).toBe(200);
		expectEngineErrorOrSteps(`$1 * ${"1 * ".repeat(1_000)}1`);
		for (const line of fill("$5 * 3 * X", TEXT_EDGES)) expectEngineErrorOrSteps(line);
	});

	test("realistic: the chain over a value from a variable, and inside brackets", () => {
		expect(steps("(5 * 3 * 2) * $1")).toEqual(["5 times 3 = 15", "15 times 2 = 30", "30 times $1 = $30.00"]);
		expectEngineErrorOrSteps("$5 * 3 * 2 in EUR");
	});

	test("edge: numeric edges as a factor", () => {
		for (const line of fill("$5 * 3 * X", NUMERIC_EDGES)) {
			const shownSteps = explain(line).steps.map((s) => s.description).join(" ");
			expect({ line, leak: /\[object|undefined/.test(shownSteps) }).toEqual({ line, leak: false });
		}
	});
});
