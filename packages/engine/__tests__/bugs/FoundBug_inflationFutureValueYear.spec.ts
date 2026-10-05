import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { RecordingCalendar } from "@tools/recordingCalendar";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import {
	Value,
	datetimeValue,
	errorValue,
	numberValue,
	pendingValue,
	percentageValue,
	stringValue,
	uomValue,
} from "@solve-js/vm/Value";
import { inflationFutureValueHandler } from "@solve-js/packages/finance/parselets/InflationPluginFunctions";

/**
 * Found bug: `value of $X in <year> assuming N% inflation` read its year for
 * its number whatever it was, so `in 2030.5` discounted over 4.5 years, and
 * `in $2030`, `in 2030 kg` and `in "2030"` were each the year 2030, every one
 * answered with a confident figure. The other inflation forms refuse such a
 * year with INFLATION_EXPECTED_YEAR (see FoundBug_inflationYear.spec.ts); this
 * one was left out because it states a rate rather than reading an index.
 *
 * Its year now goes through the same `inflationYear` guard: a plain whole
 * number, or the refusal that says what was given instead.
 */

/** 2026-03-11, noon UTC: the year every answer here is counted from. */
const NOW_2026 = Date.UTC(2026, 2, 11, 12, 0, 0);

/** An engine whose clock is stopped in 2026. */
function engine2026() {
	return newTrackedEngine({ calendar: new RecordingCalendar(NOW_2026, dateCalendarInZone("UTC")) });
}

/** One line on the 2026 clock: its code and message, or its answer. */
function outcome(line: string): string {
	try {
		const v = engine2026().evaluateExpression(line);
		if (v.isError()) return `${String(v.errorCode)}: ${String(v.errorMessage)}`;
		return formatValue(v).replace(/^=\s*/, "");
	} catch (e) {
		return e instanceof EngineError ? `THROWN ${e.code}: ${e.message}` : `CRASHED ${String(e)}`;
	}
}

/** Both document passes on the 2026 clock, each line's code or answer. */
function both(text: string): { batch: string[]; incremental: string[] } {
	const lines = (result: ReturnType<ReturnType<typeof newTrackedEngine>["parseDocument"]>): string[] =>
		result.lines.map((l) => {
			if (l.result == null) return l.error ? `ERROR ${String(l.errorCode)}` : "";
			if (l.result.isError()) return `ERROR ${String(l.result.errorCode)}`;
			return formatValue(l.result);
		});
	return { batch: lines(engine2026().parseDocument(text)), incremental: lines(evaluateDocument(engine2026(), text)) };
}

const A_YEAR_IS = "INFLATION_EXPECTED_YEAR: the year of an inflation question is a plain whole number, such as 1990";

describe("the lines that exposed it", () => {
	test("a year that is not a plain whole number is refused by name, through evaluateLine", () => {
		expect(outcome("value of $100 in 2030.5 assuming 3% inflation")).toBe(`${A_YEAR_IS}, and 2030.5 is not a whole number`);
		expect(outcome("value of $100 in $2030 assuming 3% inflation")).toBe(`${A_YEAR_IS}, and this one is money`);
		expect(outcome("value of $100 in 2030 kg assuming 3% inflation")).toBe(`${A_YEAR_IS}, and this one is a mass`);
		expect(outcome('value of $100 in "2030" assuming 3% inflation')).toBe(`${A_YEAR_IS}, and this one is text`);
		expect(outcome("value of $100 in 2030-01-01 assuming 3% inflation")).toBe(`${A_YEAR_IS}, and this one is a date or time (write its year on its own, such as 1990)`);
		expect(outcome("value of $100 in 30% assuming 3% inflation")).toBe(`${A_YEAR_IS}, and this one is a percentage`);
	});

	test("both document passes refuse it with the code and agree, a year held in a name included", () => {
		const { batch, incremental } = both(
			"value of $100 in 2030.5 assuming 3% inflation\nyear = 2030\nvalue of $100 in year assuming 3% inflation\nhalf = 2030.5\nvalue of $100 in half assuming 3% inflation",
		);
		expect(batch).toEqual(["ERROR INFLATION_EXPECTED_YEAR", "= 2,030", "= $88.85", "= 2,030.50", "ERROR INFLATION_EXPECTED_YEAR"]);
		expect(incremental).toEqual(batch);
	});

	test("what was right stays right: a whole year, a year worked out, any currency, money after it", () => {
		expect(outcome("value of $100 in 2030 assuming 3% inflation")).toBe("$88.85");
		expect(outcome("value of $100 in 2030 + 1 assuming 3% inflation")).toBe("$86.26");
		expect(outcome("value of $100 in (2030 + 1) assuming 3% inflation")).toBe("$86.26");
		expect(outcome("value of £100 in 2030 assuming 3% inflation")).toBe("£88.85");
		expect(outcome("value of $100 in 2030 assuming 3% inflation + $5")).toBe("$93.85");
		expect(outcome("value of $100 in 1990 assuming 3% inflation")).toBe("$289.83");
		expect(outcome("value of $100 in 2030 assuming -150% inflation")).toMatch(/^INVALID_RATE: /);
	});
});

// ── The parts ─────────────────────────────────────────────────────────────

