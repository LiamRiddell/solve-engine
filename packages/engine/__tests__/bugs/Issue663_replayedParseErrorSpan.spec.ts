import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #663: the engine remembers a text whose parse failed and replays the
 * failure, and it replayed the error object first thrown, span included. So
 * `3 + * 4` failed on its own after a document had held it on line 4 reported
 * line 4 and offset 22. A replay now gets its own error, its span moved to
 * where the text is now.
 */

interface Thrown {
	code?: string;
	span?: { start: number; end: number; line?: number; col?: number };
}

function thrown(run: () => unknown): Thrown {
	try {
		run();
	} catch (error) {
		return error as Thrown;
	}
	throw new Error("expected a throw");
}

const STANDALONE = { start: 4, end: 5, line: 1, col: 5 };

describe("a replayed parse error carries the span for where the text is now", () => {
	test("standalone after a document held the same text", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("a = 1\nb = 2\nc = 3\n3 + * 4");
		const error = thrown(() => engine.evaluateExpression("3 + * 4"));
		expect(error.code).toBe("NO_PREFIX_PARSELET");
		expect(error.span).toEqual(STANDALONE);
		expect(thrown(() => engine.evaluateExpression("3 + * 4")).span).toEqual(STANDALONE);
	});

	test("the reverse order: standalone, then a document at line 40, then standalone again", () => {
		const engine = newTrackedEngine();
		expect(thrown(() => engine.evaluateExpression("3 + * 4")).span).toEqual(STANDALONE);
		engine.parseDocument([...Array.from({ length: 39 }, (_, i) => `x${i} = ${i}`), "3 + * 4"].join("\n"));
		expect(thrown(() => engine.evaluateExpression("3 + * 4")).span).toEqual(STANDALONE);
	});

	test("it matches what a fresh engine reports", () => {
		const fresh = thrown(() => newTrackedEngine().evaluateExpression("3 + * 4"));
		const engine = newTrackedEngine();
		engine.parseDocument("\n\n\n\n3 + * 4");
		const replayed = thrown(() => engine.evaluateExpression("3 + * 4"));
		expect(replayed.code).toBe(fresh.code);
		expect(replayed.span).toEqual(fresh.span);
	});
});

describe("adversarial: a host that holds on to the error", () => {
	test("mutating the thrown error does not change the next replay", () => {
		const engine = newTrackedEngine();
		const first = thrown(() => engine.evaluateExpression("3 + * 4"));
		(first as { span: unknown }).span = { start: 999, end: 999, line: 99, col: 99 };
		expect(thrown(() => engine.evaluateExpression("3 + * 4")).span).toEqual(STANDALONE);
	});

	test("each replay is its own error object", () => {
		const engine = newTrackedEngine();
		const a = thrown(() => engine.evaluateExpression("3 + * 4"));
		const b = thrown(() => engine.evaluateExpression("3 + * 4"));
		expect(a).not.toBe(b);
		expect(b.span).toEqual(a.span);
	});

	test("the document pass still reports the line's failure after a standalone replay", () => {
		const engine = newTrackedEngine();
		thrown(() => engine.evaluateExpression("3 + * 4"));
		const lines = engine.parseDocument("1\n3 + * 4").lines;
		expect(lines[1].error).toMatch(/No prefix parselet/);
	});
});
