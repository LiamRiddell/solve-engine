/**
 * `frozen`: a line that keeps the answer it had, with its date (issue #512).
 *
 * `10 USD in GBP frozen` answers with the rate of the moment it first settles,
 * and from then on with that same amount, on every path that evaluates a line
 * and across a snapshot restore, without reading a rate or making a request.
 * `... frozen on <day>` names the day, so an engine holding no value frozen that
 * day refuses the line by name rather than freezing a new one.
 *
 * Every rate here is primed and every fetch a stub, and the engine's clock is
 * pinned (the calendar backend's `now`), so the freeze dates are fixed. The
 * instants sit early in the UTC day so the calendar day is the same in every
 * zone the temporal run proves (London, New York, Auckland).
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { RecordingCalendar } from "@tools/recordingCalendar";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createCryptoPackage } from "@solve-js/packages/crypto";
import { currencyExchangeService } from "@solve-js/uom/CurrencyExchange";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, EvalTier } from "@solve-js/engine/ThreeTierEvaluator";
import { executeBytecode } from "@solve-js/vm/VM";
import { serializeValue } from "@solve-js/worker/serialize";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ValueType, type Value } from "@solve-js/vm/Value";
import type { EngineOptions } from "@solve-js/engine/ExpressionEngine";
import type { ValueSource } from "@solve-js/vm/Provenance";

const PUBLISHED = Date.parse("2026-09-23T05:00:00Z");
const DAY_ONE = Date.parse("2026-09-23T06:00:00Z");
const DAY_TWO = Date.parse("2026-09-24T06:00:00Z");

/** A calendar whose clock the test moves. */
class ClockCalendar extends RecordingCalendar {
	at: number;
	constructor(at: number) {
		super(at);
		this.at = at;
	}
	now(): number {
		return this.at;
	}
}

afterEach(() => {
	currencyExchangeService.clearRates();
});

function primeBank(gbp: number): void {
	currencyExchangeService.primeRates("USD", { GBP: gbp, EUR: 0.9 }, { provider: "Test Bank", publishedAt: PUBLISHED });
}

const bankRecord = (subject: string, frozenAt?: number): ValueSource => {
	const record: ValueSource = { provider: "Test Bank", kind: "primed", fetchedAt: PUBLISHED, subject };
	return frozenAt === undefined ? record : { ...record, frozenAt };
};

function clockEngine(at: number, options: EngineOptions = {}): { engine: ExpressionEngine; clock: ClockCalendar } {
	const clock = new ClockCalendar(at);
	const engine = newTrackedEngine({ ...options, calendar: clock });
	// A host listens for landed values; so do these engines, so a value landing
	// after a test is not reported as unheard.
	engine.getBatcher().onLineResult = () => undefined;
	return { engine, clock };
}

function text(v: Value | null | undefined): string {
	return v ? formatValue(v).replace(/^=\s*/, "") : "(none)";
}

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("a frozen line keeps its first settled answer", () => {
	test("the answer, its date and its key are kept, and a later rate does not move it", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		const first = engine.evaluateLine(1, "10 USD in GBP frozen");
		expect(text(first)).toBe("£7.41");
		expect(first.frozen).toEqual({ at: DAY_ONE, key: "10 USD in GBP" });
		expect(first.sources).toEqual([bankRecord("USD/GBP", DAY_ONE)]);

		primeBank(0.8);
		const again = engine.evaluateLine(1, "10 USD in GBP frozen");
		expect(text(again)).toBe("£7.41");
		expect(again.frozen).toEqual({ at: DAY_ONE, key: "10 USD in GBP" });
		// The same line without the suffix follows the rate, as it always did.
		expect(text(engine.evaluateLine(2, "10 USD in GBP"))).toBe("£8.00");
	});

	test("a line computed from a frozen answer carries its stamped sources, but is not itself marked frozen", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		engine.evaluateLine(1, ":rate = 1 USD in GBP frozen");
		primeBank(0.8);
		const derived = engine.evaluateLine(2, "rate * 100");
		expect(text(derived)).toBe("£74.10");
		expect(derived.sources).toEqual([bankRecord("USD/GBP", DAY_ONE)]);
		expect(derived.frozen).toBeUndefined();
	});

	test("a frozen definition sets its variable from the stored answer on every later evaluation", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		engine.evaluateLine(1, ":rate = 1 USD in GBP frozen");
		primeBank(0.8);
		engine.evaluateLine(1, ":rate = 1 USD in GBP frozen");
		expect(text(engine.getVM().getVar("rate"))).toBe("£0.74");
	});

	test("the key is the expression as written, so spacing does not make a second answer", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		engine.evaluateLine(1, "10 USD in GBP frozen");
		primeBank(0.8);
		expect(text(engine.evaluateLine(2, "10  USD in   GBP frozen"))).toBe("£7.41");
		expect(engine.getFrozenValues().map((r) => r.key)).toEqual(["10 USD in GBP"]);
	});

	test("any settled answer can be frozen, a date relative to today included", () => {
		const { engine, clock } = clockEngine(DAY_ONE);
		const sum = engine.evaluateLine(1, "(2 + 2) frozen");
		expect(text(sum)).toBe("4");
		expect(sum.frozen?.key).toBe("(2 + 2)");
		const today = engine.evaluateLine(2, "today frozen").toNumber();
		clock.at = DAY_TWO;
		expect(engine.evaluateLine(2, "today frozen").toNumber()).toBe(today);
		expect(engine.evaluateLine(3, "today").toNumber()).not.toBe(today);
	});
});

