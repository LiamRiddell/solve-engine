import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, NUMERIC_EDGES, TEXT_EDGES, RESOURCE_PROBES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { ExpressionLexer } from "@solve-js/lexer/ExpressionLexer";
import { ValueType, stringValue } from "@solve-js/vm/Value";
import { isIsoDurationShaped, readIsoDuration, writeDurationInUnit, writeIsoDuration } from "@solve-js/packages/time/IsoDuration";
import { isoDurationNormalizerRule } from "@solve-js/packages/time/normalizer/IsoDurationNormalizerRule";
import { isoDurationFaultHandler } from "@solve-js/packages/time/parselets/IsoDurationParselets";

/**
 * Issue #760: an ISO 8601 duration, the form APIs, logs and calendar files
 * write a length of time in, was read as a variable name: `PT1H30M` was an
 * undefined variable while `1h30m` was ninety minutes. It is now read as the
 * length it writes, its calendar parts move a date the way the calendar does,
 * a malformed one is refused by name, and `as iso8601` writes a length of time
 * back as one.
 */

function show(line: string): string {
	try {
		return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? formatValue(line.result).replace(/^=\s*/, "") : "");
}

/** The tokens the rule leaves in place of the identifier at `pos`, as `TYPE(value)`, or null when it declines. */
function ruleAt(line: string, pos = 0): string | null {
	const lexer = new ExpressionLexer();
	lexer.reset(line);
	const tokens = lexer.tokenizeAll().filter((t) => t.type !== "EOF");
	const match = isoDurationNormalizerRule().match(tokens, pos, {});
	return match === null ? null : `${match.consumed}: ${match.replacement.map((t) => `${t.type}(${t.value})`).join(" ")}`;
}

