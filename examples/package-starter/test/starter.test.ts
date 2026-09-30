/**
 * The starter's own tests, written with `solve-engine/testing`. They run under
 * Node's built-in test runner, so the only dependency is the engine itself.
 *
 * Each piece is tested by what a reader types, never by the bytecode it
 * compiles to, and each has a case that tries to break it.
 */

import { test } from "node:test";
import { createTestEngine, expectDocument, expectExpression, expectPackage } from "solve-engine/testing";
import { BUILTIN_PACKAGES } from "solve-engine/packages";
import { createStarterPackage, createStarterPackages, placeProblem, tipFunction } from "../src/index.js";

/** An engine with the starter, whose rainfall service answers from a table. */
function engineWithRainfall(table: Record<string, number> = { Oslo: 4.5 }) {
	const calls: string[] = [];
	const engine = createTestEngine(
		createStarterPackages({
			fetchRainfall: async (place) => {
				calls.push(place);
				// An own-property check, so a place named like `toString` is not
				// answered by a property every object inherits.
				if (!Object.hasOwn(table, place)) throw new Error(`no station for ${place}`);
				return table[place];
			},
		}),
	);
	return { engine, calls };
}

test("the package is well made: it registers, shadows no prose, and collides with no built-in", () => {
	const starter = createStarterPackage({ fetchRainfall: async () => 0 });
	for (const pkg of [tipFunction, starter]) {
		expectPackage(pkg).toDeclareCompatibleEngineVersion();
		expectPackage(pkg).notToShadow();
		expectPackage(pkg).notToCollideWith(BUILTIN_PACKAGES);
	}
});

test("the function: a 15% tip on 40 is 6, and a wrong type is refused by code", () => {
	const { engine } = engineWithRainfall();
	expectExpression(engine, "tip(40, 15)").toEqual(6);
	expectExpression(engine, 'tip("x", 15)').toFailWith("DEFINE_FUNCTION_ARGUMENT_TYPE");
	expectExpression(engine, "tip(40)").toFailWith("DEFINE_FUNCTION_ARITY_MISMATCH");
	// The word stays free for a variable: a call word fires only before "(".
	expectExpression(engine, ":tip = 3").toEqual(3);
	engine.clear();
});

test("the phrase: tea break is a quarter of an hour, and its words stay free", () => {
	const { engine } = engineWithRainfall();
	expectExpression(engine, "tea break").toEqual(15, "minutes");
	expectExpression(engine, "2 * tea break").toEqual(30, "minutes");
	expectExpression(engine, ":tea = 2").toEqual(2);
	engine.clear();
});

test("the converter: 7 as tally, and a value it cannot draw passes through", () => {
	const { engine } = engineWithRainfall();
	expectExpression(engine, "7 as tally").toEqual("||||| ||");
	expectExpression(engine, "0 as tally").toEqual("");
	expectExpression(engine, "2.5 as tally").toEqual(2.5);
	expectExpression(engine, "-3 as tally").toEqual(-3);
	expectExpression(engine, "1000 as tally").toEqual(1000);
	engine.clear();
});

test("the lookup: Pending first, then the fetched millimetres", async () => {
	const { engine, calls } = engineWithRainfall();
	expectExpression(engine, 'rainfall("Oslo")').toBePending();
	await expectExpression(engine, 'rainfall("Oslo")').toResolveTo(4.5, "mm");
	// Asked again, the settled value is read back, not fetched again.
	expectExpression(engine, 'rainfall("Oslo")').toEqual(4.5, "mm");
	if (calls.length !== 1) throw new Error(`expected one fetch, got ${calls.length}`);
	engine.clear();
});

test("the lookup in a document: a line reads the live value like any other", async () => {
	const { engine } = engineWithRainfall();
	const doc = await expectDocument(engine, ':wet = rainfall("Oslo")\nwet * 2');
	doc.line(1).toEqual(4.5, "mm");
	doc.line(2).toEqual(9, "mm");
	engine.clear();
});

test("the lookup: a failed fetch settles to a coded error, never a number", async () => {
	const { engine } = engineWithRainfall();
	(await expectExpression(engine, 'rainfall("Atlantis")').settled()).toFailWith("STARTER_RAINFALL_FAILED");
	engine.clear();
});

test("adversarial: a hostile place is refused by code before anything is fetched", () => {
	const { engine, calls } = engineWithRainfall();
	for (const place of ["../../etc/passwd", "a\\\\b", "x".repeat(200), "", "   "]) {
		expectExpression(engine, `rainfall("${place}")`).toFailWith("STARTER_BAD_PLACE");
	}
	expectExpression(engine, "rainfall(42)").toFailWith("STARTER_BAD_PLACE");
	// A line far past the engine's own length limit is refused before the
	// package sees it, with the engine's code.
	expectExpression(engine, `rainfall("${"x".repeat(10_000)}")`).toFailWith("EXPRESSION_TOO_LONG");
	if (calls.length !== 0) throw new Error(`a hostile place was fetched: ${calls.join(", ")}`);
	engine.clear();
});

test("adversarial: prototype words are ordinary place names", async () => {
	const { engine } = engineWithRainfall({ constructor: 1, __proto__x: 2 });
	(await expectExpression(engine, 'rainfall("constructor")').settled()).toEqual(1, "mm");
	(await expectExpression(engine, 'rainfall("toString")').settled()).toFailWith("STARTER_RAINFALL_FAILED");
	engine.clear();
});

test("placeProblem, the part: ordinary, boundary and hostile names", () => {
	const cases: Array<[unknown, boolean]> = [
		["Oslo", true],
		["x".repeat(80), true],
		["x".repeat(81), false],
		["a/b", false],
		["line\nbreak", false],
		[42, false],
		[undefined, false],
	];
	for (const [place, ok] of cases) {
		if ((placeProblem(place) === null) !== ok) throw new Error(`placeProblem(${JSON.stringify(place)}) should be ${ok ? "accepted" : "refused"}`);
	}
});