describe("an answer is frozen only once it settles", () => {
	test("a pending line is not frozen; the answer that lands is, by the batcher's own re-run", async () => {
		let release: (price: { price: number }) => void = () => undefined;
		const fetchPrice = jest.fn(() => new Promise<{ price: number }>((resolve) => { release = resolve; }));
		const crypto = createCryptoPackage({ fetchPrice, provider: "Test Exchange" });
		const { engine } = clockEngine(DAY_ONE, { packages: [...BUILTIN_PACKAGES, crypto] });
		// The batcher's re-run reads the query cache through the client the
		// engine last ran a line with, so an ordinary line runs first, as one
		// does in any real document.
		engine.evaluateLine(2, "1 + 1");

		expect(engine.evaluateLine(1, 'crypto("BTC") frozen').type).toBe(ValueType.Pending);
		expect(engine.getFrozenValues()).toHaveLength(0);

		release({ price: 60_000 });
		await settle();
		// Recorded before the host re-evaluates anything: the batcher re-ran the
		// line's program when the price landed, and that run froze it.
		expect(engine.getFrozenValues().map((r) => r.key)).toEqual(['crypto("BTC")']);
		const v = engine.evaluateLine(1, 'crypto("BTC") frozen');
		expect(text(v)).toBe("$60,000.00");
		expect(v.frozen?.at).toBe(DAY_ONE);
		expect(v.sources?.[0]).toMatchObject({ provider: "Test Exchange", kind: "live", subject: "BTC", frozenAt: DAY_ONE });
		expect(fetchPrice).toHaveBeenCalledTimes(1);
	});

	test("once frozen, a line stops being refreshed in the background, so nothing more is fetched for it", async () => {
		const fetchPrice = jest.fn(async () => ({ price: 60_000 }));
		const crypto = createCryptoPackage({ fetchPrice, refetchIntervalMs: 10 });
		const { engine } = clockEngine(DAY_ONE, {
			packages: [...BUILTIN_PACKAGES, crypto],
			config: { backgroundRefresh: { enabled: true } },
		});
		engine.evaluateLine(1, 'crypto("BTC") frozen');
		expect(engine.getBackgroundRefreshCount()).toBe(1);
		await settle();
		engine.evaluateLine(1, 'crypto("BTC") frozen');
		expect(engine.getFrozenValues()).toHaveLength(1);
		const fetchedWhenFrozen = fetchPrice.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 80));
		// The refresh noticed no line reads the price any more, and stopped
		// without fetching again.
		expect(engine.getBackgroundRefreshCount()).toBe(0);
		expect(fetchPrice.mock.calls.length).toBe(fetchedWhenFrozen);
	});

	test("a failed line is not frozen, so it can still freeze once it succeeds", () => {
		const { engine } = clockEngine(DAY_ONE, { config: { network: { enabled: false } } });
		const failed = engine.evaluateLine(1, "10 USD in GBP frozen");
		expect(failed.type).toBe(ValueType.Error);
		expect(failed.errorCode).toBe("NETWORK_DISABLED");
		expect(engine.getFrozenValues()).toHaveLength(0);

		primeBank(0.741);
		expect(text(engine.evaluateLine(1, "10 USD in GBP frozen"))).toBe("£7.41");
		expect(engine.getFrozenValues()).toHaveLength(1);
	});
});

