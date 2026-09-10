/**
 * A single expression does not touch the dependency graph.
 *
 * `evaluateExpression` routes through `evaluateLine(-1, ...)`: line -1 is the
 * sentinel for "no document position". The dependency graph connects lines
 * across a document, so an edge from a line that has no position and no
 * siblings connects nothing any reader consults. Registering one was a
 * measurable slice of every single-expression evaluation spent on a graph
 * nothing reads, so line -1 skips it. See `ExpressionEngine.registerLineWithTags`.
 *
 * This pins the two things that must stay true for that skip to be safe: the
 * behaviour of `evaluateExpression` is unchanged (variables still accumulate
 * across calls through the VM, errors are still values, a definition that fails
 * still leaves the name as it was), and the graph really is left empty for line
 * -1 so the cost cannot creep back unnoticed.
 */
import { describe, expect, test } from "@jest/globals";
import { createEngine } from "@solve-js/api/createEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

function shown(engine: ReturnType<typeof createEngine>, expression: string): string {
	try {
		return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
	} catch (e) {
		return "THROW:" + (e as Error).message;
	}
}

describe("a single expression skips the dependency graph", () => {
	test("variables still accumulate across calls", () => {
		const engine = createEngine();
		expect(shown(engine, ":x = 5")).toBe("5");
		expect(shown(engine, "x + 1")).toBe("6"); // a read-only line does not drop x
		expect(shown(engine, ":x = 6")).toBe("6");
		expect(shown(engine, "x + 1")).toBe("7");
		expect(shown(engine, ":y = x * 2")).toBe("12");
		expect(shown(engine, "y")).toBe("12");
		expect(shown(engine, "2 + 2")).toBe("4"); // a line that writes nothing
		expect(shown(engine, "x")).toBe("6"); // x survives it
	});

	test("errors are still values, and a failed definition leaves the name alone", () => {
		const engine = createEngine();
		expect(shown(engine, ":x = 5")).toBe("5");
		expect(shown(engine, ":x = zz + 1")).toContain("Undefined variable: zz"); // the failed RHS is an error value
		expect(shown(engine, "x")).toBe("5"); // x keeps its earlier definition
	});

	test("the graph is left empty for line -1", () => {
		const engine = createEngine();
		engine.evaluateExpression(":total = 5 + 3");
		engine.evaluateExpression("total * 2");
		const dag = (engine as unknown as { getDag(): { getReads(n: number): ReadonlySet<string>; getWrites(n: number): ReadonlySet<string> } }).getDag();
		expect([...dag.getWrites(-1)]).toEqual([]);
		expect([...dag.getReads(-1)]).toEqual([]);
	});
});
