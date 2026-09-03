/**
 * A cached program is answered without lexing or normalising its expression.
 *
 * The bytecode cache was looked up only after the whole front half had run:
 * the length check, lexing, normalising, the complexity score, the three
 * effectful-grammar tries and the reads/writes extraction. On a cache-hit
 * evaluation of an ordinary line, lexing and normalising were about two
 * fifths of the cost, paid on every keystroke elsewhere in the document. The
 * front half's output is now remembered beside the program, and a hit skips
 * to the async preflight and the VM.
 *
 * What is pinned: the skip really happens, every result is the same on the
 * hit as on the miss, the paths that need the real token stream (diagnostics
 * collectors, explainLine) still get it, and the invalidations that already
 * existed (a user-unit definition, a snapshot restore) still hold.
 */

import { describe, expect, jest, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

const LINES = [
	"1 + 2 * 3",
	"15% of 2400",
	"100 cm + 2 m",
	"sqrt(144) + max(1, 2)",
	"3 days + 4 hours",
	":x = 5",
	"x * 2",
	"f(y) = y + 1",
	"f(3)",
	"round(10 / 3, 2)",
];

describe("the second evaluation of an expression", () => {
	test("does not lex or normalise it again", () => {
		const engine = newTrackedEngine();
		const lex = jest.spyOn(engine.getLexer(), "resetExpression");
		const normalise = jest.spyOn(engine.getNormalizer(), "normalize");

		expect(engine.evaluateExpression("12 + 50% of 200 - 3").toNumber()).toBe(109);
		const lexedOnce = lex.mock.calls.length;
		const normalisedOnce = normalise.mock.calls.length;
		expect(lexedOnce).toBeGreaterThan(0);
		expect(normalisedOnce).toBeGreaterThan(0);

		expect(engine.evaluateExpression("12 + 50% of 200 - 3").toNumber()).toBe(109);
		expect(lex.mock.calls.length).toBe(lexedOnce);
		expect(normalise.mock.calls.length).toBe(normalisedOnce);
	});

	test("agrees with the first, value for value, across the grammar", () => {
		const engine = newTrackedEngine();
		const first = LINES.map((line, i) => formatValue(engine.evaluateLine(i + 1, line)));
		const second = LINES.map((line, i) => formatValue(engine.evaluateLine(i + 1, line)));
		expect(second).toEqual(first);
		expect(first[0]).toBe("= 7");
		expect(first[8]).toBe("= 4");
	});

	test("agrees through parseDocument, whose lines arrive already lexed", () => {
		const engine = newTrackedEngine();
		const doc = LINES.join("\n");
		const first = engine.parseDocument(doc).lines.map((l) => (l.result ? formatValue(l.result) : l.error));
		const second = engine.parseDocument(doc).lines.map((l) => (l.result ? formatValue(l.result) : l.error));
		expect(second).toEqual(first);
	});
});

describe("what still sees the real token stream", () => {
	test("a diagnostics collector: the lexer runs again so its events fire", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES, diagnostics: true });
		try {
			const lex = jest.spyOn(engine.getLexer(), "resetExpression");
			engine.evaluateLine(1, "1 + 2");
			engine.evaluateLine(1, "1 + 2");
			expect(lex).toHaveBeenCalledTimes(2);
		} finally {
			engine.clear();
		}
	});

	test("explainLine derives a cached expression from its tokens", () => {
		const engine = newTrackedEngine();
		expect(engine.evaluateExpression("2 + 3 * 4").toNumber()).toBe(14);
		const explanation = engine.explainLine("2 + 3 * 4");
		expect(explanation.result.toNumber()).toBe(14);
		expect(explanation.steps.length).toBeGreaterThan(0);
	});
});

describe("invalidation", () => {
	test("a changed user-unit definition recompiles the lines that use it", () => {
		const engine = newTrackedEngine();
		const first = engine.parseDocument("1 sprint = 2 weeks\n6 sprints in hours");
		expect(formatValue(first.lines[1].result!)).toBe("= 2,016 hours");
		const second = engine.parseDocument("1 sprint = 3 weeks\n6 sprints in hours");
		expect(formatValue(second.lines[1].result!)).toBe("= 3,024 hours");
	});

	test("a snapshot restore takes the full front half once, then the cache", () => {
		const source = newTrackedEngine();
		source.parseDocument(":a = 2\na * 3");
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(source.toJSON())), { packages: BUILTIN_PACKAGES });
		try {
			const lex = jest.spyOn(restored.getLexer(), "resetExpression");
			expect(restored.evaluateExpression("a * 3").toNumber()).toBe(6);
			expect(lex).toHaveBeenCalledTimes(1);
			expect(restored.evaluateExpression("a * 3").toNumber()).toBe(6);
			expect(lex).toHaveBeenCalledTimes(1);
		} finally {
			restored.clear();
		}
	});
});