describe("a line that names its day", () => {
	test("freezes when the day is today and nothing is stored", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		const v = engine.evaluateLine(1, "10 USD in GBP frozen on 2026-09-23");
		expect(text(v)).toBe("£7.41");
		expect(engine.getFrozenValues()[0].day).toBe("2026-09-23");
	});

	test("reads the value frozen that day, however the line was written when it was frozen", () => {
		primeBank(0.741);
		const { engine, clock } = clockEngine(DAY_ONE);
		engine.evaluateLine(1, "10 USD in GBP frozen");
		clock.at = DAY_TWO;
		primeBank(0.8);
		expect(text(engine.evaluateLine(1, "10 USD in GBP frozen on 2026-09-23"))).toBe("£7.41");
	});

	test("is refused by name, and not run, when no value frozen that day is stored", () => {
		const fetchPrice = jest.fn(async () => ({ price: 60_000 }));
		const crypto = createCryptoPackage({ fetchPrice });
		const { engine } = clockEngine(DAY_TWO, { packages: [...BUILTIN_PACKAGES, crypto] });
		const v = engine.evaluateLine(1, 'crypto("BTC") frozen on 2026-09-23');
		expect(v.type).toBe(ValueType.Error);
		expect(v.errorCode).toBe("FROZEN_VALUE_MISSING");
		expect(v.errorMessage).toBe(
			'This line was frozen on 2026-09-23, but no value frozen that day is stored in this engine. A frozen value is never fetched again: restore the snapshot or frozen values it was saved with, or remove "on 2026-09-23" to freeze it anew.',
		);
		// Neither the preflight nor the program ran, so nothing was asked for.
		expect(fetchPrice).not.toHaveBeenCalled();
	});

	test("is refused, naming both days, when the stored value was frozen on another day", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_TWO);
		engine.evaluateLine(1, "10 USD in GBP frozen");
		const v = engine.evaluateLine(1, "10 USD in GBP frozen on 2026-09-23");
		expect(v.errorCode).toBe("FROZEN_VALUE_MISSING");
		expect(v.errorMessage).toContain("the value stored for it was frozen on 2026-09-24");
	});

	test.each([
		["2 + 2 frozen on 2026-02-30", "DATE_NOT_A_CALENDAR_DAY"],
		["2 + 2 frozen on tuesday", "FROZEN_DATE_EXPECTED"],
		["2 + 2 frozen on", "FROZEN_DATE_EXPECTED"],
	])("%s is refused by name rather than read as a line with no day", (line, code) => {
		const { engine } = clockEngine(DAY_ONE);
		let caught: unknown;
		try {
			engine.evaluateLine(1, line);
		} catch (e) {
			caught = e;
		}
		expect((caught as { code?: string }).code).toBe(code);
		expect(engine.getFrozenValues()).toHaveLength(0);
	});
});

describe("what frozen does not change", () => {
	test("a variable called frozen is still multiplied when the * is written", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, ":frozen = 3");
		expect(text(engine.evaluateLine(2, "2 * frozen"))).toBe("6");
		expect(text(engine.evaluateLine(3, "frozen + 1"))).toBe("4");
		expect(engine.getFrozenValues()).toHaveLength(0);
	});

	test.each([
		["f(x) = 2x frozen", /function definition/],
		["global :shared = 5 frozen", /global cell/],
	])("%s is refused by name", (line, message) => {
		const engine = newTrackedEngine();
		let caught: unknown;
		try {
			engine.evaluateLine(1, line);
		} catch (e) {
			caught = e;
		}
		expect((caught as { code?: string }).code).toBe("FROZEN_UNSUPPORTED");
		expect(String((caught as Error).message)).toMatch(message);
	});
});

