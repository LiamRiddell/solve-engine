/**
 * A goal seek finishes, whatever its target is.
 *
 * Goal seek reads its target as an exact rational, and an ordinary
 * floating-point sum is not a tidy one: `0.1 + 0.2` is `0.30000000000000004`,
 * whose denominator is around 10^17. `rationalRoots` then reached for the
 * rational-root theorem, which starts by trial-dividing both coefficients to
 * their square roots: about 1.7 billion candidates.
 *
 * A six-line document froze for 12.5 seconds on that and then refused; a
 * subnormal target never came back at all. The work is one synchronous loop, so
 * no timeout, watchdog or test deadline could interrupt it, and the incremental
 * path is the one a live editor drives on every keystroke.
 *
 * Two things fixed it, and the first is why the answers here are better rather
 * than merely faster: a line has one root and it is closed form, so degree one
 * never enters the search at all. The candidate cap is the backstop for
 * everything above it.
 */
import { describe, expect, test } from "@jest/globals";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * A bound with room to spare. Every document here answers in single-digit
 * milliseconds; the shapes this guards against took seconds or never returned,
 * so any regression fails this by three orders of magnitude.
 */
const BUDGET_MS = 2000;

/** Evaluate a document and return its last line's display and elapsed time. */
function lastLine(source: string[]): { display: string; elapsedMs: number } {
	const engine = newTrackedEngine();
	const started = process.hrtime.bigint();
	try {
		const parsed = evaluateDocument(engine, source.join("\n"));
		const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
		const result = parsed.lines[parsed.lines.length - 1]?.result;
		if (result === null || result === undefined) return { display: "(none)", elapsedMs };
		// An error Value carries its message in `unit` and its code in `value`.
		const display = result.type === 8 ? String(result.unit) : String(result.value);
		return { display, elapsedMs };
	} finally {
		engine.clear();
	}
}

describe("a target that is an untidy float", () => {
	test("read across lines with total above", () => {
		// 12,584 ms and a refusal before: the sum is 0.30000000000000004.
		const { display, elapsedMs } = lastLine([
			":x = 1", "x * 2 + 10", "", "0.1", "0.2", "solve line 2 for x = total above",
		]);
		expect(display).toBe("-4.85");
		expect(elapsedMs).toBeLessThan(BUDGET_MS);
	});

	test("read across lines with prev", () => {
		// 7,000 ms and a refusal before: 1.1 + 2.2 is 3.3000000000000003.
		const { display, elapsedMs } = lastLine([":x = 1", "x * 2 + 10", "1.1 + 2.2", "solve line 2 for x = prev"]);
		expect(display).toBe("-3.35");
		expect(elapsedMs).toBeLessThan(BUDGET_MS);
	});

	test("a repeating decimal keeps the answer it always gave", () => {
		// This one did answer before, after 7,944 ms. The answer must not move:
		// it is negative, so only the exact route finds it.
		const { display, elapsedMs } = lastLine([":x = 1", "x * 2 + 10", "1 / 3", "solve line 2 for x = prev"]);
		expect(display).toBe("-4.833333333333334");
		expect(elapsedMs).toBeLessThan(BUDGET_MS);
	});

	test("a subnormal target, which never returned at all", () => {
		const { display, elapsedMs } = lastLine([":x = 1", "x * 2 + 10", "1e-320", "solve line 2 for x = prev"]);
		expect(display).toBe("-5");
		expect(elapsedMs).toBeLessThan(BUDGET_MS);
	});

	test("and money, which reaches the same float", () => {
		const { display, elapsedMs } = lastLine([
			":x = 1", "x * 2 + 10", "", "$0.10", "$0.20", "solve line 2 for x = total above",
		]);
		expect(display).toBe("-4.85");
		expect(elapsedMs).toBeLessThan(BUDGET_MS);
	});
});

describe("the answers that were already right are unchanged", () => {
	test("a tidy linear target", () => {
		expect(lastLine([":x = 1", "x * 2 + 10", "solve line 2 for x = 30"]).display).toBe("10");
		expect(lastLine([":x = 1", "x * 3 + 7", "solve line 2 for x = 22"]).display).toBe("5");
	});

	test("a quadratic, which still goes through the rational-root search", () => {
		expect(lastLine([":x = 1", "x * x - 4", "solve line 2 for x = 0"]).display).toBe("2");
	});

	test("a quadratic with an untidy target still finishes", () => {
		// Degree two has no closed form here, so this is the candidate cap doing
		// the work rather than the linear shortcut.
		const { elapsedMs } = lastLine([":x = 1", "x * x + 1", "", "0.1", "0.2", "solve line 2 for x = total above"]);
		expect(elapsedMs).toBeLessThan(BUDGET_MS);
	});
});