describe("inflationFutureValueHandler", () => {
	const usd = (n: number): Value => uomValue(n, "USD");

	test("ordinary: a whole year is read, and a rate of zero keeps the amount whatever the year", () => {
		expect(inflationFutureValueHandler([usd(100), numberValue(2030), numberValue(0)]).toNumber()).toBeCloseTo(100, 10);
		const a = inflationFutureValueHandler([usd(100), numberValue(2030), numberValue(0.03)]).toNumber();
		const b = inflationFutureValueHandler([usd(100), numberValue(2031), numberValue(0.03)]).toNumber();
		expect(b / a).toBeCloseTo(1 / 1.03, 10);
		expect(inflationFutureValueHandler([usd(100), numberValue(2030), numberValue(0)]).unit).toBe("USD");
	});

	test("boundary: a fraction, a non-finite number, and no year at all are refused; minus zero is the year 0", () => {
		expect(inflationFutureValueHandler([usd(100), numberValue(2030.5), numberValue(0.03)]).errorCode).toBe("INFLATION_EXPECTED_YEAR");
		expect(inflationFutureValueHandler([usd(100), numberValue(Infinity), numberValue(0.03)]).errorCode).toBe("INFLATION_EXPECTED_YEAR");
		expect(inflationFutureValueHandler([usd(100), numberValue(NaN), numberValue(0.03)]).errorCode).toBe("INFLATION_EXPECTED_YEAR");
		expect(inflationFutureValueHandler([usd(100)]).errorCode).toBe("INFLATION_EXPECTED_YEAR");
		expect(inflationFutureValueHandler([usd(100), numberValue(-0), numberValue(0)]).toNumber()).toBeCloseTo(100, 10);
	});

	test("hostile: money, a quantity, text, a date and a percentage as the year; a fault and a pending value pass through", () => {
		for (const year of [usd(2030), uomValue(2030, "kg"), stringValue("2030"), datetimeValue(NOW_2026), percentageValue(0.3)]) {
			expect(inflationFutureValueHandler([usd(100), year, numberValue(0.03)]).errorCode).toBe("INFLATION_EXPECTED_YEAR");
		}
		const fault = errorValue("SOME_FAULT", "a fault");
		expect(inflationFutureValueHandler([usd(100), fault, numberValue(0.03)])).toBe(fault);
		const pending = pendingValue("q");
		expect(inflationFutureValueHandler([usd(100), pending, numberValue(0.03)])).toBe(pending);
		for (const word of PROTOTYPE_WORDS) {
			expect(inflationFutureValueHandler([usd(100), stringValue(word), numberValue(0.03)]).errorCode).toBe("INFLATION_EXPECTED_YEAR");
		}
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words as the year, sized input, look-alike digits and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`value of $100 in ${word} assuming 3% inflation`);
				expectHonestDocument(`${word} = 2030.5\nvalue of $100 in ${word} assuming 3% inflation`);
			}
		});
		expectHonestLine(`value of $100 in ${RESOURCE_PROBES.longSum(2_000)} assuming 3% inflation`, { budgetMs: 5_000 });
		expectHonestLine(`value of $100 in ${RESOURCE_PROBES.deepParens(500)} assuming 3% inflation`, { budgetMs: 5_000 });
		expectHonestLine(`value of $100 in ${RESOURCE_PROBES.hugePower()} assuming 3% inflation`, { budgetMs: 5_000 });
		for (const line of ["value of $100 in ٢٠٣٠ assuming 3% inflation", "value of $100 in 20​30 assuming 3% inflation", "value of $100 in <b>2030</b> assuming 3% inflation", "value of $100 in ‮2030 assuming 3% inflation"]) {
			expectHonestLine(line);
		}
		for (const line of fill("value of $100 in 2030.5 assuming 3% inflation X", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a year from the line above changed to money, a check, a typo and the two passes", () => {
		const { batch, incremental } = both(
			"target = 2030\nvalue of $100 in target assuming 3% inflation\ntarget = $2030\nvalue of $100 in target assuming 3% inflation\ncheck value of $100 in 2030.5 assuming 3% inflation > $1",
		);
		expect(batch[1]).toBe("= $88.85");
		expect(batch[3]).toBe("ERROR INFLATION_EXPECTED_YEAR");
		expect(batch[4]).toMatch(/^ERROR /);
		expect(incremental).toEqual(batch);
		expectHonestLine("value of $100 in 2030. assuming 3% inflation");
		expectHonestLine("value of $100 in 20 30 assuming 3% inflation");
		expectHonestLine("value of $100 in assuming 3% inflation");
	});

	test("edge: the numeric edges as the year, CRLF", () => {
		for (const line of fill("value of $100 in X assuming 3% inflation", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(outcome("value of $100 in 1/0 assuming 3% inflation")).toBe(`${A_YEAR_IS}, and this one is ∞`);
		expect(outcome("value of $100 in 1e400 assuming 3% inflation")).toBe(`${A_YEAR_IS}, and this one is ∞`);
		expect(outcome("value of $100 in 2^53 assuming 3% inflation")).toBe("$0.00");
		const { batch, incremental } = both("value of $100 in 2030.5 assuming 3% inflation\r\nvalue of $100 in 2030 assuming 3% inflation\r\n");
		expect(batch.slice(0, 2)).toEqual(["ERROR INFLATION_EXPECTED_YEAR", "= $88.85"]);
		expect(incremental).toEqual(batch);
	});
});
