/**
 * The span between two dates is a calendar distance, not elapsed time.
 *
 * `<unit> between <a> and <b>` measured the raw millisecond gap and let the
 * unit machinery divide it by a fixed 86,400,000. A daylight-saving
 * transition between the two dates therefore leaked an hour into the answer,
 * and its sign followed the hemisphere: `days between 01/01/2024 and
 * 01/06/2024` was 151.96 days in London and 152.04 in Auckland, when the
 * answer is 152 days for every reader. The documented `weeks between` example
 * failed in Auckland for the same reason, which is how this was found.
 *
 * Two local midnights are now measured in whole calendar days. Either
 * endpoint carrying a time of day is elapsed time again, because
 * `hours between 09:00 and 17:30` is a duration and the transition belongs
 * in it.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Every zone below is exercised through the engine's own calendar, so the host zone does not decide the answer. */
const answer = (expression: string): string => {
	const engine = newTrackedEngine();
	try {
		return formatValue(engine.evaluateExpression(expression)).replace(/^=\s*/, "");
	} finally {
		engine.clear();
	}
};

describe("a span across a daylight-saving transition", () => {
	test("counts whole days", () => {
		// 1 January to 1 June 2024 is 152 days; the northern clocks go forward
		// in March and the southern go back in April, and neither may show.
		expect(answer("days between 01/01/2024 and 01/06/2024")).toBe("152 days");
		expect(answer("days between 01/03/2024 and 01/04/2024")).toBe("31 days");
	});

	test("and the weeks the docs example asks for", () => {
		expect(answer("weeks between 01/01/2024 and 01/06/2024")).toBe("21.71 weeks");
	});

	test("in either direction, since between has no direction", () => {
		expect(answer("days between 01/06/2024 and 01/01/2024")).toBe("152 days");
	});
});

describe("what is unchanged", () => {
	test("a span with no transition in it", () => {
		expect(answer("days between 01/01/2024 and 01/02/2024")).toBe("31 days");
		expect(answer("weeks between 01/01/2024 and 15/01/2024")).toBe("2 weeks");
	});

	test("a span between two dates, asked for in hours", () => {
		expect(answer("hours between 01/01/2024 and 02/01/2024")).toBe("24 hours");
	});

	test("a span with a time of day is elapsed time", () => {
		// Neither endpoint is midnight, so the calendar-day reading does not
		// apply and the answer is the duration between the two wall-clock
		// readings. (A date written with a time beside it, `01/01/2024 09:00`,
		// is not a literal this grammar reads; clock times are.)
		expect(answer("hours between 9am and 5pm")).toBe("8.00 hours");
	});
});
