/**
 * A document can define its own units, the way it can already define a function.
 *
 * `1 sprint = 2 weeks` teaches the rest of the document that a sprint is two
 * weeks, so `6 sprints in days` reads back 84 days and `13 story points` reads
 * 52 hours. The mechanism is expansion: a defined name is rewritten to its
 * definition (`6 sprints` becomes `6 * 2 weeks`) before parsing, so every unit
 * feature that already works, arithmetic, `in`/`to` conversion, incompatible
 * unit detection, handles a user unit with no special case of its own.
 *
 * Two design decisions are pinned here because they are the load-bearing ones:
 *
 * - **Dimensioned, not free-standing.** The base of a definition is always a
 *   real built-in unit, so a defined unit inherits that unit's dimension.
 *   `6 sprints in days` converts and `6 sprints in kg` is refused, exactly as
 *   `weeks in days` and `weeks in kg` are.
 * - **Document-scoped.** Definitions live for the one document that wrote them
 *   and are rebuilt top-to-bottom on every pass, so nothing leaks between
 *   documents and a corrected definition replaces the one above it.
 *
 * Definition-then-use is exercised through `parseDocument`, the real document
 * path, so the scoping is genuinely tested rather than assumed.
 */

import { describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Every non-blank line's rendered result through the document path, with the
 * gutter's `= ` marker stripped. A line that failed is returned as `!<message>`
 * so a test can assert on the failure without a separate code path.
 */
function runDocument(source: string): string[] {
	const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
	return engine
		.parseDocument(source, { inputType: "markdown" })
		.lines.filter((line) => !line.isEmpty)
		.map((line) =>
			line.result ? formatValue(line.result).replace(/^=\s*/, "") : `!${line.error}`,
		);
}

describe("a document can define its own units", () => {
	test("the worked example from the feature request", () => {
		expect(
			runDocument(
				["1 sprint = 2 weeks", "6 sprints in days", "1 story point = 4 hours", "13 story points"].join("\n"),
			),
		).toEqual(["sprint defined", "84 days", "story point defined", "52 hours"]);
	});

	test("a definition confirms itself by name", () => {
		expect(runDocument("1 sprint = 2 weeks")).toEqual(["sprint defined"]);
	});

	test("a defined unit is usable in bare arithmetic, reported in its base unit", () => {
		expect(runDocument("1 sprint = 2 weeks\n6 sprints")).toEqual(["sprint defined", "12 weeks"]);
	});

	test("defined units add to each other", () => {
		expect(runDocument("1 sprint = 2 weeks\n2 sprints + 1 sprint")).toEqual(["sprint defined", "6 weeks"]);
	});

	test("a fractional ratio is preserved exactly", () => {
		expect(runDocument("1 halfhour = 0.5 hours\n3 halfhours in minutes")).toEqual([
			"halfhour defined",
			"90 minutes",
		]);
	});
});

describe("a defined unit carries its base unit's dimension", () => {
	test.each([
		["6 sprints in days", "84 days"],
		["6 sprints to days", "84 days"],
		["6 sprints in hours", "2016 hours"],
	])("%j converts to %j", (use, expected) => {
		expect(runDocument(`1 sprint = 2 weeks\n${use}`)).toEqual(["sprint defined", expected]);
	});

	test("converting to a foreign dimension is refused, not guessed", () => {
		const [, result] = runDocument("1 sprint = 2 weeks\n6 sprints in kg");
		// The same refusal `6 weeks in kg` earns: a duration is not a mass.
		expect(result).toContain("cannot be converted");
	});
});

describe("plurals and multi-word names", () => {
	test.each([
		// Defined singular, used either way.
		["1 sprint = 2 weeks", "6 sprints in days", "84 days"],
		["1 sprint = 2 weeks", "6 sprint in days", "84 days"],
		// Defined plural, used either way.
		["1 sprints = 2 weeks", "6 sprints in days", "84 days"],
		["1 sprints = 2 weeks", "6 sprint in days", "84 days"],
		// A two-word name, singular or plural.
		["1 story point = 4 hours", "13 story points", "52 hours"],
		["1 story point = 4 hours", "13 story point", "52 hours"],
	])("%j then %j is %j", (definition, use, expected) => {
		const [, result] = runDocument(`${definition}\n${use}`);
		expect(result).toBe(expected);
	});
});

describe("definitions are document-scoped", () => {
	test("a later definition of the same name replaces the earlier one", () => {
		expect(runDocument("1 sprint = 2 weeks\n1 sprint = 3 weeks\n1 sprint")).toEqual([
			"sprint defined",
			"sprint defined",
			"3 weeks",
		]);
	});

	test("definitions do not survive into the next document on the same engine", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		const read = (source: string): string[] =>
			engine
				.parseDocument(source, { inputType: "markdown" })
				.lines.filter((line) => !line.isEmpty)
				.map((line) => (line.result ? formatValue(line.result).replace(/^=\s*/, "") : `!${line.error}`));

		expect(read("1 sprint = 2 weeks\n6 sprints")).toEqual(["sprint defined", "12 weeks"]);
		// The second document never defined `sprint`, so the name is unknown again.
		expect(read("6 sprints")[0]).toContain("Undefined");
	});
});

describe("what must keep working", () => {
	test("built-in units are untouched", () => {
		expect(runDocument("6 weeks in days")).toEqual(["42 days"]);
		expect(runDocument("100cm + 2m")).toEqual(["300.00 cm"]);
	});

	test("a scalar equation with a coefficient is still an equation, not a definition", () => {
		expect(runDocument("2 x = 10")).toEqual(['x stored as an equation — solve with "x =>"']);
	});

	test("a plain assignment is still an assignment", () => {
		expect(runDocument("x = 5")).toEqual(["5"]);
	});

	test("a user-defined function still defines and calls", () => {
		expect(runDocument("f(x) = 2*x + 1\nf(3)")).toEqual(["f(x) defined", "7"]);
	});

	test("a coefficient other than one is not a unit definition", () => {
		// `2 sprints = 4 weeks` is not the `1 <name> = ...` shape, so it defines
		// nothing and the later use finds no unit.
		const [, use] = runDocument("2 sprints = 4 weeks\n6 sprints");
		expect(use).toContain("Undefined");
	});

	test("a base that is not a known unit defines nothing", () => {
		// `oranges` is not a unit, so this is not a definition and `apples` never
		// becomes usable. A defined unit is always an alias for a real dimension.
		const [, use] = runDocument("1 apple = 2 oranges\n3 apples");
		expect(use).toContain("Undefined");
	});

	test("a made-up unit name does not shadow a same-named variable", () => {
		// The unit only activates after a quantity, so a bare `sprint` stays a
		// variable read and the two coexist.
		expect(runDocument("1 sprint = 2 weeks\n:sprint = 5\nsprint + 1")).toEqual([
			"sprint defined",
			"5",
			"6",
		]);
	});

	test("a bare defined name is not silently turned into a quantity", () => {
		// `sprint` with no number in front is left alone, so prose that happens to
		// contain a defined word is never rewritten into arithmetic.
		const [, bare] = runDocument("1 sprint = 2 weeks\nsprint");
		expect(bare).toContain("Undefined");
	});
});
