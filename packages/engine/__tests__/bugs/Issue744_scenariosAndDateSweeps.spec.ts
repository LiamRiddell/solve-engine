import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { dateCalendarInZone } from "@solve-js/calendar/DateCalendar";
import { scenarioDeclaredIn } from "@solve-js/engine/WhatIfRun";
import { scenarioDeclarationNormalizerRule, scenarioReadNormalizerRule } from "@solve-js/packages/whatif/normalizer/WhatIfNormalizerRules";
import { scenarioDeclareHandler, scenarioReadHandler } from "@solve-js/packages/whatif/ScenarioPluginFunctions";
import { isScenarioDeclarationText } from "@solve-js/packages/whatif/ScenarioText";
import { shiftByCalendarUnit } from "@solve-js/vm/CalendarShift";
import { numberValue, percentageValue, stringValue, uomValue, errorValue, pendingValue, ValueType, type Value } from "@solve-js/vm/Value";
import type { LineExecutionContext } from "@solve-js/vm/VM";
import type { Token } from "@solve-js/lexer/Token";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

/**
 * Issue #744: a reader could not keep named sets of inputs in a note, and a
 * sweep could not step a date. `scenario bull with price = $120, qty = 5`
 * declares a scenario, and `line 3 under bull` reads line 3 with its inputs in
 * force, through the what-if's own re-run and refusals. `line 3 for d from
 * 2026-01-01 to 2026-06-01 step 1 month` steps a date by the calendar, as
 * `<date> + <duration>` does.
 */

function lines(text: string, engine: ExpressionEngine = newTrackedEngine()): string[] {
	return engine.parseDocument(text, { inputType: "markdown" }).lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const shown = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${shown}` : shown;
	});
}

function incremental(text: string, engine: ExpressionEngine = newTrackedEngine()): string[] {
	return evaluateDocument(engine, text, { inputType: "markdown" }).lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const shown = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${shown}` : shown;
	});
}

/** Both document passes, asserting they agree. */
function both(text: string, zone?: string): string[] {
	const make = () => (zone === undefined ? newTrackedEngine() : newTrackedEngine({ calendar: dateCalendarInZone(zone) }));
	const batch = lines(text, make());
	expect(incremental(text, make())).toEqual(batch);
	return batch;
}

const SHOP = ["price = $100", "qty = 3", "price * qty"];

