/**
 * Every example expression Soulver's own documentation states a result for,
 * run against this engine.
 *
 * This exists because `docs-internal/SOULVERCORE_FEATURE_AUDIT.md` was written
 * by reading the code and asking "do we have something in this area", and the
 * answer to that question is not the same as "does the documented syntax work".
 * It marked 39 of 40 pages implemented. Measured, 94 of the 122 documented
 * examples below produce the documented answer, 17 do not, and 11 differ only
 * in formatting. It credited `as timespan` and
 * `as laptime` to `packages/time`, where the only occurrence of the word
 * "timespan" is a doc comment. It credited the rounding page to `as decimal`
 * plus the formatter's rounding config, and not one of the ten documented
 * rounding forms parses.
 *
 * An audit that is written once and never executed drifts to fiction. This one
 * runs.
 *
 * ## How it fails
 *
 * The corpus is split by what the engine does today, not by what it should do.
 * `SUPPORTED` entries are asserted to match. `GAPS` entries are asserted to
 * still be broken. Both directions fail:
 *
 * - Break something in `SUPPORTED` and you get a normal test failure.
 * - Fix something in `GAPS` and the run fails telling you to promote the row,
 *   which is what keeps the recorded gap count honest instead of letting it
 *   quietly shrink or grow without anyone noticing.
 *
 * That second direction is the point. The previous audit could only ever get
 * more wrong over time, because nothing re-read it.
 *
 * ## What "matches" means
 *
 * Loosely, on purpose. Soulver renders `10,000 m` where this engine renders
 * `10000.00 m`, and comparing those strictly would drown the real signal in
 * formatting noise. Separators and case are ignored and the leading `= ` is
 * stripped; the digits and the unit still have to agree. Where a difference IS
 * purely presentational it is recorded in `FORMATTING_ONLY` rather than being
 * hidden, so the distinction between "we compute something else" and "we print
 * it differently" stays visible.
 *
 * Source: https://documentation.soulver.app/llms.txt, syntax-reference pages,
 * fetched 2026-08-06.
 */

import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";

/** One documented example: the page it came from, the input, Soulver's answer. */
type Example = readonly [page: string, expression: string, soulver: string];

/**
 * Documented examples this engine already answers correctly.
 *
 * Adding a row here is how a newly-implemented feature gets locked in.
 */
