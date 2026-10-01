import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { EngineError } from "@solve-js/errors/EngineError";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DATETIME_PACKAGE } from "@solve-js/packages/datetime/DatetimePackage";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `f(d) = weekday of d` was defined, and `f(2026-10-01)` then said
 * "Undefined variable: weekday".
 *
 * A function body is normalised the way a line is, so every phrase form works
 * in one (`15% of x`, `days until d`, `x in km`, `weekday on d`, `month of d`).
 * `weekday of` was not a phrase anywhere: `weekday of 2026-10-01` on its own
 * line was the same undefined variable. It is now read as `weekday on` is, as
 * `month of` and `week number of` already were, together with `day of the week
 * of`, `day of week of` and `day of week on` (the datetime package's phrases).
 */

/** A line's answer through evaluateExpression, or `CODE: message` for a refusal. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** A line's answer through the single-line entry point evaluateLine, or `CODE: message`. */
function single(line: string): string {
	try {
		const value = newTrackedEngine().evaluateLine(1, line);
		if (value.isError()) return `${String(value.errorCode)}: ${String(value.errorMessage)}`;
		return formatValue(value).replace(/^=\s*/, "");
	} catch (error) {
		if (error instanceof EngineError) return `${error.code}: ${error.message}`;
		throw error;
	}
}

/** A document line's answer, or `ERROR <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "ERROR no line";
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	if (line.result.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return formatValue(line.result).replace(/^=\s*/, "");
}

/** Each line of a document through both document passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

describe("the lines that exposed it", () => {
	test("a function written with weekday of answers when it is called, through both passes", () => {
		expect(both(["f(d) = weekday of d", "f(2026-10-01)", "f(2026-12-25)"])).toEqual(["f(d) defined", "Thursday", "Friday"]);
	});

	test("weekday of a date answers on its own line, through every entry point", () => {
		expect(outcome("weekday of 2026-10-01")).toBe("Thursday");
		expect(single("weekday of 2026-12-25")).toBe("Friday");
		expect(both(["weekday of 2026-12-25"])).toEqual(["Friday"]);
	});

	test("the other spellings of the question read the same", () => {
		expect(outcome("day of the week of 1 January 2000")).toBe("Saturday");
		expect(outcome("day of week of 2026-12-25")).toBe("Friday");
		expect(outcome("day of week on 2026-12-25")).toBe("Friday");
		expect(both(["f(d) = day of the week of d", "f(1 January 2000)"])).toEqual(["f(d) defined", "Saturday"]);
	});

	test("the other phrase forms the bug was checked against work in a body too", () => {
		expect(both(["f(x) = 15% of x", "f(200)"])).toEqual(["f(x) defined", "30"]);
		expect(both(["h(x) = x in km", "h(5000 m)"])).toEqual(["h(x) defined", "5.00 km"]);
		expect(both(["g(d) = month of d", "g(2026-10-01)"])).toEqual(["g(d) defined", "October"]);
		expect(both(["w(d) = week number of d", "w(2026-10-01)"])).toEqual(["w(d) defined", "40"]);
		expect(both(["k(d) = d is a weekday", "k(2026-10-03)"])).toEqual(["k(d) defined", "false"]);
	});

	test("a name that is no phrase is still an honest undefined name, since a body may use one defined later", () => {
		expect(both(["f(x) = x * rate", "rate = 3", "f(2)"])).toEqual(["f(x) defined", "3", "6"]);
		expect(both(["f(x) = x * rate", "f(2)"])[1]).toBe("ERROR Undefined variable: rate");
	});
});

describe("the parts: the datetime package's phrases", () => {
	const phrases: Readonly<Record<string, string>> = DATETIME_PACKAGE.phrases ?? {};

	test("ordinary: each spelling is read as the weekday question", () => {
		for (const phrase of ["weekday of", "day of the week of", "day of week of", "day of week on", "weekday on", "day of the week on"]) {
			expect({ phrase, type: phrases[phrase] }).toEqual({ phrase, type: "WEEKDAY_ON" });
		}
	});

	test("boundary: the month and week spellings keep their own questions", () => {
		expect(phrases["month of"]).toBe("MONTH_ON");
		expect(phrases["week number of"]).toBe("WEEK_ON");
	});

	test("hostile: an inherited name is not a phrase", () => {
		for (const word of PROTOTYPE_WORDS) expect(Object.prototype.hasOwnProperty.call(phrases, word)).toBe(false);
	});
});

describe("adversarial: security", () => {
	test("a prototype word after weekday of is refused honestly and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const line of fill("weekday of X", PROTOTYPE_WORDS)) expect(expectHonestLine(line).kind).not.toBe("value");
			for (const word of PROTOTYPE_WORDS) expectHonestDocument(`f(d) = weekday of d\nf(${word})`);
		});
	});

	test("a long run of the phrase is answered within the budget", () => {
		expectHonestLine(`${"weekday of ".repeat(500)}2026-10-01`, { budgetMs: 5_000 });
	});

	test("markup-shaped text after it is read as text", () => {
		for (const edge of TEXT_EDGES) expectHonestLine(`weekday of 2026-10-01 ${edge}`);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a number where a date belongs is refused by name, on a line and through the body", () => {
		const refused = 'DATE_FIELD_EXPECTED_DATE: "weekday" expects a date, but got a number.';
		expect(outcome("weekday of 5")).toBe(refused);
		expect(both(["f(d) = weekday of d", "f(5)"])[1]).toBe('ERROR "weekday" expects a date, but got a number.');
	});

	test("a date from the line above, a check over it and a sum inside it", () => {
		expect(both(["d = 2026-10-01", "weekday of d", 'check (weekday of d) == "Thursday"', "weekday of (d + 1 day)"])).toEqual([
			"Thursday, October 1, 2026",
			"Thursday",
			"✓",
			"Friday",
		]);
	});

	test("weekday stays a name a reader can define and use", () => {
		expect(both(["weekday = 3", "weekday * 2"])).toEqual(["3", "6"]);
		expect(both(["weekdays = 5", "weekdays of 2"])).toEqual(["5", "10"]);
	});

	test("a section around the definition", () => {
		expectHonestDocument("# Days\nf(d) = weekday of d\n## Use\nf(2026-12-25)");
	});
});

describe("adversarial: edge cases", () => {
	test("a leap day, a month end and the start of the year", () => {
		expect(outcome("weekday of 2028-02-29")).toBe("Tuesday");
		expect(outcome("weekday of 2026-01-31")).toBe("Saturday");
		expect(outcome("weekday of 2027-01-01")).toBe("Friday");
	});

	test("each numeric edge as the argument is refused honestly", () => {
		for (const line of fill("weekday of X", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
	});

	test("CRLF and a trailing newline", () => {
		expect(both(["f(d) = weekday of d\r", "f(2026-12-25)\r", ""])).toEqual(["f(d) defined", "Friday", ""]);
	});
});
