/**
 * Removing one of two packages that claim a call-fusion word hands the word
 * to the other.
 *
 * Every package's `callFusions` merged into one map with the last writer
 * winning, and unregistration deleted its names outright, so a package pair
 * that both declared a word broke the survivor when either was unloaded. The
 * map now remembers who claimed each word, in order.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

const fusedType = (engine: ExpressionEngine, expression: string): string => {
	const lexer = engine.getLexer();
	lexer.resetExpression(expression);
	return engine.getNormalizer().normalize([...lexer])[0].type;
};

describe("two packages claiming one call word", () => {
	let warn: ReturnType<typeof jest.spyOn>;
	beforeEach(() => {
		// The compatibility index reports the collision; that is its job, and
		// not what this spec is about.
		warn = jest.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => warn.mockRestore());

	test("the newest claim is in force, and removal hands the word back", () => {
		const engine = newTrackedEngine();
		engine.registerPackage({ name: "pkg-a", callFusions: { zap: "ZAP_A" } });
		engine.registerPackage({ name: "pkg-b", callFusions: { zap: "ZAP_B" } });
		expect(fusedType(engine, "zap(1)")).toBe("ZAP_B");

		engine.unregisterPackage("pkg-b");
		expect(fusedType(engine, "zap(1)")).toBe("ZAP_A");

		engine.unregisterPackage("pkg-a");
		expect(fusedType(engine, "zap(1)")).toBe("IDENT");
	});

	test("removing the older claim leaves the newer one in force", () => {
		const engine = newTrackedEngine();
		engine.registerPackage({ name: "pkg-a", callFusions: { zap: "ZAP_A" } });
		engine.registerPackage({ name: "pkg-b", callFusions: { zap: "ZAP_B" } });

		engine.unregisterPackage("pkg-a");
		expect(fusedType(engine, "zap(1)")).toBe("ZAP_B");
	});
});