const SUPPORTED: readonly Example[] = [
	["operators", "30 plus 20", "50"],
	["operators", "3,000 minus 12", "2988"],
	["operators", "3 to the power of 2", "9"],

	["averages", "total of 3, 4, 7 and 9", "23"],
	["averages", "average of 36, 42, 19 and 81", "44.5"],
	["averages", "count of 1, 2, 3, 4, 5", "5"],
	["averages", "median of 10, 20 and 30", "20"],

	["misc", "$100 as number", "100"],
	["misc", "20% as dec", "0.2"],
	["misc", "6 is to 60 as 8 is to what", "80"],
	["misc", "larger of 100 and 200", "200"],
	["misc", "smaller of 5 and 10", "5"],
	["misc", "half of 175", "87.5"],
	["misc", "midpoint between 150 and 300", "225"],
	["misc", "clamp 26 between 5 and 25", "25"],

	["percentages", "10% of 200", "20"],
	// A percentage combined with a quantity is relative to it (2026-08-06).
	["percentages", "200 + 10%", "220"],
	["percentages", "200 - 10%", "180"],
	["percentages", "10% + 20%", "30%"],
	["percentages", "30% + 0.4", "70%"],
	["fractions", "2/10 as fraction", "1/5"],
	["fractions", "50% as fraction", "1/2"],
	["fractions", "2/3 of 600", "400"],

	["logs-roots", "sqrt(16)", "4"],
	["logs-roots", "cbrt(343)", "7"],

	["bases", "256 as hex", "0x100"],
	["bases", "int(0o55)", "45"],
	["bases", "hex(99)", "0x63"],
	["bases", "bin(0x73)", "0b1110011"],

	["units", "100 pounds in kg", "45.36 kg"],
	["units", "$20 + 30", "$50.00"],

	["cooking", "300g butter in cups", "1.32 cup"],

	// The one money-and-finance page that genuinely works, to the cent.
	["mortgages", "daily repayment on $10,000 over 6 years at 6%", "5.45"],
	["mortgages", "monthly repayment on $10,000 over 6 years at 6%", "165.73"],
	["mortgages", "annual repayment on $10,000 over 6 years at 6%", "1988.75"],
	["mortgages", "total repayment on $10,000 over 6 years at 6%", "11932.48"],
	["mortgages", "daily interest on $10,000 over 6 years at 6%", "0.88"],
	["mortgages", "monthly interest on $10,000 over 6 years at 6%", "26.84"],
	["mortgages", "annual interest on $10,000 over 6 years at 6%", "322.08"],
	["mortgages", "total interest on $10,000 over 6 years at 6%", "1932.48"],

	// The investments page (2026-08-06). Mortgages already worked.
	["investments", "$1,000 after 3 years at 7%", "1225.04"],
	["investments", "$1,000 for 3 years at 7% compounding monthly", "1232.93"],
	["investments", "$1,000 for 3 years at 7% compounding quarterly", "1231.44"],
	["investments", "interest on $1,000 after 3 years @ 7%", "225.04"],
	["investments", "annual return on $1,000 invested $2,500 returned after 7 years", "13.99%"],
	["investments", "present value of $1,000 after 20 years at 10%", "148.64"],
	["sales-tax", "tax on $300 at 15%", "45"],
	["trig", "sin(90 degrees)", "1"],

	["percentages", "10% on 200", "220"],
	["percentages", "10% off 200", "180"],
	["trig", "sind(90)", "1"],
	["trig", "asind(0.5)", "30"],

	// The is-what family, base prepositions and the multiplier fix (2026-08-06).
	["multipliers", "20/5 as multiplier", "4x"],
	["percentages", "20 is 10% of what", "200"],
	["percentages", "180 is what % off 200", "10%"],
	["percentages", "20 is what % of 200", "10%"],
	["percentages", "50 to 75 is what %", "50%"],
	["fractions", "50 is 1/5 of what", "250"],
	["logs-roots", "81 is 9 to what power", "2"],
	["bases", "99 in binary", "0b1100011"],
	["bases", "0x9F31 to decimal", "40753"],
	["bases", "0b101101 as base 8", "0o55"],

	// Reversed conversions, "how many X in Y" (2026-08-06).
	["units", "meters in 10 km", "10000 m"],
	["units", "days in 3 weeks", "21 days"],
	["units", "seconds in a day", "86400 s"],

	// Compound duration quantities and the timespan converters (2026-08-06).
	["units", "5 hours 30 minutes to seconds", "19800"],
	["timespans", "72 days as timespan", "10 weeks 2 days"],
	["timespans", "5.5 minutes as laptime", "00:05:30"],

	// Unblocked by month-name date literals (2026-08-06).
	["dates", "days between 3 March and 30 May", "88 days"],
	["workdays", "day of the week on January 24, 1984", "Tuesday"],
	["workdays", "weekday on March 9, 2024", "Saturday"],

	// Remainder, nth roots, base logs and base-relative multipliers (2026-08-06).
	["multipliers", "2 as multiplier of 1", "2x"],
	["operators", "remainder of 21 divided by 5", "1"],
	["multipliers", "50 as x of 5", "10x"],
	["multipliers", "20 to 40 as x", "2x"],
	["logs-roots", "root 5 of 100", "2.5118864315"],
	["logs-roots", "log 20 base 4", "2.1609640474"],

	// Operations spelled out in words (2026-08-06).
	["operators", "3 multiplied by 4", "12"],
	["operators", "1,000 divided by 200", "5"],
	["misc", "greater of 100 and 200", "200"],
	["misc", "lesser of 5 and 10", "5"],
	["misc", "gcd of 20 and 30", "10"],
	["misc", "lcm of 5 and 8", "40"],
	["logs-roots", "square root of 81", "9"],
	["logs-roots", "cube root of 27", "3"],

	// The rounding page (2026-08-06).
	["rounding", "1/3 to 2 dp", "0.33"],
	["rounding", "5.5 rounded", "6"],
	["rounding", "5.5 rounded down", "5"],
	["rounding", "5.5 rounded up", "6"],
	["rounding", "37 to nearest 10", "40"],
	["rounding", "2,100 to nearest thousand", "2000"],
	["rounding", "21 rounded up to nearest 5", "25"],

	["conditionals", "20km == 20,000 m", "true"],
	["conditionals", "if 5 > 3 then 10 else 20", "10"],
];

