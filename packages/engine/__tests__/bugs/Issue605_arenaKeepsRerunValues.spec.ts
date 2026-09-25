import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ValueArena, ValueType, disableValueArena, enableValueArena, isArenaActive, withoutValueArena } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #605: the Value arena kept every Value an incremental pass created. It
 * is a scratch pool for scroll frames, but a what-if or sweep's scratch passes,
 * goal seek's probes and a table column's reads all ran inside the window
 * where it is on, so one 1,000-step sweep left 200,205 Values in it, five left
 * 1,000,229, and 1,000 column reads left 1,003,001, for as long as the note
 * stayed open. The re-runs now run unpooled, and the arena stops growing at
 * 16,384 Values.
 */

const CEILING = 16_384;

/** The arena's capacity after one incremental pass over `text`, read without the reset that would shrink it. */
function arenaAfter(text: string): { capacity: number; last: string } {
	const arena = enableValueArena();
	disableValueArena();
	const result = evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text);
	const line = result.lines[result.lines.length - 1];
	const last = line.result ? formatValue(line.result) : `ERROR ${line.error}`;
	return { capacity: arena.capacity, last };
}

const chain = [":a1 = 1", ...Array.from({ length: 99 }, (_, i) => `:a${i + 2} = a${i + 1} + 1`)].join("\n");
const sweep = "line 100 for a1 from 1 to 1000 step 1";

describe("ValueArena stops growing at its ceiling", () => {
	test("past the ceiling acquire still returns a correct Value", () => {
		const arena = new ValueArena(4);
		const values = Array.from({ length: CEILING + 500 }, (_, i) => arena.acquire(ValueType.Number, i));
		expect(arena.capacity).toBe(CEILING);
		expect(values[CEILING + 499].toNumber()).toBe(CEILING + 499);
		expect(values[CEILING - 1].toNumber()).toBe(CEILING - 1);
		// An unpooled Value is its own object, not a pooled one handed out twice.
		expect(new Set(values).size).toBe(values.length);
	});

	test("reset behaves as before: a lighter cycle gives the block back", () => {
		const arena = new ValueArena(8);
		for (let i = 0; i < 4_000; i++) arena.acquire(ValueType.Number, i);
		arena.reset();
		expect(arena.capacity).toBe(4_000);
		for (let i = 0; i < 100; i++) arena.acquire(ValueType.Number, i);
		arena.reset();
		expect(arena.capacity).toBe(200);
	});

	test("withoutValueArena turns the arena off for its work and puts it back", () => {
		enableValueArena();
		try {
			expect(withoutValueArena(() => isArenaActive())).toBe(false);
			expect(isArenaActive()).toBe(true);
			expect(() => withoutValueArena(() => { throw new Error("inside"); })).toThrow("inside");
			expect(isArenaActive()).toBe(true);
		} finally {
			disableValueArena();
		}
		expect(withoutValueArena(() => isArenaActive())).toBe(false);
		expect(isArenaActive()).toBe(false);
	});
});

describe("the survey's notes leave the arena small (evaluateDocument)", () => {
	test("A: one 1,000-step sweep", () => {
		const { capacity, last } = arenaAfter(`${chain}\n${sweep}`);
		expect(last.startsWith("= [100, 101, 102")).toBe(true);
		// 200,205 before.
		expect(capacity).toBeLessThan(4_096);
	});

	test("B: five 1,000-step sweeps", () => {
		const { capacity } = arenaAfter(`${chain}\n${Array(5).fill(sweep).join("\n")}`);
		// 1,000,229 before.
		expect(capacity).toBeLessThan(8_192);
	});

	test("C: 1,000 reads of a 1,000-row table column stop at the ceiling", () => {
		const rows = Array.from({ length: 1000 }, (_, i) => `| item${i} | ${i} |`).join("\n");
		const reads = Array(1000).fill('sum of column "cost" above').join("\n");
		const { capacity, last } = arenaAfter(`| item | cost |\n|---|---|\n${rows}\n\n${reads}`);
		expect(last).toBe("= 499,500");
		// 1,003,001 before.
		expect(capacity).toBe(CEILING);
	});
});

describe("adversarial: re-runs of every kind run unpooled, and answer as before", () => {
	test("a what-if with several inputs", () => {
		const { capacity, last } = arenaAfter(`${chain}\n:b = 2\na100 * b\n${Array(200).fill("line 102 with a1 = 5 and b = 3").join("\n")}`);
		expect(last).toBe("= 312");
		expect(capacity).toBeLessThan(2_048);
	});

	test("a goal seek's probes", () => {
		const { capacity, last } = arenaAfter(":deposit = 100000\n:rate = 4%\nmonthly repayment on deposit over 25 years at rate\nsolve line 3 for deposit = 900");
		expect(last).toBe("= 170,507.23");
		expect(capacity).toBe(512);
	});

	test("a sweep inside a what-if's target is refused as before, and pools nothing", () => {
		const { capacity, last } = arenaAfter(":x = 1\nx * 2\nline 2 for x from 1 to 3 step 1\nline 3 with x = 5");
		expect(last).toMatch(/^A what-if or sweep cannot run inside another one's re-run/);
		expect(capacity).toBe(512);
	});

	test("the incremental and batch passes agree on the sweep with the arena out of it", () => {
		const text = `${chain}\n${sweep}`;
		const incremental = evaluateDocument(newTrackedEngine() as unknown as ExpressionEngine, text).lines[100].result;
		const batch = newTrackedEngine().parseDocument(text).lines[100].result;
		expect(incremental && formatValue(incremental)).toBe(batch && formatValue(batch));
	});
});
