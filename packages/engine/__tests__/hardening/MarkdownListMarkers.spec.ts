/**
 * A markdown list marker is markup, not arithmetic.
 *
 * `- 100 + 20` answered -80 in every published version up to 1.0.1, because
 * `-` is also a prefix operator and nothing stripped the marker before
 * evaluating. That is the worst shape a bug can take: a plausible number where
 * a right one was expected, with nothing on screen to say it went wrong.
 *
 * The three unordered markers disagreed with each other about the same
 * document, which is what makes it a defect rather than a design choice.
 * `- 100 + 20` was -80, `* 100 + 20` errored, and `+ 100 + 20` was 120, right
 * by luck rather than by rule.
 *
 * The discriminator is the space, which CommonMark requires after a marker for
 * exactly this reason. `-100 + 20` has none and stays arithmetic.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/** The first line's result, through the markdown document path. */
function evaluateMarkdown(line: string): unknown {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	const [parsed] = engine.parseDocument(line, { inputType: "markdown" }).lines;
	return parsed.result?.value ?? parsed.error;
}

describe("a list marker is not an operator", () => {
	test.each([
		["- 100 + 20", 120],
		["* 100 + 20", 120],
		["+ 100 + 20", 120],
		["1. 100 + 20", 120],
		["123. 100 + 20", 120],
		["  - 100 + 20", 120],
		["\t- 100 + 20", 120],
	])("%j evaluates to %i", (line, expected) => {
		expect(evaluateMarkdown(line)).toBe(expected);
	});

	test("the reported case, which used to be -80", () => {
		expect(evaluateMarkdown("- 100 + 20")).toBe(120);
	});

	test("all three unordered markers now agree", () => {
		const answers = ["- 100 + 20", "* 100 + 20", "+ 100 + 20"].map(evaluateMarkdown);
		expect(new Set(answers).size).toBe(1);
	});

	test("a task item evaluates rather than reporting an empty matrix", () => {
		// `- [ ] 100 + 20` used to lex `[ ]` as a matrix literal and complain
		// that a matrix cannot be empty.
		expect(evaluateMarkdown("- [ ] 100 + 20")).toBe(120);
	});

	test("a ticked task item too", () => {
		expect(evaluateMarkdown("- [x] 100 + 20")).toBe(120);
	});
});

describe("what must keep working", () => {
	test("unary minus without a space is still arithmetic", () => {
		// The whole rule rests on this staying true.
		expect(evaluateMarkdown("-100 + 20")).toBe(-80);
	});

	test("a leading minus with a space inside a longer expression", () => {
		expect(evaluateMarkdown("2 * -3")).toBe(-6);
	});

	test("a matrix literal is not mistaken for a checkbox", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const [value] = engine.evaluateExpression("[1,2] + [3,4]");
		expect((value.value as { data: number[] }).data).toEqual([4, 6]);
	});

	test("a bare hyphen is still not a list", () => {
		expect(evaluateMarkdown("- 5 * 4")).toBe(20);
	});

	test("a horizontal rule is still skipped", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const [parsed] = engine.parseDocument("---", { inputType: "markdown" }).lines;
		expect(parsed.isEmpty).toBe(true);
	});
});