describe("named scenarios", () => {
	test("declared once and read under either name, through both passes", () => {
		const out = both([...SHOP, "scenario bull with price = $120, qty = 5", "scenario bear with price = $80 and qty = 2", "line 3 under bull", "line 3 under bear", "line 3"].join("\n"));
		expect(out.slice(3)).toEqual(["bull: price = $120.00, qty = 5", "bear: price = $80.00, qty = 2", "$600.00", "$160.00", "$300.00"]);
	});

	test("a scenario read is a value like any other: arithmetic, a check, a total", () => {
		const out = both([...SHOP, "scenario bull with price = $120, qty = 5", "line 3 under bull - line 3", "check line 3 under bull == $600"].join("\n"));
		expect(out.slice(4)).toEqual(["$300.00", "✓"]);
	});

	test("the declaration is passed over by a block total, as a check line is", () => {
		const out = both(["10", "scenario s with x = 1", "20", "total above"].join("\n"));
		expect(out[3]).toBe("30");
	});

	test("a scenario's values are read where the asking line stands, and may use a variable", () => {
		const out = both(["base = 10", "scenario s with x = base * 2", "x = 1", "x + 1", "line 4 under s"].join("\n"));
		expect(out[4]).toBe("21");
	});

	test("the note's own values are untouched", () => {
		const out = both([...SHOP, "scenario bull with price = $120", "line 3 under bull", "price", "line 3"].join("\n"));
		expect(out.slice(4)).toEqual(["$360.00", "$100.00", "$300.00"]);
	});

	test("the refusals are named: unknown, duplicate, an unused input, a nested read, a global in the span", () => {
		expect(both(["x = 1", "x * 2", "line 2 under nope"].join("\n"))[2]).toBe(
			'ERROR No line above this one declares a scenario named nope. Declare it first, as in "scenario nope with growth = 8%".');
		expect(both(["x = 1", "scenario a with x = 2", "scenario a with x = 3", "x * 10", "line 4 under a"].join("\n"))[4]).toBe(
			"ERROR Lines 2 and 3 both declare a scenario named a. Give each scenario its own name.");
		expect(both(["scenario s with y = 5", "x = 1", "x * 2", "line 3 under s"].join("\n"))[3]).toBe(
			"ERROR No line up to line 3 uses y, so changing it cannot change line 3's answer.");
		expect(both(["x = 1", "x * 2", "scenario s with x = 2", "line 2 under s", "line 4 under s"].join("\n"))[4]).toMatch(/^ERROR A what-if or sweep cannot run inside another one's re-run/);
		expect(lines(["global :g = 5", "x = 2", "x * 2", "scenario s with x = 3", "line 3 under s"].join("\n"))[4]).toBe(
			"ERROR Line 1 sets a global variable, which other documents read, so a what-if will not re-run it.");
	});

	test("a declaration below the asking line is not read, since a note is read from the top", () => {
		expect(both(["x = 1", "x * 2", "line 2 under s", "scenario s with x = 5"].join("\n"))[2]).toMatch(/^ERROR No line above this one declares a scenario named s/);
	});

	test("the declaration's own refusals are the what-if's", () => {
		expect(lines("scenario s with x = 1, x = 2")[0]).toBe("ERROR This scenario sets x twice. Give each input once.");
		const many = Array.from({ length: 17 }, (_, i) => `v${i} = ${i}`).join(", ");
		expect(lines(`scenario s with ${many}`)[0]).toBe("ERROR A scenario can change at most 16 inputs at once.");
	});

	test("scenario and under stay ordinary words elsewhere", () => {
		expect(both(["scenario = 2", "scenario * 3", "under = 4", "under + 1"].join("\n"))).toEqual(["2", "6", "4", "5"]);
		expect(both(["x = 5", "x * 2", "line 2 in bull"].join("\n"))[2]).toBe('ERROR "bull" is not a unit.');
	});

	test("a scenario named like a unit, a keyword-like word and a prototype word", () => {
		const out = both(["x = 5", "x * 2", "scenario km with x = 1", "line 2 under km", "scenario constructor with x = 3", "line 2 under constructor", "line 2 under toString"].join("\n"));
		expect(out.slice(3)).toEqual(["2", "constructor: x = 3", "6", 'ERROR No line above this one declares a scenario named toString. Declare it first, as in "scenario toString with growth = 8%".']);
	});

	test("without a document a scenario read refuses with a document error, and a declaration answers its summary", () => {
		const value = newTrackedEngine().evaluateLine(1, "line 2 under bull");
		expect(value.type).toBe(ValueType.Error);
		expect(formatValue(value)).toMatch(/document/);
		expect(formatValue(newTrackedEngine().evaluateLine(1, "scenario bull with growth = 8%"))).toBe("= bull: growth = 8.00%");
	});
});

describe("date sweeps", () => {
	const WORK = ["start = 2026-01-01", "finish = 2026-12-31", "working days between start and finish"];

	test("by a month, a week and backwards, through both passes", () => {
		const out = both([...WORK,
			"line 3 for start from 2026-01-01 to 2026-04-01 step 1 month",
			"line 3 for start from 2026-01-01 to 2026-01-15 step 1 week",
			"line 3 for start from 2026-04-01 to 2026-01-01 step -1 month",
		].join("\n"));
		expect(out.slice(3)).toEqual(["[261, 239, 219, 197]", "[261, 256, 251]", "[197, 219, 239, 261]"]);
	});

	test("a month step from the 31st lands on each month's last day, and a leap year's", () => {
		const out = both(["d = 2026-01-31", "(d - 2026-01-01) in days", "line 2 for d from 2026-01-31 to 2026-05-31 step 1 month", "line 2 for d from 2024-01-31 to 2024-03-31 step 1 month"].join("\n"), "UTC");
		expect(out[2]).toBe("[30 days, 58 days, 89 days, 119 days, 150 days]");
		expect(out[3]).toBe("[-701 days, -672 days, -641 days]");
	});

	test("a day step across a daylight-saving change keeps the time of day, and an hour step is elapsed time", () => {
		const out = both(["d = 2026-03-28 09:00", "(d - 2026-03-01) in hours", "line 2 for d from 2026-03-28 09:00 to 2026-03-31 09:00 step 1 day", "line 2 for d from 2026-03-28 09:00 to 2026-03-29 09:00 step 12 hours"].join("\n"), "Europe/London");
		expect(out[2]).toBe("[657 hours, 680 hours, 704 hours, 728 hours]");
		expect(out[3]).toBe("[657 hours, 669 hours]");
	});

	test("a range of one date, and a year step", () => {
		const out = both(["d = 2026-01-01", "(d - 2026-01-01) in days", "line 2 for d from 2026-01-01 to 2026-01-01 step 1 month", "line 2 for d from 2026-01-01 to 2027-01-01 step 1 year"].join("\n"), "UTC");
		expect(out.slice(2)).toEqual(["[0 days]", "[0 days, 365 days]"]);
	});

	test("the refusals are named", () => {
		const out = both([...WORK,
			"line 3 for start from 2026-01-01 to 2026-04-01 step 5",
			"line 3 for start from 2026-01-01 to 2026-04-01 step 0 days",
			"line 3 for start from 2026-01-01 to 2026-04-01 step -1 month",
			"line 3 for start from 2026-01-01 to 2030-01-01 step 1 day",
			"line 3 for start from 2026-01-01 to 5 step 1 day",
			"line 3 for start from 2026-01-01 to 2026-04-01 step 3 kg",
		].join("\n"));
		expect(out.slice(3)).toEqual([
			"ERROR A sweep between two dates steps by a length of time, such as 1 month, 7 days or 1 year.",
			"ERROR A sweep's step cannot be zero: it would never reach the end of the range.",
			"ERROR This sweep runs forward in time from its start to its end, so its step must be positive: as written it moves away from the end and never reaches it.",
			"ERROR This sweep would try more than 1,000 dates, past the limit of 1,000 for one sweep. Use a larger step or a shorter range.",
			'ERROR A sweep from a date runs to a date, so its end must be one too, as in "from 2026-01-01 to 2026-06-01 step 1 month".',
			"ERROR A sweep between two dates steps by a length of time, such as 1 month, 7 days or 1 year.",
		]);
	});

	test("a line whose answer is a date is not a list, and says so naming the date", () => {
		const out = both(["start = 2026-01-01", "start + 30 days", "line 2 for start from 2026-01-01 to 2026-03-01 step 1 month"].join("\n"));
		expect(out[2]).toBe("ERROR With start at Thursday, January 1, 2026, line 2's answer is not a number, and a sweep lists numbers and quantities only.");
	});
});

describe("the parts", () => {
	function tokensOf(line: string): Token[] {
		const engine = newTrackedEngine();
		return engine.getLexer().getHighlightTokenObjects(line, 0);
	}

	test("scenarioDeclarationNormalizerRule fuses only the whole shape at the start of a line", () => {
		const rule = scenarioDeclarationNormalizerRule();
		expect(rule.match(tokensOf("scenario bull with growth = 8%"), 0)?.replacement.map((t) => [t.type, t.value])).toEqual([["SCENARIO_DECLARATION", "bull"]]);
		expect(rule.match(tokensOf("scenario bull with :growth = 8%"), 0)).not.toBeNull();
		expect(rule.match(tokensOf("scenario = 2"), 0)).toBeNull();
		expect(rule.match(tokensOf("scenario bull with 5"), 0)).toBeNull();
		expect(rule.match(tokensOf("scenario bull growth = 8%"), 0)).toBeNull();
		expect(rule.match(tokensOf("x scenario bull with y = 1"), 1)).toBeNull();
		expect(rule.match([], 0)).toBeNull();
	});

	test("scenarioReadNormalizerRule needs a line reference and a name", () => {
		const engine = newTrackedEngine();
		const normalized = (line: string) => engine.getNormalizer().normalize(engine.getLexer().getHighlightTokenObjects(line, 0));
		expect(normalized("line 3 under bull").map((t) => [t.type, t.value])).toEqual([["SCENARIO_READ", "3|bull"]]);
		expect(normalized("line 3 under").some((t) => t.type === "SCENARIO_READ")).toBe(false);
		expect(normalized("under bull").some((t) => t.type === "SCENARIO_READ")).toBe(false);
		expect(scenarioReadNormalizerRule().match([], 0)).toBeNull();
	});

	test("scenarioDeclaredIn reads the name and the inputs as written", () => {
		const engine = newTrackedEngine();
		const tokenize = (text: string) => engine.tokenizeForClassification(text);
		expect(scenarioDeclaredIn("scenario bull with price = $120, qty = 5", tokenize)).toEqual({ name: "bull", overrides: "price = $120, qty = 5" });
		expect(scenarioDeclaredIn("  Scenario Bull with x = 1 // note", tokenize)).toEqual({ name: "Bull", overrides: "x = 1 // note" });
		expect(scenarioDeclaredIn("scenario = 2", tokenize)).toBeNull();
		expect(scenarioDeclaredIn("x = 1", tokenize)).toBeNull();
		expect(scenarioDeclaredIn("", tokenize)).toBeNull();
	});

	test("isScenarioDeclarationText", () => {
		expect(isScenarioDeclarationText("scenario bull with growth = 8%")).toBe(true);
		expect(isScenarioDeclarationText("scenario bull with :growth=8%")).toBe(true);
		expect(isScenarioDeclarationText("scenario = 2")).toBe(false);
		expect(isScenarioDeclarationText("my scenario bull with x = 1")).toBe(false);
		expect(isScenarioDeclarationText("scenario bull with 5")).toBe(false);
		expect(isScenarioDeclarationText(`scenario ${"a".repeat(50_000)} with`)).toBe(false);
	});

	test("scenarioDeclareHandler answers the summary, or the failing input", () => {
		expect(formatValue(scenarioDeclareHandler([stringValue("bull"), stringValue("growth"), percentageValue(0.08), stringValue("price"), uomValue(120, "USD")]))).toBe("= bull: growth = 8.00%, price = $120.00");
		expect(scenarioDeclareHandler([stringValue("s"), stringValue("x"), errorValue("X_FAILED", "failed")]).errorCode).toBe("X_FAILED");
		expect(scenarioDeclareHandler([stringValue("s"), stringValue("x"), pendingValue("rate")]).errorCode).toBe("WHAT_IF_INPUT_PENDING");
		expect(formatValue(scenarioDeclareHandler([stringValue("s")]))).toBe("= s: ");
	});

	test("scenarioReadHandler refuses without a document and a deleted target, and hands the rest to the context", () => {
		expect(scenarioReadHandler([numberValue(3), stringValue("bull")]).errorCode).toBe("WHAT_IF_NO_DOCUMENT");
		expect(scenarioReadHandler([numberValue(-1), stringValue("bull")], { lineIndex: 4 } as LineExecutionContext).errorCode).toBe("LINE_REFERENCE_DELETED");
		const asked: Array<[string, number]> = [];
		const context = { lineIndex: 4, readScenario: (name: string, n: number): Value => { asked.push([name, n]); return numberValue(7); } } as LineExecutionContext;
		expect(scenarioReadHandler([numberValue(3), stringValue("bull")], context).toNumber()).toBe(7);
		expect(asked).toEqual([["bull", 3]]);
	});

	test("shiftByCalendarUnit", () => {
		const calendar = dateCalendarInZone("UTC");
		const jan31 = Date.UTC(2026, 0, 31);
		expect(shiftByCalendarUnit(jan31, 1, "month", calendar)).toBe(Date.UTC(2026, 1, 28));
		expect(shiftByCalendarUnit(jan31, 2, "months", calendar)).toBe(Date.UTC(2026, 2, 31));
		expect(shiftByCalendarUnit(jan31, 1, "year", calendar)).toBe(Date.UTC(2027, 0, 31));
		expect(shiftByCalendarUnit(jan31, 1, "week", calendar)).toBe(Date.UTC(2026, 1, 7));
		expect(shiftByCalendarUnit(jan31, -1, "day", calendar)).toBe(Date.UTC(2026, 0, 30));
		expect(shiftByCalendarUnit(jan31, 0, "month", calendar)).toBe(jan31);
		expect(shiftByCalendarUnit(jan31, 3, "hours", calendar)).toBeUndefined();
		expect(shiftByCalendarUnit(jan31, 3, "kg", calendar)).toBeUndefined();
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(shiftByCalendarUnit(jan31, 1, word, calendar)).toBeUndefined();
		});
	});
});

