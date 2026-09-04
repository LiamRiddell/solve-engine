/**
 * The two `Datetime` sidecars: what each shape records, that a reused arena
 * Value never inherits one, that both survive every round trip a `Value`
 * makes, and that nothing a reader sees changed because of them.
 *
 * What was wrong: a `Datetime` was epoch milliseconds and nothing else, so the
 * engine could not tell a calendar day from a wall-clock reading from a fixed
 * instant. `formatDatetime` guesses by testing whether the local hour, minute,
 * second and millisecond are all zero, and that guess is demonstrably wrong:
 * under `TZ=UTC` the nine o'clock in `2026-04-03T09:00:00+09:00` IS midnight,
 * so the reading the person typed disappears. Nothing downstream could recover
 * the distinction, because the number does not carry it.
 *
 * What is pinned here:
 *
 * - Each literal shape records the grain it actually has, and an ISO literal
 *   carrying `Z` or an offset records that offset as its zone.
 * - `recycle()` clears both, alongside the four sidecars that were already
 *   cleared there, so an arena Value that once held a day in Tokyo cannot lend
 *   that day, or that zone, to whatever the arena hands out next.
 * - Both survive `persistentValue` (the STORE_VAR round trip), the worker DTO
 *   and the snapshot. `persistentValue` builds a fresh `Value` field by field
 *   rather than cloning, so a sidecar not named there is dropped in silence:
 *   this is the test that would have caught it.
 * - The inertness guarantee: the formatter does not read either sidecar in
 *   2.26.0, so every date output measured on 2.25.0 is byte-identical. The
 *   strings below were run on 2.25.0 before the sidecars existed and are
 *   asserted as literals rather than recomputed.
 */
import { afterEach, describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { EngineSnapshot } from "@solve-js/engine/EngineSnapshot";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { Value, ValueType, datetimeValue, persistentValue } from "@solve-js/vm/Value";
import { formatValue } from "@solve-js/format/FormatEngine";
import { serializeValue } from "@solve-js/worker/serialize";
import { newTrackedEngine } from "@tools/trackedEngine";

// A restored engine is built by a static factory the constructor-only tracker
// cannot see, and it holds a query cache whose timers keep the process alive.
const restoredEngines: ExpressionEngine[] = [];
afterEach(() => {
	while (restoredEngines.length > 0) {
		try {
			restoredEngines.pop()?.clear();
		} catch {
			/* already torn down */
		}
	}
});

/** Snapshot an engine, force it through real JSON, and restore it. */
function roundTrip(snapshot: EngineSnapshot): ExpressionEngine {
	const restored = ExpressionEngine.fromJSON(snapshot, { packages: BUILTIN_PACKAGES });
	restoredEngines.push(restored);
	return restored;
}

/** The one Value a line evaluates to, through the single-expression path. */
function evaluate(expression: string): Value {
	return newTrackedEngine().evaluateLine(1, expression);
}

describe("the grain each shape records", () => {
	test("a calendar date is a day, in no named zone", () => {
		for (const spelling of ["2026-04-03", "3 April 2026", "03/04/2026", "25.12.2023", "2024-5-3"]) {
			const value = evaluate(spelling);
			expect(value.type).toBe(ValueType.Datetime);
			expect(value.grain).toBe("date");
			expect(value.zone).toBeUndefined();
		}
	});

	test("a wall-clock literal is a reading, in no named zone", () => {
		for (const spelling of ["2026-04-03T09:30", "6pm", "9:00am"]) {
			const value = evaluate(spelling);
			expect(value.type).toBe(ValueType.Datetime);
			expect(value.grain).toBe("datetime");
			expect(value.zone).toBeUndefined();
		}
	});

	test("an ISO literal carrying Z or an offset is an instant, and records the offset", () => {
		const utc = evaluate("2026-04-03T10:30:00Z");
		expect(utc.grain).toBe("instant");
		expect(utc.zone).toBe("UTCOFFSET:0");

		const tokyoOffset = evaluate("2026-04-03T10:30:00+09:00");
		expect(tokyoOffset.grain).toBe("instant");
		// An offset is recorded as an offset and never widened to a zone: `+09:00`
		// says nothing about Tokyo's daylight-saving rules.
		expect(tokyoOffset.zone).toBe("UTCOFFSET:540");

		const behind = evaluate("2026-04-03T10:30:00-05:00");
		expect(behind.grain).toBe("instant");
		expect(behind.zone).toBe("UTCOFFSET:-300");
	});

	test("now reads the clock, so it is a fixed instant", () => {
		const value = evaluate("now");
		expect(value.type).toBe(ValueType.Datetime);
		expect(value.grain).toBe("instant");
	});

	test("shifting a date keeps what it anchors and where it is read", () => {
		const shifted = evaluate("2026-04-03 + 1 day");
		expect(shifted.grain).toBe("date");
		expect(shifted.zone).toBeUndefined();

		const zoned = evaluate("2026-04-03 in Tokyo + 1 day");
		expect(zoned.grain).toBe("instant");
		expect(zoned.zone).toBe("Asia/Tokyo");

		const back = evaluate("2026-04-03 - 1 day");
		expect(back.grain).toBe("date");
	});
});

describe("a reused Value inherits neither", () => {
	test("recycle clears the grain and the zone", () => {
		const value = datetimeValue(1775170800000, "instant", "Asia/Tokyo");
		expect(value.grain).toBe("instant");
		expect(value.zone).toBe("Asia/Tokyo");

		value.recycle(ValueType.Number, 5);
		expect(value.grain).toBeUndefined();
		expect(value.zone).toBeUndefined();
	});
});

describe("both survive every round trip a Value makes", () => {
	test("persistentValue carries them, which is the STORE_VAR round trip", () => {
		const stored = persistentValue(datetimeValue(1775142000000, "instant", "Asia/Tokyo"));
		expect(stored.grain).toBe("instant");
		expect(stored.zone).toBe("Asia/Tokyo");
	});

	test("a stored variable read back is still the day in the zone it named", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "d = 2026-04-03 in Tokyo");
		const readBack = engine.evaluateLine(2, "d");
		expect(readBack.grain).toBe("instant");
		expect(readBack.zone).toBe("Asia/Tokyo");
		expect(readBack.value).toBe(Date.parse("2026-04-02T15:00:00Z"));
	});

	test("the worker DTO carries them, as plain JSON scalars", () => {
		const dto = serializeValue(datetimeValue(1775142000000, "instant", "Asia/Tokyo"));
		expect(dto.grain).toBe("instant");
		expect(dto.zone).toBe("Asia/Tokyo");
		// The DTO's whole contract is that it survives `structuredClone` and
		// `JSON` alike, so the two new fields are checked through both.
		expect(JSON.parse(JSON.stringify(dto))).toEqual(structuredClone(dto));
	});

	test("a value with no sidecars leaves both fields off the DTO", () => {
		const dto = serializeValue(datetimeValue(1775142000000));
		expect("grain" in dto).toBe(false);
		expect("zone" in dto).toBe(false);
	});

	test("a snapshot restore keeps them", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "d = 2026-04-03 in Tokyo");
		const snapshot = JSON.parse(JSON.stringify(engine.toJSON())) as EngineSnapshot;
		expect(snapshot.variables.d).toMatchObject({ g: "instant", z: "Asia/Tokyo" });

		const readBack = roundTrip(snapshot).evaluateLine(2, "d");
		expect(readBack.grain).toBe("instant");
		expect(readBack.zone).toBe("Asia/Tokyo");
	});

	test("a snapshot written before the sidecars existed still restores", () => {
		// The two fields are optional, which is why no `SNAPSHOT_VERSION` bump was
		// needed: a Datetime variant carrying neither is the shape every stored
		// snapshot already has, and it has to keep restoring.
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "d = 2026-04-03");
		const text = JSON.stringify(engine.toJSON()).replace(/,"g":"[a-z]+"/g, "").replace(/,"z":"[^"]*"/g, "");
		const snapshot = JSON.parse(text) as EngineSnapshot;
		expect(text).not.toContain('"g":');

		const readBack = roundTrip(snapshot).evaluateLine(2, "d");
		expect(readBack.type).toBe(ValueType.Datetime);
		expect(readBack.grain).toBeUndefined();
		expect(readBack.zone).toBeUndefined();
	});
});

