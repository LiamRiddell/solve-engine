import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import {
	createLinkedTransports,
	createWorkerEngine,
	startWorkerRuntime,
	type WorkerEngineOptions,
	type WorkerRuntimeOptions,
} from "@solve-js/worker";
import { dateCalendarInZone, DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { FormattingOverrides } from "@solve-js/format/FormattingSettings";

/**
 * Issue #827: the worker runtime wrote its results with the free
 * `formatValue` and the default settings, so a result that crossed the
 * worker boundary was written in `en-US` numbers (and, with no calendar baked
 * in, the `Date` backend's zone) even when the engine behind it was built with
 * another locale or calendar. The runtime now writes each DTO's text with the
 * worker engine's own settings (`engine.getFormattingSettings`), the host's
 * `formatting` merged over them, so a worker result reads exactly as the same
 * engine's `formatValue` writes it on the main thread.
 */

const AT = Date.UTC(2026, 8, 25, 14, 24, 57);

/** A client and runtime linked on one thread, as the worker harness builds them. */
async function withWorker<T>(
	options: Partial<WorkerEngineOptions>,
	runtime: WorkerRuntimeOptions,
	body: (engine: Awaited<ReturnType<typeof createWorkerEngine>>) => Promise<T>,
): Promise<T> {
	const { client, host } = createLinkedTransports();
	const stop = startWorkerRuntime(host, runtime);
	const engine = await createWorkerEngine({ transport: client, ...options });
	try {
		return await body(engine);
	} finally {
		engine.terminate();
		stop();
	}
}

describe("a worker result reads as the same engine's formatValue writes it", () => {
	test("a de-DE engine behind the worker writes €1.250,00", async () => {
		const main = newTrackedEngine({ locale: "de-DE", calendar: DATE_CALENDAR });
		const expected = main.formatValue(main.evaluateExpression("€1250"));
		expect(expected).toBe("= €1.250,00");
		await withWorker({ localeCode: "de-DE" }, { calendar: DATE_CALENDAR }, async (worker) => {
			expect((await worker.evaluateExpression("€1250")).text).toBe(expected);
			const lines = await worker.evaluateLines(["€1250", "1250"]);
			expect(lines.map((l) => l.result?.text)).toEqual(["= €1.250,00", "= 1.250"]);
			const doc = await worker.parseDocument("€1250\n€1250 * 2");
			expect(doc.lines.map((l) => l.result?.text)).toEqual(["= €1.250,00", "= €2.500,00"]);
		});
	});

	test("a zoned calendar's date is written in its zone", async () => {
		const calendar = dateCalendarInZone("Pacific/Kiritimati", { now: () => AT });
		const main = newTrackedEngine({ calendar });
		await withWorker({}, { calendar }, async (worker) => {
			for (const line of ["next friday", "today", "3 October 2026"]) {
				expect({ line, text: (await worker.evaluateExpression(line)).text })
					.toEqual({ line, text: main.formatValue(main.evaluateExpression(line)) });
			}
			expect((await worker.evaluateExpression("next friday")).text).toBe("= Friday, October 2, 2026, 4:24:57 AM");
		});
	});

	test("the host's formatting is merged over the engine's, group by group", async () => {
		const calendar = dateCalendarInZone("Pacific/Kiritimati", { now: () => AT });
		await withWorker({ localeCode: "de-DE", formatting: { dateResult: { format: "iso" } } }, { calendar }, async (worker) => {
			// The date format is the host's, the zone and the number locale the engine's.
			const main = newTrackedEngine({ locale: "de-DE", calendar });
			expect((await worker.evaluateExpression("2026-10-03")).text).toBe(main.formatValue(main.evaluateExpression("2026-10-03"), { dateResult: { format: "iso" } }));
			expect((await worker.evaluateExpression("€1250")).text).toBe("= €1.250,00");
		});
	});

	test("a complete settings object from the host wins every group it names, as before", async () => {
		const formatting = {
			floatResult: { decimalPlaces: 0, enableSeperator: false },
			numberResult: { decimalSeparatorLocale: "en-US" },
			hexResult: { enablePadding: false, paddingZeros: 0 },
			unitOfMeasurementResult: { decimalPlaces: 0 },
			percentageResult: { decimalPlaces: 0 },
		};
		await withWorker({ localeCode: "de-DE", formatting }, { calendar: DATE_CALENDAR }, async (worker) => {
			const value = newTrackedEngine({ locale: "de-DE", calendar: DATE_CALENDAR }).evaluateExpression("€1250");
			expect((await worker.evaluateExpression("€1250")).text).toBe(formatValue(value, { ...formatting, calendar: DATE_CALENDAR }));
		});
	});
});

describe("adversarial", () => {
	test("security: prototype words as formatting groups cross the boundary and change nothing", async () => {
		const formatting = Object.fromEntries(PROTOTYPE_WORDS.filter((w) => w !== "__proto__").map((w) => [w, { decimalPlaces: 9 }])) as FormattingOverrides;
		await withWorker({ formatting }, { calendar: DATE_CALENDAR }, async (worker) => {
			const before = Object.getOwnPropertyNames(Object.prototype).sort();
			expect((await worker.evaluateExpression("1.5")).text).toBe("= 1.50");
			expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
		});
	});

	test("realistic breakage: a locale the engine has no pack for, and one Intl cannot read, fall back to en-US numbers", async () => {
		for (const localeCode of ["xx", "__proto__"]) {
			await withWorker({ localeCode }, { calendar: DATE_CALENDAR }, async (worker) => {
				expect((await worker.evaluateExpression("1250.5")).text).toBe("= 1,250.50");
			});
		}
	});

	test("edge cases: a worker with no calendar baked in writes as a main-thread engine with none", async () => {
		const main = newTrackedEngine();
		await withWorker({}, {}, async (worker) => {
			for (const line of ["3 October 2026", "0.1 + 0.2", "-0", "25%"]) {
				expect({ line, text: (await worker.evaluateExpression(line)).text })
					.toEqual({ line, text: main.formatValue(main.evaluateExpression(line)) });
			}
		});
	});
});