describe("the issue's lines", () => {
	test.each([
		["PT1H30M", "90 minutes"],
		["P1D", "1 day"],
		["P1Y2M3DT4H5M6S", "36,993,906 seconds"],
		["2026-01-01 + PT1H30M", "Thursday, January 1, 2026, 1:30:00 AM"],
		["1h30m", "90 minutes"],
		["2h30m in minutes", "150 minutes"],
		["90 minutes as iso8601", "PT1H30M"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("PT1H30M is the duration 1h30m builds", () => {
		const engine = newTrackedEngine();
		const iso = engine.evaluateExpression("PT1H30M");
		const compact = engine.evaluateExpression("1h30m");
		expect(iso.toNumber()).toBe(compact.toNumber());
		expect(iso.unit).toBe(compact.unit);
	});
});

describe("calendar parts follow the engine's calendar rules on a date", () => {
	test.each([
		["2026-01-31 + P1M", "Saturday, February 28, 2026"],
		["2026-01-31 + P1M1D", "Sunday, March 1, 2026"],
		["2026-01-31 + P1M40D", "Thursday, April 9, 2026"],
		["2026-03-31 - P1M1D", "Friday, February 27, 2026"],
		["2028-01-01 + P1Y", "Monday, January 1, 2029"],
		["2026-01-01 + P1Y1D", "Saturday, January 2, 2027"],
		["2026-01-01 + P1Y2M10DT2H30M", "Thursday, March 11, 2027, 2:30:00 AM"],
		["2024-02-29 + P1Y", "Friday, February 28, 2025"],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("each part in turn is the same as writing the parts out", () => {
		expect(show("2026-01-31 + P1M1D")).toBe(show("2026-01-31 + 1 month + 1 day"));
		expect(show("2026-03-31 - P1M1D")).toBe(show("2026-03-31 - 1 month - 1 day"));
	});

	test("converted, years and months keep the unit table's lengths, as 1 month in days does", () => {
		expect(show("P1M in days")).toBe(show("1 month in days"));
		expect(show("P1Y in days")).toBe(show("1 year in days"));
		expect(show("P1Y2M")).toBe(show("1 year 2 months"));
	});
});

describe("as iso8601 writes a length of time back", () => {
	test.each([
		["90 minutes as iso8601", "PT1H30M"],
		["PT1H30M as iso8601", "PT1H30M"],
		["P1D as iso8601", "P1D"],
		["1.5 days as iso8601", "P1DT12H"],
		["26 hours as iso8601", "PT26H"],
		["2 weeks as iso8601", "P2W"],
		["14 months as iso8601", "P14M"],
		["1 year as iso8601", "P1Y"],
		["2 decades as iso8601", "P20Y"],
		["0 seconds as iso8601", "PT0S"],
		["0.5 seconds as iso8601", "PT0.5S"],
		["(0.1 + 0.2) seconds as iso8601", "PT0.3S"],
		["-PT1H30M as iso8601", "-PT1H30M"],
		["1e300 seconds as iso8601", "This length of time is too large to write as an ISO 8601 duration with exact digits."],
		["5 kg as iso8601", "as iso8601 writes a date, a Unix timestamp (in seconds or milliseconds) or ISO 8601 text, and this value is none of them."],
		["5 workdays as iso8601", "as iso8601 writes a date, a Unix timestamp (in seconds or milliseconds) or ISO 8601 text, and this value is none of them."],
	])("%s", (line, answer) => {
		expect(show(line)).toBe(answer);
	});

	test("what it writes reads back in as the same length", () => {
		for (const line of ["90 minutes", "1.5 days", "14 months", "26 hours", "2 weeks", "0.5 seconds", "-1 hour"]) {
			const engine = newTrackedEngine();
			const written = engine.evaluateExpression(`${line} as iso8601`).value as string;
			expect(engine.evaluateExpression(`(${written}) in seconds`).toNumber()).toBeCloseTo(engine.evaluateExpression(`(${line}) in seconds`).toNumber(), 6);
		}
	});

	test("a date is still written as a date", () => {
		expect(show("2026-01-01 as iso8601")).toMatch(/^2026-01-01T00:00:00/);
	});
});

describe("a malformed duration is refused by name, and a real name is left alone", () => {
	test.each([
		["P1H", "P1H is not an ISO 8601 duration: H is a time part, and time parts come after a T, as in PT1H."],
		["PT1D", "PT1D is not an ISO 8601 duration: D is a date part, and date parts come before the T."],
		["P1M1Y", "P1M1Y is not an ISO 8601 duration: 1Y is out of place: the parts run from the largest to the smallest, each once."],
		["P1D1D", "P1D1D is not an ISO 8601 duration: 1D is out of place: the parts run from the largest to the smallest, each once."],
		["P1DT", "P1DT is not an ISO 8601 duration: it has a T with no time part after it."],
		["P1D2", "P1D2 is not an ISO 8601 duration: it ends in 2 with no letter after it to say what the number counts."],
		["PT0.5H30M", "PT0.5H30M is not an ISO 8601 duration: only the last part can have a decimal fraction."],
		["PT1HT1M", "PT1HT1M is not an ISO 8601 duration: it has a second T, and the T that starts the time parts comes once."],
	])("%s", (line, answer) => {
		const value = newTrackedEngine().evaluateExpression(line);
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("ISO_DURATION_MALFORMED");
		expect(show(line)).toBe(answer);
	});

	test("P, PT, P1 and PT1 spell no part and stay names", () => {
		expect(doc("PT = 5\nPT\nP1 = 3\nP1 * 2\nP = 2\nP + 1")).toEqual(["5", "5", "3", "6", "2", "3"]);
		expect(show("PT1")).toBe("THROWS Undefined variable: PT1");
	});

	test("lower and mixed case stay names, as the boundary says", () => {
		expect(show("pt1h30m")).toBe("THROWS Undefined variable: pt1h30m");
		expect(show("Pt1H")).toBe("THROWS Undefined variable: Pt1H");
		expect(show("PT1h")).toBe("THROWS Undefined variable: PT1h");
	});

	test("a variable spelled like a duration is shadowed by it", () => {
		expect(doc("x = P1D\nx in hours")).toEqual(["1 day", "24 hours"]);
	});
});

describe("the parts", () => {
	describe("isIsoDurationShaped", () => {
		test.each([
			["PT1H30M", true], ["P1D", true], ["P1H", true], ["P1D2", true], ["PT0.5S", true], ["PT0,5S", true],
			["P", false], ["PT", false], ["P1", false], ["PT1", false], ["P1T", false], ["PDT", false], ["P2P", false],
			["pt1h", false], ["Pt1H", false], ["P１D", false], ["P٥D", false], ["P1​D", false], ["P1E3D", false], ["", false], ["XP1D", false],
		])("%j", (text, shaped) => {
			expect(isIsoDurationShaped(text)).toBe(shaped);
		});
	});

	describe("readIsoDuration", () => {
		test.each([
			["PT1H30M", [["1", "hour"], ["30", "minute"]]],
			["P1D", [["1", "day"]]],
			["P1Y2M10DT2H30M", [["1", "year"], ["2", "month"], ["10", "day"], ["2", "hour"], ["30", "minute"]]],
			["PT0.5S", [["0.5", "second"]]],
			["PT0,5H", [["0.5", "hour"]]],
			["P1.5Y", [["1.5", "year"]]],
			["P2W3D", [["2", "week"], ["3", "day"]]],
			["P1MT1M", [["1", "month"], ["1", "minute"]]],
			["PT0S", [["0", "second"]]],
			["P007D", [["007", "day"]]],
			["P99999999999999999999D", [["99999999999999999999", "day"]]],
		])("%s", (text, parts) => {
			const reading = readIsoDuration(text);
			expect(reading).toEqual({ kind: "duration", parts: parts.map(([amount, unit]) => ({ amount, unit })) });
		});

		test("text not shaped like a duration is not read at all", () => {
			for (const text of ["P", "PT", "P1", "pt1h", "hello", "", "P１D"]) expect(readIsoDuration(text)).toBeNull();
		});

		test("a count too large for a number is refused", () => {
			const reading = readIsoDuration(`P${"9".repeat(400)}D`);
			expect(reading?.kind).toBe("malformed");
		});

		test("a very long spelling is read in time, part by part", () => {
			const start = Date.now();
			expect(readIsoDuration(`P${"1D".repeat(50_000)}`)?.kind).toBe("malformed");
			expect(readIsoDuration(`PT${"1".repeat(300)}S`)?.kind).toBe("duration");
			expect(readIsoDuration(`PT${"1".repeat(100_000)}S`)?.kind).toBe("malformed");
			expect(Date.now() - start).toBeLessThan(2_000);
		});

		test.each(PROTOTYPE_WORDS)("a prototype word as a designator run, P%s, is not read and touches nothing", (word) => {
			expectPrototypeUntouched(() => {
				expect(readIsoDuration(`P${word}`)).toBeNull();
				expect(readIsoDuration(`P1${word}`)).toBeNull();
			});
		});
	});

	describe("writeIsoDuration", () => {
		test.each([
			[5400, "time", false, "PT1H30M"],
			[0, "time", false, "PT0S"],
			[-0, "time", false, "PT0S"],
			[-3600, "time", false, "-PT1H"],
			[0.5, "time", false, "PT0.5S"],
			[93600, "time", false, "PT26H"],
			[1.5, "days", false, "P1DT12H"],
			[0, "days", false, "P0D"],
			[14, "days", true, "P2W"],
			[10, "days", true, "P10D"],
			[0.5, "days", false, "PT12H"],
			[14, "months", false, "P14M"],
			[1, "years", false, "P1Y"],
			[1.5, "months", false, "P1.5M"],
			[0, "months", false, "P0M"],
			[-14, "months", false, "-P14M"],
			[0.5, "years", false, "P0.5Y"],
		] as const)("%p in %s", (amount, scale, weeks, text) => {
			expect(writeIsoDuration(amount, scale, weeks)).toBe(text);
		});

		test.each([Infinity, -Infinity, NaN, 1e300, Number.MAX_SAFE_INTEGER + 2])("%p has no exact writing", (amount) => {
			expect(writeIsoDuration(amount, "time")).toBeNull();
		});
	});

	describe("writeDurationInUnit", () => {
		test("the unit decides the parts", () => {
			expect(writeDurationInUnit(90, "minutes")).toBe("PT1H30M");
			expect(writeDurationInUnit(1, "fortnight")).toBe("P14D");
			expect(writeDurationInUnit(2, "weeks")).toBe("P2W");
			expect(writeDurationInUnit(1, "year")).toBe("P1Y");
			expect(writeDurationInUnit(2, "decades")).toBe("P20Y");
			expect(writeDurationInUnit(250, "ms")).toBe("PT0.25S");
		});

		test("a unit that is not a fixed length of time is not its concern", () => {
			expect(writeDurationInUnit(5, "kg")).toBeUndefined();
			expect(writeDurationInUnit(5, "workdays")).toBeUndefined();
			expect(writeDurationInUnit(5, "frames")).toBeUndefined();
			expect(writeDurationInUnit(5, "timecode@30")).toBeUndefined();
		});

		test.each(PROTOTYPE_WORDS)("a prototype word as the unit, %s, is not a duration and touches nothing", (word) => {
			expectPrototypeUntouched(() => {
				expect(writeDurationInUnit(5, word)).toBeUndefined();
			});
		});
	});

	describe("isoDurationNormalizerRule", () => {
		test("a single part is one token", () => {
			expect(ruleAt("P1D")).toBe("1: ISO_DURATION(1 day)");
			expect(ruleAt("PT2H")).toBe("1: ISO_DURATION(2 hours)");
		});

		test("several parts on their own are a bracketed sum, smallest first", () => {
			expect(ruleAt("PT1H30M")).toBe("1: LPAREN(() ISO_DURATION(30 minutes) PLUS(+) ISO_DURATION(1 hour) RPAREN())");
		});

		test("after a binary plus or minus with nothing tighter after, the parts are spread", () => {
			expect(ruleAt("x + P1M1D", 2)).toBe("1: ISO_DURATION(1 month) PLUS(+) ISO_DURATION(1 day)");
			expect(ruleAt("x - P1M1D", 2)).toBe("1: ISO_DURATION(1 month) MINUS(-) ISO_DURATION(1 day)");
			expect(ruleAt("x + P1M1D > y", 2)).toBe("1: ISO_DURATION(1 month) PLUS(+) ISO_DURATION(1 day)");
		});

		test("a unary minus or a tighter operator after takes the bracketed sum", () => {
			expect(ruleAt("-P1DT1H", 1)).toBe("1: LPAREN(() ISO_DURATION(1 hour) PLUS(+) ISO_DURATION(1 day) RPAREN())");
			expect(ruleAt("2 * -P1DT1H", 3)).toBe("1: LPAREN(() ISO_DURATION(1 hour) PLUS(+) ISO_DURATION(1 day) RPAREN())");
			expect(ruleAt("x + P1DT1H * 2", 2)).toBe("1: LPAREN(() ISO_DURATION(1 hour) PLUS(+) ISO_DURATION(1 day) RPAREN())");
			expect(ruleAt("x + P1DT1H in hours", 2)).toBe("1: LPAREN(() ISO_DURATION(1 hour) PLUS(+) ISO_DURATION(1 day) RPAREN())");
		});

		test("a decimal the lexer split off is joined back, only while it touches", () => {
			expect(ruleAt("PT0.5S")).toBe("3: ISO_DURATION(0.5 seconds)");
			expect(ruleAt("PT0,5H")).toBe("4: ISO_DURATION(0.5 hours)");
			expect(ruleAt("PT0 .5S")).toBeNull();
		});

		test("a malformed spelling is one refusal token carrying its reason", () => {
			const lexer = new ExpressionLexer();
			lexer.reset("P1H");
			const match = isoDurationNormalizerRule().match(lexer.tokenizeAll(), 0, {});
			expect(match?.replacement[0].type).toBe("ISO_DURATION_UNREADABLE");
			expect(match?.replacement[0].value).toBe("P1H");
			expect(match?.replacement[0].fault?.code).toBe("ISO_DURATION_MALFORMED");
		});

		test("anything else is declined", () => {
			expect(ruleAt("PT")).toBeNull();
			expect(ruleAt("pt1h")).toBeNull();
			expect(ruleAt("5")).toBeNull();
			expect(ruleAt("Paris")).toBeNull();
		});
	});

	test("isoDurationFaultHandler turns the code and the reason into an Error value", () => {
		const value = isoDurationFaultHandler([stringValue("ISO_DURATION_MALFORMED"), stringValue("P1H is not an ISO 8601 duration.")]);
		expect(value.type).toBe(ValueType.Error);
		expect(value.value).toBe("ISO_DURATION_MALFORMED");
		expect(isoDurationFaultHandler([]).value).toBe("ISO_DURATION_MALFORMED");
	});
});

describe("adversarial", () => {
	describe("security", () => {
		test.each(PROTOTYPE_WORDS.flatMap((word) => [`P${word}`, `PT1H in ${word}`, `${word} + PT1H`, `P1D as ${word}`]))("%s", (line) => {
			expectPrototypeUntouched(() => {
				expectHonestLine(line);
			});
		});

		test.each([
			["a long sum of durations", Array.from({ length: 2_000 }, () => "PT1H").join(" + ")],
			["a long spelling", `P${"1D".repeat(5_000)}`],
			["a huge count", `PT${"9".repeat(300)}S`],
			["a count past a double", `PT${"9".repeat(400)}S`],
			["deep brackets round one", `${"(".repeat(500)}PT1H30M${")".repeat(500)}`],
		])("%s stays within its budget", (_name, line) => {
			expectHonestLine(line, { budgetMs: 5_000 });
		});

		test("many lines of durations stay within their budget", () => {
			expectHonestDocument(RESOURCE_PROBES.manyLines(1_000, "prev + PT1M"), { budgetMs: 10_000 });
		});

		test.each(["PT1H​30M", "P​T1H", "PT1H‮30M", "P١D", "P１D", "<b>PT1H</b>", "PT1H<script>", "'PT1H'"])("a look-alike or markup-shaped spelling, %j, is read as text, honestly", (line) => {
			expectHonestLine(line);
		});
	});

	describe("realistic breakage", () => {
		test("a value from the line above, a sum, a tag and a check", () => {
			expect(doc("meeting = PT1H30M\nmeeting * 2\nmeeting in hours\ncheck meeting == 90 minutes")).toEqual(["90 minutes", "180 minutes", "1.50 hours", "✓"]);
			expect(doc("PT1H\nPT30M\ntotal")).toEqual(["1 hour", "30 minutes", "1.50 hours"]);
		});

		test("the document passes agree", () => {
			expectHonestDocument("start = 2026-01-31\nstart + P1M1D\nPT1H30M in minutes\nP1H\n90 minutes as iso8601");
		});

		test("a duration held in a variable is one length, at the table's sizes", () => {
			// The boundary the page names: added straight to a date, the parts are
			// applied in turn; held first, they are summed, as 1 month 1 day is.
			expect(doc("d = P1M1D\n2026-01-31 + d")).toEqual(["31 days", "Tuesday, March 3, 2026"]);
		});

		test("a duration meets the other time forms", () => {
			expect(show("PT1H30M + 15 minutes")).toBe("105 minutes");
			expect(show("P1D > PT23H")).toBe("true");
			expect(show("max(PT1H, PT30M)")).toBe("1 hour");
			expect(show("2 * PT1H30M")).toBe("180 minutes");
			expect(show("-P1DT1H")).toBe("-25 hours");
			expect(show("3 - -P1DT1H")).toBe("28 hours");
			expect(show("PT1H30M as timespan")).toBe("1 hour 30 minutes");
		});

		test("a duration and a quantity that is not a time are refused, not added", () => {
			expect(newTrackedEngine().evaluateExpression("PT1H + 5 kg").type).toBe(ValueType.Error);
		});

		test("a German engine reads the comma decimal the standard allows", () => {
			const german = newTrackedEngine({ locale: "de" });
			expect(german.evaluateExpression("PT0,5H").toNumber()).toBe(0.5);
			expect(german.evaluateExpression("PT0.5H").toNumber()).toBe(0.5);
		});
	});

	describe("edge cases", () => {
		test.each([
			["zero", "PT0S", "0 seconds"],
			["zero days", "P0D", "0 days"],
			["negative", "-PT1H", "-1 hour"],
			["a fraction of a second", "PT0.001S", "0.001 seconds"],
			["a leap day plus a year", "2024-02-29 + P1Y", "Friday, February 28, 2025"],
			["a month end", "2026-01-31 + P1M", "Saturday, February 28, 2026"],
			["a week", "P1W", "1 week"],
		])("%s", (_name, line, answer) => {
			expect(show(line)).toBe(answer);
		});

		test("CRLF and a trailing newline around a duration", () => {
			expect(doc("PT1H30M\r\nP1D\n")).toEqual(["90 minutes", "1 day", ""]);
		});

		test.each([...fill("PT1H30M + X", NUMERIC_EDGES), ...fill("X * P1DT1H", NUMERIC_EDGES), ...fill("PTX1H", TEXT_EDGES)])("%j", (line) => {
			expectHonestLine(line, { allowNaN: line.includes("0/0") });
		});
	});
});