/**
 * Documented examples this engine gets wrong or cannot parse.
 *
 * Grouped by why, because the three groups need different work. Fixing one
 * means moving its row into `SUPPORTED`, and the test below will insist on it.
 */
const GAPS: readonly Example[] = [
	// -- Answers confidently, incorrectly. The worst category: a wrong number
	// -- with no error is not recoverable by the person reading it.
	// "value of $X in <future year> assuming N% inflation" is deliberately not
	// listed: it discounts from the CURRENT year, so the figure Soulver's page
	// quotes ($411.35, written when "now" was 2024) is not reproducible from a
	// fixed string. The direction was wrong (it compounded up) and is fixed;
	// InflationParselets.spec.ts asserts the relationship against the real
	// current year, which is the only stable way to state it.
	["inflation", "what is $4.2k from 2003", "6795.58"], // gives 7473.26: CPI table disagrees
	["inflation", "what was $500 worth in 1997", "269.56"], // gives 245.11

	// -- Not implemented. Parses to an error rather than a wrong number, which
	// -- at least tells the truth.
	["rates", "3 hours / day", "3 hours/day"],
	["rates", "$99 per week", "$99.00/week"],
	["rates", "$20/day + $300/week", "$440.00/week"],
	["rates", "$24 a day for a year", "8765.82"],
	["rates", "30 hours at $30/hour", "900"],
	["rates", "$500 at $20/hour", "25 hours"],
	// Money times a duration. Soulver reads this as   per day for 4 days.
	["units", "$30 * 4 days", "120"],
	["timespans", "03:04:05 + 01:02:03", "04:06:08"],
	["timespans", "12.5 minutes in minutes and seconds", "12 min 30 s"],
	["clock", "16:00 + 3 hours 12 minutes", "7:12 pm"],
	["clock", "7:30 to 20:45", "3 hours 15 min"],
	["clock", "4pm to 3am", "11 hours"],
	["dates", "days in Q3", "92 days"],
	["dates", "days in February 2020", "29 days"],
	["dates", "week number on march 12, 2021", "10"],
];

/**
 * Right number, different presentation. Kept out of `GAPS` so the gap count
 * measures capability rather than formatting taste, and written down rather
 * than dropped so the differences stay visible if the formatter is ever
 * aligned with Soulver's.
 */
const FORMATTING_ONLY: readonly (readonly [string, string, string])[] = [
	["10 km in m", "10,000 m", "10000.00 m"],
	["0.35 as %", "35%", "35.00%"],
	["40 to 90 as %", "125%", "125.00%"],
	["100,000 + 200,000", "300k", "300,000"],
	// The word magnitudes parse and compute correctly (2026-08-06); Soulver
	// abbreviates large answers in its output and this engine does not.
	["3 million + 10%", "3.3M", "3,300,000"],
	["5 billion", "5G", "5,000,000,000"],
	["2.5 bn", "2.5G", "2,500,000,000"],
	// The right number. Soulver renders a return as a multiplier; this keeps
	// it numeric so it stays composable.
	["$500 invested $1,500 returned", "2x", "2"],
	// Right duration, written out in full rather than abbreviated.
	["5.5 minutes as timespan", "5 min 30 s", "5 minutes 30 seconds"],
	// A compound quantity is summed into its smallest unit and rendered as
	// that total. The arithmetic is identical; Soulver restates the parts.
	["3 hours 5 minutes 10 seconds in seconds", "11110 s", "11110"],
	["3h 5m 10s in seconds", "11110 s", "11110"],
	// Right count, but the "workdays" label is dropped from the answer.
	["workdays in 3 weeks", "15 workdays", "15"],
];

