/**
 * A line that does not parse is remembered, and its next evaluation skips
 * lexing, normalising and the throwing parse.
 *
 * A line being typed does not parse for most of its life, and every
 * re-evaluation of the document (each keystroke elsewhere) lexed, normalised
 * and re-parsed it, paying for the throw each time. The front half's output
 * and the error are now remembered beside the compiled programs.
 *
 * What is pinned: the skip really happens; the error is the same on the hit
 * as on the miss; a whole-document pass re-parses nothing the second time;
 * the effectful forms that read the VM still run on a hit; a vocabulary
 * change forgets every remembered failure; and a diagnostics
 * collector still sees the normaliser's fusion events on a repeated
 * evaluation, which the compiled cache's early return had been skipping.
 */

import { describe, expect, jest, test } from "@jest/globals";
import { DiagnosticCollector } from "@solve-js/diagnostics/collector";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { newTrackedEngine } from "@tools/trackedEngine";

const failure = (engine: ExpressionEngine, expression: string): EngineError => {
	try {
		engine.evaluateExpression(expression);
	} catch (thrown) {
		return thrown as EngineError;
	}
	throw new Error(`${expression} was expected to fail`);
};

describe("the second evaluation of a line that does not parse", () => {
	test("does not lex, normalise or parse it again", () => {
		const engine = newTrackedEngine();
		const lex = jest.spyOn(engine.getLexer(), "resetExpression");
		const normalise = jest.spyOn(engine.getNormalizer(), "normalize");
		const parse = jest.spyOn(engine.getParser(), "parseExpression");

		expect(failure(engine, "(1 + 2 * ").code).toBe("UNEXPECTED_END_OF_INPUT");
		const once = [lex.mock.calls.length, normalise.mock.calls.length, parse.mock.calls.length];
		expect(once.every((n) => n > 0)).toBe(true);

		expect(failure(engine, "(1 + 2 * ").code).toBe("UNEXPECTED_END_OF_INPUT");
		expect([lex.mock.calls.length, normalise.mock.calls.length, parse.mock.calls.length]).toEqual(once);
	});

	test("reports the same error", () => {
		const engine = newTrackedEngine();
		const first = failure(engine, "2 +* 3");
		const second = failure(engine, "2 +* 3");
		expect(second.code).toBe(first.code);
		expect(second.message).toBe(first.message);
	});

	test("a whole-document pass re-parses nothing the second time", () => {
		const engine = newTrackedEngine();
		const doc = "1 + 2\n(3 + \n:x = 4\nx * 2";
		const first = engine.parseDocument(doc);
		expect(first.lines[1].error).toBeDefined();

		const parse = jest.spyOn(engine.getParser(), "parseExpression");
		const second = engine.parseDocument(doc);
		expect(parse).not.toHaveBeenCalled();
		expect(second.lines[1].error).toBe(first.lines[1].error);
		expect(second.lines[3].result?.toNumber()).toBe(8);
	});
});

describe("what a hit still runs, and what clears the memory", () => {
	test("the effectful forms, which read the VM, run again", () => {
		// `total =` throws from inside the symbolic grammar, ahead of the main
		// parse, so it is never remembered: those forms read the VM (a stored
		// equation, a running total) and their answer can change between one
		// evaluation and the next.
		const engine = newTrackedEngine();
		const normalise = jest.spyOn(engine.getNormalizer(), "normalize");
		failure(engine, "total =");
		const once = normalise.mock.calls.length;
		failure(engine, "total =");
		expect(normalise.mock.calls.length).toBeGreaterThan(once);
	});

	test("a vocabulary change forgets it: the line is lexed and parsed again", () => {
		// Whether a late registration makes a given line parse is the package's
		// business; what is pinned here is that the memory does not outlive the
		// vocabulary it was made under, on either kind of change.
		const engine = newTrackedEngine();
		const lex = jest.spyOn(engine.getLexer(), "resetExpression");
		failure(engine, "(1 + 2 * ");
		failure(engine, "(1 + 2 * ");
		const remembered = lex.mock.calls.length;

		engine.unregisterPackage("solve-random");
		failure(engine, "(1 + 2 * ");
		expect(lex.mock.calls.length).toBe(remembered + 1);

		engine.evaluateExpression("1 sprint = 2 weeks");
		failure(engine, "(1 + 2 * ");
		expect(lex.mock.calls.length).toBe(remembered + 3);
	});
});

describe("diagnostics", () => {
	test("a collector sees the normaliser's fusions on a repeated evaluation", () => {
		class Fusions extends DiagnosticCollector {
			count = 0;
			onTokenFused(): void {
				this.count++;
			}
			getReport(): undefined {
				return undefined;
			}
			reset(): void {
				this.count = 0;
			}
		}
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES, diagnostics: true });
		try {
			const fusions = new Fusions();
			engine.getDiagnosticPipeline().register(fusions);
			engine.evaluateLine(1, "3 days 4 hours");
			const first = fusions.count;
			expect(first).toBeGreaterThan(0);
			engine.evaluateLine(1, "3 days 4 hours");
			expect(fusions.count).toBe(first * 2);
		} finally {
			engine.clear();
		}
	});
});