describe("every path that runs a line answers from the store", () => {
	const doc = ["10 USD in GBP frozen", "line 1 * 3", ":rate = 1 USD in GBP frozen", "rate * 100", "10 USD in GBP"].join("\n");

	function answers(result: { lines: { result: Value | null }[] }): string[] {
		return result.lines.map((l) => text(l.result));
	}

	test("parseDocument and evaluateDocument agree, before and after the rate moves", () => {
		primeBank(0.741);
		const { engine: batch } = clockEngine(DAY_ONE);
		const { engine: incremental } = clockEngine(DAY_ONE);
		const expected = ["£7.41", "£22.23", "£0.74", "£74.10", "£7.41"];
		expect(answers(batch.parseDocument(doc))).toEqual(expected);
		expect(answers(evaluateDocument(incremental, doc))).toEqual(expected);

		primeBank(0.8);
		const moved = ["£7.41", "£22.23", "£0.74", "£74.10", "£8.00"];
		expect(answers(batch.parseDocument(doc))).toEqual(moved);
		expect(answers(evaluateDocument(incremental, doc))).toEqual(moved);
	});

	test("a Tier 2 re-run from cached bytecode answers from the store too", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		const model = new DocumentModel();
		model.setDocument(doc);
		const evaluator = new ThreeTierEvaluator(model, engine);
		try {
			evaluator.evaluate({ startLine: 1, endLine: model.lineCount });
			primeBank(0.8);
			const second = evaluator.evaluate({ startLine: 1, endLine: model.lineCount });
			const first = second.lines.find((l) => l.lineNumber === 1)!;
			expect(first.tier).toBe(EvalTier.Tier2);
			expect(text(first.result)).toBe("£7.41");
			expect(first.result?.frozen?.key).toBe("10 USD in GBP");
		} finally {
			evaluator.terminateWorker();
		}
	});

	test("a probe under a bound call frame, as goal seek runs, answers live and freezes nothing", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		const { program } = engine.compileExpression("10 USD in GBP frozen");
		expect(program.frozen).toEqual({ key: "10 USD in GBP" });
		const vm = engine.getVM();
		vm.pushCallFrame(new Map());
		try {
			const probe = executeBytecode(program, vm);
			expect(probe.type).toBe("value");
			expect((probe as { value: Value }).value.frozen).toBeUndefined();
		} finally {
			vm.popCallFrame();
		}
		expect(engine.getFrozenValues()).toHaveLength(0);
		const real = executeBytecode(program, vm);
		expect((real as { value: Value }).value.frozen?.key).toBe("10 USD in GBP");
	});

	test("explaining a line does not freeze it, and explaining a frozen line says so", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		engine.explainLine("10 USD in GBP frozen");
		expect(engine.getFrozenValues()).toHaveLength(0);
		engine.evaluateLine(1, "10 USD in GBP frozen");
		const steps = engine.explainLine("10 USD in GBP frozen").steps.map((s) => s.description);
		expect(steps).toEqual([
			"Frozen 2026-09-23 06:00 UTC: this answer is kept, not fetched again",
			"USD/GBP from Test Bank (supplied by the host), fetched 2026-09-23 05:00 UTC, frozen 2026-09-23 06:00 UTC",
		]);
	});
});

