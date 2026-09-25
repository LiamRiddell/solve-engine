import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #604: goal seek re-ran a sweep on every probe. A what-if refuses to
 * re-run a line holding another what-if or sweep, but goal seek was never
 * refused, so a goal-seek line over a 1,000-step sweep ran a thousand scratch
 * passes per probe: 12 s and 371 MB held for one line, 76 s and 2.2 GB for six.
 * A target holding a what-if or a sweep is now refused by name on the first
 * probe.
 */

const REFUSAL =
	"Goal seek cannot target a line that holds a what-if or a sweep, since every one of its probes would re-run the document again. Target a line without one.";

function lines(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		const v = line.result;
		if (v == null) return line.error ? `ERROR ${line.error}` : "";
		return v.isError() ? `ERROR ${String(v.errorMessage)}` : formatValue(v);
	});
}
const incremental = (text: string) => lines(evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text));

/** The incremental pass over `text`, with how long it took. */
function timed(text: string): { out: string[]; ms: number } {
	const started = Date.now();
	const out = incremental(text);
	return { out, ms: Date.now() - started };
}

describe("goal seek refuses a target that re-runs the document", () => {
	test("the survey's note: a 1,000-step sweep under 70 lines, refused in well under a second's work", () => {
		const above = Array.from({ length: 70 }, (_, i) => `:c${i + 1} = ${i + 1}`).join("\n");
		const text = `${above}\n:k = 1\n:x = 1\nx * 2\nround(sum(x, line 73 for x from 1 to 1000 step 1) * k)\nsolve line 74 for k = 3000.5`;
		const { out, ms } = timed(text);
		expect(out[73]).toBe("= 1,001,000");
		expect(out[74]).toBe(`ERROR ${REFUSAL}`);
		// 12,166 ms before; the one sweep line itself is most of what is left.
		expect(ms).toBeLessThan(5_000);
	});

	test("a target the algebra could invert is refused too, so the refusal does not depend on the line's shape", () => {
		const out = incremental(":k = 1\n:x = 1\nx * 2\nsum(x, line 3 for x from 1 to 1000 step 1) * k\nsolve line 4 for k = 2002000");
		expect(out[4]).toBe(`ERROR ${REFUSAL}`);
	});

	test("a single what-if on the target is refused for the same reason", () => {
		const out = incremental(":k = 1\n:x = 1\nx * 2\n(line 3 with x = 5) * k\nsolve line 4 for k = 30");
		expect(out[3]).toBe("= 10");
		expect(out[4]).toBe(`ERROR ${REFUSAL}`);
	});
});

describe("adversarial: every way a re-run can sit on the target", () => {
	test("a sweep nested inside a function call", () => {
		const out = incremental(":k = 1\n:x = 1\nx * 2\nabs(sum(x, line 3 for x from 1 to 5 step 1)) * k\nsolve line 4 for k = 5");
		expect(out[4]).toBe(`ERROR ${REFUSAL}`);
	});

	test("two goal-seek lines on one target each refuse, and quickly", () => {
		const { out, ms } = timed(":k = 1\n:x = 1\nx * 2\nround(sum(x, line 3 for x from 1 to 1000 step 1) * k)\nsolve line 4 for k = 3000.5\nsolve line 4 for k = 5");
		expect(out[4]).toBe(`ERROR ${REFUSAL}`);
		expect(out[5]).toBe(`ERROR ${REFUSAL}`);
		// 22,179 ms before.
		expect(ms).toBeLessThan(5_000);
	});

	test("six goal-seek lines on one target stay bounded", () => {
		const seeks = Array.from({ length: 6 }, (_, i) => `solve line 4 for k = ${3000 + i}.5`).join("\n");
		const { out, ms } = timed(`:k = 1\n:x = 1\nx * 2\nround(sum(x, line 3 for x from 1 to 1000 step 1) * k)\n${seeks}`);
		expect(out.slice(4)).toEqual(Array(6).fill(`ERROR ${REFUSAL}`));
		// 75,921 ms and 2,232 MB held before.
		expect(ms).toBeLessThan(5_000);
	});

	test("the boundary: a target that reads a sweep line's stored answer still solves", () => {
		// Line 4 holds the sweep; line 5 only reads its answer, so a probe of line
		// 5 re-runs nothing.
		const out = incremental(":k = 1\n:x = 1\nx * 2\nsum(x, line 3 for x from 1 to 3 step 1)\nline 4 * k\nsolve line 5 for k = 24");
		expect(out[3]).toBe("= 12");
		expect(out[5]).toBe("= 2");
	});

	test("the boundary: an ordinary goal seek is unchanged", () => {
		const out = incremental(":deposit = 100000\n:rate = 4%\nmonthly repayment on deposit over 25 years at rate\nsolve line 3 for deposit = 900");
		expect(out[3]).toBe("= 170,507.23");
	});

	test("after the refusal the engine answers the next document normally", () => {
		const engine = newTrackedEngine();
		evaluateDocument(engine as unknown as ExpressionEngine, ":k = 1\n:x = 1\nx * 2\n(line 3 with x = 5) * k\nsolve line 4 for k = 30");
		const out = lines(evaluateDocument(engine as unknown as ExpressionEngine, ":x = 1\nx * 2\nline 2 with x = 5"));
		expect(out).toEqual(["= 1", "= 2", "= 10"]);
	});
});