/**
 * Soulver's answer against this engine's.
 *
 * Compares the leading number numerically rather than as text, so `10000.00 m`
 * satisfies `10,000 m`, and requires any trailing unit or suffix to appear too.
 * Substring matching was the obvious first attempt and it is wrong in the one
 * place it matters most: `$345.00` contains `45`, so the sales-tax bug, where
 * the engine returns the total and Soulver returns the tax, read as a pass.
 */
function matches(got: string, soulver: string): boolean {
	const clean = (s: string) => s.replace(/^=\s*/, "").replace(/[\s,$€£]/g, "").toLowerCase();
	const a = clean(got);
	const b = clean(soulver);
	if (a === b) return true;
	if (a.startsWith("threw:")) return false;

	const numberOf = (s: string) => {
		const m = s.match(/-?\d+(?:\.\d+)?/);
		return m ? Number(m[0]) : null;
	};
	const suffixOf = (s: string) => s.replace(/-?\d+(?:\.\d+)?/, "").replace(/^\./, "");

	const wanted = numberOf(b);
	const actual = numberOf(a);
	if (wanted === null || actual === null) return a.includes(b);

	// Soulver's docs quote rounded figures, so an exact comparison would fail
	// on its own published numbers. A relative tolerance keeps `2.5118864315`
	// meaningful while letting `1.32 cup` match `1.3200`.
	const tolerance = Math.max(Math.abs(wanted) * 0.001, 0.005);
	if (Math.abs(actual - wanted) > tolerance) return false;

	// A bare number must not satisfy a unit-bearing expectation: `21` is not
	// `21 days`, and `2` is not `2x`.
	const wantedSuffix = suffixOf(b);
	return wantedSuffix === "" || a.includes(wantedSuffix);
}

/** Evaluates one line, returning the formatted answer or the thrown message. */
function evaluate(expression: string): string {
	const engine = newTrackedEngine("en");
	try {
		const values = engine.evaluateExpression(expression);
		const list = Array.isArray(values) ? values : [values];
		return list
			.map((value) => {
				try {
					return formatValue(value, DEFAULT_FORMATTING_SETTINGS) ?? String(value?.value);
				} catch {
					return String(value?.value ?? value);
				}
			})
			.join(" | ");
	} catch (error) {
		return `THREW: ${(error as Error)?.message}`;
	}
}

describe("Soulver parity — documented examples that work", () => {
	test.each(SUPPORTED)("[%s] %s", (_page, expression, soulver) => {
		const got = evaluate(expression);
		// Reported as an object so a failure prints what Soulver says next to
		// what this engine said, rather than just "false is not true".
		expect({ expression, soulver, got, matches: matches(got, soulver) }).toEqual({
			expression,
			soulver,
			got,
			matches: true,
		});
	});
});

describe("Soulver parity — documented examples that do not", () => {
	/**
	 * The direction that keeps this file honest. A row that starts passing is
	 * reported as a failure so it gets promoted into `SUPPORTED`, rather than
	 * sitting here making the engine look worse than it is.
	 */
	test("every recorded gap is still a gap", () => {
		const fixed = GAPS.filter(([, expression, soulver]) => matches(evaluate(expression), soulver)).map(
			([page, expression]) => `[${page}] ${expression}`,
		);
		expect({
			message: "These now produce Soulver's answer. Move them into SUPPORTED.",
			fixed,
		}).toEqual({
			message: "These now produce Soulver's answer. Move them into SUPPORTED.",
			fixed: [],
		});
	});

	test("the recorded gap count is what the audit claims", () => {
		// Cross-checked by docs-internal/SOULVERCORE_FEATURE_AUDIT.md, which
		// quotes this number. A change here without a change there leaves the
		// audit stating a total it did not measure, which is how the previous
		// version of that document ended up fictional.
		expect(GAPS.length).toBe(17);
		expect(SUPPORTED.length).toBe(94);
	});
});

describe("Soulver parity — same answer, different formatting", () => {
	test.each(FORMATTING_ONLY)("%s", (expression, _soulver, ours) => {
		// Asserted so that aligning the formatter with Soulver's output is a
		// deliberate, visible change rather than a silent one.
		expect(evaluate(expression)).toContain(ours);
	});
});
