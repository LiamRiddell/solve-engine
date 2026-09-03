/**
 * A parse that throws leaves the parser ready for the next one.
 *
 * Three pieces of parser state used to survive a throw. The nesting depth was
 * incremented on entry to parseExpression and decremented only on the success
 * path; the builder handed to a nested parse replaced the parser's own with no
 * restore; and the binding power exposed to a Tier-2 parselet was never put
 * back. Each is now restored in a finally.
 *
 * The boundary on what this can show: the engine calls load() before every
 * top-level parse, and load() zeroes the depth, so the leaked counter never
 * reached a second line through the public API. The first test is the guard
 * that keeps that true; the second pins that the depth check itself still
 * answers when a line really is too deep.
 */

import { describe, expect, test } from "@jest/globals";
import { EngineError } from "@solve-js/errors/EngineError";
import { newTrackedEngine } from "@tools/trackedEngine";

describe("after many failed parses", () => {
	test("an ordinary nested expression still parses", () => {
		const engine = newTrackedEngine();
		// Each of these throws from inside a nested parseExpression: the
		// operand after the operator is missing.
		for (let i = 0; i < 80; i++) {
			expect(() => engine.evaluateExpression("(1 + ")).toThrow(EngineError);
		}
		// Well inside maxNestingDepth (50), so only a leaked counter could refuse it.
		expect(engine.evaluateExpression("((((((1 + 2))))))").toNumber()).toBe(3);
	});

	test("a genuinely too-deep expression is still refused", () => {
		// The complexity score (nesting counts ten a level) would refuse this
		// first; it is raised so the depth guard itself is what answers.
		const engine = newTrackedEngine({ config: { validation: { maxComplexity: 5000 } } });
		const deep = "(".repeat(60) + "1" + ")".repeat(60);
		let code: string | undefined;
		try {
			engine.evaluateExpression(deep);
		} catch (error) {
			code = (error as EngineError).code;
		}
		expect(code).toBe("NESTING_DEPTH_EXCEEDED");
	});
});