describe("a date that names no zone renders exactly as it did", () => {
	// Measured on 2.25.0, before the sidecars existed, and asserted as literals
	// rather than recomputed: a value carrying no zone reads through the same
	// path it always did, so these strings cannot have moved.
	const unchanged: ReadonlyArray<readonly [string, string]> = [
		["2026-04-03", "= Friday, April 3, 2026"],
		["3 April 2026", "= Friday, April 3, 2026"],
		["03/04/2026", "= Friday, April 3, 2026"],
		["2024-5-3", "= Friday, May 3, 2024"],
		["25.12.2023", "= Monday, December 25, 2023"],
		["2026-04-03 + 1 day", "= Saturday, April 4, 2026"],
		["2026-04-03T09:30", "= Friday, April 3, 2026, 9:30:00 AM"],
	];

	test.each(unchanged)("%s still renders %s", (expression, expected) => {
		expect(formatValue(evaluate(expression))).toBe(expected);
	});

	test("the grain alone changes nothing", () => {
		const bare = datetimeValue(1775170800000);
		const carrying = datetimeValue(1775170800000, "instant");
		expect(formatValue(carrying)).toBe(formatValue(bare));
	});

	test("a named zone is read in that zone, which is the point of recording it", () => {
		// 1775142000000 is midnight on 3 April 2026 in Tokyo. Rendered in the
		// zone the line named it is that day; rendered in the zone the engine
		// computes in (Europe/London for this suite) it is the evening before,
		// which is the right instant answering a question nobody asked.
		const bare = datetimeValue(1775142000000);
		const inTokyo = datetimeValue(1775142000000, "instant", "Asia/Tokyo");
		expect(formatValue(inTokyo)).toBe("= Friday, April 3, 2026");
		expect(formatValue(bare)).not.toBe(formatValue(inTokyo));
	});
});