describe("adversarial", () => {
	test("text edges and prototype words in a scenario stay honest", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestDocument(["x = 1", "x * 2", `scenario ${word} with x = 2`, `line 2 under ${word}`].join("\n"));
				expectHonestDocument(["x = 1", "x * 2", `scenario s with ${word} = 2`, "line 2 under s"].join("\n"));
			}
		});
		for (const line of fill("scenario s with x = X", TEXT_EDGES)) expectHonestLine(line);
		expectHonestDocument(["x = 1", "x * 2", 'scenario s with x = "<script>"', "line 2 under s"].join("\n"));
	});

	test("an edit to the declaration reaches the reader in the live evaluator, and the passes agree", () => {
		const text = ["price = $100", "qty = 3", "price * qty", "scenario bull with price = $120", "line 3 under bull"];
		expect(incremental(text.join("\n"))[4]).toBe("$360.00");
		const edited = [...text];
		edited[3] = "scenario bull with price = $150";
		expect(incremental(edited.join("\n"))[4]).toBe("$450.00");
		expect(lines(edited.join("\n"))[4]).toBe("$450.00");
	});

	test("a scenario read inside a sweep, and a sweep read under a scenario, are refused as nested", () => {
		const out = both(["x = 1", "x * 2", "scenario s with x = 3", "line 2 under s", "line 4 for x from 1 to 2 step 1"].join("\n"));
		expect(out[4]).toMatch(/^ERROR /);
	});

	test("many scenario reads in one note stay within the note's budget", () => {
		const text = ["x = 1", "x * 2", "scenario s with x = 3", ...Array.from({ length: 200 }, () => "line 2 under s")].join("\n");
		expectHonestDocument(text, { budgetMs: 15_000 });
	});

	test("a sweep at its limits: exactly 1,000 dates, and one more", () => {
		const base = ["d = 2026-01-01", "(d - 2026-01-01) in days"];
		const thousand = both([...base, "line 2 for d from 2026-01-01 to 2028-09-26 step 1 day"].join("\n"), "UTC");
		expect(thousand[2]).toMatch(/^\[0 days, 1 day, /);
		const more = both([...base, "line 2 for d from 2026-01-01 to 2028-09-27 step 1 day"].join("\n"), "UTC");
		expect(more[2]).toMatch(/^ERROR This sweep would try more than 1,000 dates/);
	});

	test("CRLF line endings and a trailing newline read the same", () => {
		const text = ["x = 1", "x * 2", "scenario s with x = 4", "line 2 under s"];
		expect(both(`${text.join("\r\n")}\r\n`)[3]).toBe("8");
	});
});