describe("a snapshot keeps frozen answers, and a restored document reads them with no network", () => {
	const doc = ["10 USD in GBP frozen", ":rate = 1 USD in GBP frozen", "rate * 100", "10 USD in GBP frozen on 2026-09-23"].join("\n");

	test("the answers, their dates and the lines that hold them are carried, and read back without a rate", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		engine.parseDocument(doc);
		const snapshot = JSON.parse(JSON.stringify(engine.toJSON()));
		expect(snapshot.frozen.map((r: { key: string; day: string }) => `${r.key} @ ${r.day}`)).toEqual([
			"10 USD in GBP @ 2026-09-23",
			":rate = 1 USD in GBP @ 2026-09-23",
		]);
		// The frozen lines, and the variable one defines, are carried rather than
		// dropped as async lines are.
		expect(snapshot.lineCache.map((e: { line: number }) => e.line)).toEqual(expect.arrayContaining([1, 2]));
		expect(Object.keys(snapshot.variables)).toContain("rate");

		currencyExchangeService.clearRates();
		const restored = ExpressionEngine.fromJSON(snapshot, {
			packages: BUILTIN_PACKAGES,
			calendar: new ClockCalendar(DAY_TWO),
			config: { network: { enabled: false } },
		});
		try {
			expect(text(restored.getVM().getVar("rate"))).toBe("£0.74");
			expect(restored.parseDocument(doc).lines.map((l) => text(l.result))).toEqual(["£7.41", "£0.74", "£74.10", "£7.41"]);
			const first = restored.parseDocument(doc).lines[0].result!;
			expect(first.frozen).toEqual({ at: DAY_ONE, key: "10 USD in GBP" });
			expect(first.sources).toEqual([bankRecord("USD/GBP", DAY_ONE)]);
		} finally {
			restored.clear();
		}
	});

	test("a restored frozen price is not fetched again", async () => {
		const fetchPrice = jest.fn(async () => ({ price: 60_000 }));
		const { engine } = clockEngine(DAY_ONE, { packages: [...BUILTIN_PACKAGES, createCryptoPackage({ fetchPrice })] });
		engine.evaluateLine(1, 'crypto("BTC") frozen');
		await settle();
		// The host re-evaluates the line the event names, as the async guide
		// describes, and that evaluation freezes the landed price.
		engine.evaluateLine(1, 'crypto("BTC") frozen');
		expect(engine.getFrozenValues()).toHaveLength(1);
		const snapshot = JSON.parse(JSON.stringify(engine.toJSON()));

		const later = jest.fn(async () => ({ price: 99_000 }));
		const restored = ExpressionEngine.fromJSON(snapshot, { packages: [...BUILTIN_PACKAGES, createCryptoPackage({ fetchPrice: later })] });
		try {
			const v = restored.evaluateLine(1, 'crypto("BTC") frozen');
			expect(text(v)).toBe("$60,000.00");
			expect(later).not.toHaveBeenCalled();
		} finally {
			restored.clear();
		}
	});

	test("a document with no frozen line writes the snapshot it always did", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("2 + 2\n:x = 5");
		expect("frozen" in engine.toJSON()).toBe(false);
	});

	/** The parts of a parsed snapshot the corruptions below reach into. */
	type Corruptible = { frozen: { day: string; value: { src: { kind: string }[]; fz: unknown } }[] };

	test.each<[string, (s: Corruptible) => void, string]>([
		["a frozen answer whose day is not a day", (s) => { s.frozen[0].day = "23/09/2026"; }, "frozen[0]"],
		["a source whose kind is not one the engine records", (s) => { s.frozen[0].value.src[0].kind = "guess"; }, "frozen[0].value.src[0]"],
		["a frozen mark with no time", (s) => { s.frozen[0].value.fz = { key: "x" }; }, "frozen[0].value.fz"],
	])("is refused as malformed for %s", (_label, corrupt, where) => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		engine.parseDocument("10 USD in GBP frozen");
		const snapshot = JSON.parse(JSON.stringify(engine.toJSON()));
		corrupt(snapshot);
		expect(() => ExpressionEngine.fromJSON(snapshot, { packages: BUILTIN_PACKAGES })).toThrow(where);
	});
});

describe("the host controls the store", () => {
	test("unfreeze forgets one answer or all of them, and the line freezes afresh", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		const frozen = engine.evaluateLine(1, "10 USD in GBP frozen");
		engine.evaluateLine(2, "2 + 2 frozen");
		primeBank(0.8);
		expect(engine.unfreeze(frozen.frozen!.key)).toBe(1);
		expect(text(engine.evaluateLine(1, "10 USD in GBP frozen"))).toBe("£8.00");
		expect(engine.unfreeze()).toBe(2);
		expect(engine.getFrozenValues()).toHaveLength(0);
	});

	test("clear() drops the document's frozen answers with the rest of its state", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		engine.evaluateLine(1, "10 USD in GBP frozen");
		engine.clear();
		expect(engine.getFrozenValues()).toHaveLength(0);
	});

	test("the worker DTO carries the frozen mark as plain data", () => {
		primeBank(0.741);
		const { engine } = clockEngine(DAY_ONE);
		const dto = serializeValue(engine.evaluateLine(1, "10 USD in GBP frozen"));
		expect(dto.frozen).toEqual({ at: DAY_ONE, key: "10 USD in GBP" });
		expect(dto.sources).toEqual([bankRecord("USD/GBP", DAY_ONE)]);
		expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
	});
});
