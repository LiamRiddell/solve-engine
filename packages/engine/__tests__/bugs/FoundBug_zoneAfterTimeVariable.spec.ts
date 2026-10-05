import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestDocument, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { endsNamedTime, namesListedZone, zoneAfterNameAt, zoneAfterNameNormalizerRule } from "@solve-js/packages/time/normalizer/ZoneAfterNameNormalizerRule";
import { zoneConvertNamedHandler } from "@solve-js/packages/time/parselets/TimezonePluginFunctions";
import { ingredientNameNormalizerRule } from "@solve-js/packages/uom/normalizer/IngredientNameNormalizerRule";
import { ZONE_LOOKUP } from "@solve-js/packages/time/timezones/CityZones";
import { Value, ValueType, datetimeValue, errorValue, numberValue, pendingValue, stringValue } from "@solve-js/vm/Value";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";

/**
 * Found bug: `t = 3pm` then `t London in rio de janeiro` answered a cooking
 * error. The clock-time form (`3pm London in Tokyo`) reads its source zone
 * inside its own parselet, straight after the time it wrote out, and a time
 * held in a variable had no such reading. Worse, `t` is also a teaspoon, so the
 * ingredient rule read "london" as a substance measured in teaspoons and asked
 * for a mass or a volume.
 *
 * `zoneAfterNameNormalizerRule` now retypes the zone after a variable (or a
 * closing bracket) to `ZONE_SOURCE` in the whole shape `<name> <zone> in
 * <zone>`, an infix parselet reads the time before it, and
 * `zoneConvertNamedHandler` answers as the clock-time form does. The ingredient
 * rule leaves a unit spelling alone where a value starts, since there it is a
 * name the reader chose.
 */

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text).lines.map((l) => (l.result == null ? `ERROR ${l.error}` : l.result.isError() ? `ERROR ${l.result.errorMessage}` : formatValue(l.result)));
}

describe("the lines that exposed it", () => {
	test("a time in a variable, converted from the zone after it", () => {
		expect(doc("t = 3pm\nt London in rio de janeiro")[1]).toBe("= 11:00 AM");
		expect(doc("t = 3pm\nt London in Tokyo, New York")[1]).toBe("= Tokyo 11:00 PM, New York 10:00 AM");
		expect(doc("t = 3pm\n(t + 1 hour) London in Tokyo")[1]).toBe("= 12:00 AM (+1 day)");
		expect(doc("m = 3pm\nm London in Tokyo")[1]).toBe("= 11:00 PM");
	});

	test("the variable form answers as the clock-time form does", () => {
		expect(doc("t = 3pm\nt London in Tokyo")[1]).toBe(doc("3pm London in Tokyo")[0]);
		expect(doc("t = 3pm\nt London in rio de janeiro")[1]).toBe(doc("3pm London in rio de janeiro")[0]);
	});

	test("a variable that holds something else is refused by name, and an undefined one is named", () => {
		expect(doc("t = 5\nt London in Tokyo")[1]).toBe('ERROR A zone after a name converts the time of day it holds, as in "t London in Tokyo" with t = 3pm, and this holds a number.');
		expect(doc("t London in Tokyo")[0]).toBe("ERROR Undefined variable: t");
	});

	test("the cooking and variable forms it sat beside are unchanged", () => {
		expect(doc("2 cups butter in grams")[0]).toBe("= 454.01 grams");
		expect(doc("london = 5\nlondon * 2")[1]).toBe("= 10");
		expect(doc("3pm London in Tokyo")[0]).toBe("= 11:00 PM");
	});
});

// ── The parts ────────────────────────────────────────────────────────────

function tokens(...spec: Array<[string, string]>): Token[] {
	return spec.map(([type, value], i) => ({ type, typeId: tokenTypeId(type), value, text: value, offset: i * 8 }) as Token);
}

describe("namesListedZone and endsNamedTime", () => {
	test("a city, an abbreviation and a country the table lists, in any case", () => {
		expect(namesListedZone(tokens(["IDENT", "London"])[0])).toBe(true);
		expect(namesListedZone(tokens(["CITY_NAME", "new york"])[0])).toBe(true);
		expect(namesListedZone(tokens(["UNIT", "JST"])[0])).toBe(true);
		expect(namesListedZone(tokens(["IDENT", "atlantis"])[0])).toBe(false);
		expect(namesListedZone(tokens(["NUMBER", "5"])[0])).toBe(false);
		expect(namesListedZone(undefined)).toBe(false);
	});

	test("prototype words are not zones", () => {
		for (const word of PROTOTYPE_WORDS) expect(namesListedZone(tokens(["IDENT", word])[0])).toBe(false);
	});

	test("a name where a value starts, or a closing bracket, ends a named time; a unit after a number does not", () => {
		expect(endsNamedTime(tokens(["IDENT", "t"]), 0)).toBe(true);
		expect(endsNamedTime(tokens(["UNIT", "m"]), 0)).toBe(true);
		expect(endsNamedTime(tokens(["RPAREN", ")"]), 0)).toBe(true);
		expect(endsNamedTime(tokens(["NUMBER", "1"], ["UNIT", "t"]), 1)).toBe(false);
		expect(endsNamedTime(tokens(["NUMBER", "1"]), 0)).toBe(false);
		expect(endsNamedTime([], 0)).toBe(false);
	});
});

describe("zoneAfterNameAt and the rule", () => {
	const shape = tokens(["IDENT", "t"], ["IDENT", "London"], ["IN", "in"], ["IDENT", "Tokyo"]);

	test("the whole shape: a named time, a listed zone, in, and a zone", () => {
		expect(zoneAfterNameAt(shape, 0)).toBe(true);
		const out = zoneAfterNameNormalizerRule().match(shape, 0);
		expect(out?.replacement.map((t) => [t.type, t.value])).toEqual([["IDENT", "t"], ["ZONE_SOURCE", "London"]]);
	});

	test("any part missing leaves the line alone", () => {
		expect(zoneAfterNameAt(tokens(["IDENT", "t"], ["IDENT", "London"]), 0)).toBe(false);
		expect(zoneAfterNameAt(tokens(["IDENT", "t"], ["IDENT", "London"], ["IN", "in"], ["UNIT", "kg"]), 0)).toBe(false);
		expect(zoneAfterNameAt(tokens(["IDENT", "x"], ["IDENT", "cat"], ["IN", "in"], ["IDENT", "Tokyo"]), 0)).toBe(false);
		expect(zoneAfterNameAt(tokens(["NUMBER", "1"], ["UNIT", "t"], ["IDENT", "London"], ["IN", "in"], ["IDENT", "Tokyo"]), 1)).toBe(false);
		expect(zoneAfterNameAt([], 0)).toBe(false);
	});
});

describe("the ingredient rule leaves a name where a value starts alone", () => {
	const rule = ingredientNameNormalizerRule();
	test("after an amount it reads the substance, at the start of a line it does not", () => {
		expect(rule.match(tokens(["NUMBER", "1"], ["UNIT", "t"], ["IDENT", "butter"], ["IN", "in"], ["UNIT", "g"]), 2)).not.toBeNull();
		expect(rule.match(tokens(["UNIT", "t"], ["IDENT", "london"], ["IN", "in"], ["IDENT", "tokyo"]), 1)).toBeNull();
	});
});

describe("zoneConvertNamedHandler", () => {
	const london = ZONE_LOOKUP["london"];
	const tokyo = ZONE_LOOKUP["tokyo"];
	const at = (time: Value, ...targets: string[]): Value =>
		zoneConvertNamedHandler([time, stringValue(london), stringValue("London"), ...targets.flatMap((t) => [stringValue(ZONE_LOOKUP[t.toLowerCase()]), stringValue(t)])]);

	test("a time read as London's wall clock, in one zone and in several", () => {
		// 23 September 2026, 15:00 on the engine's own clock, as `3pm` on that day is.
		const threePm = datetimeValue(new Date(2026, 8, 23, 15, 0).getTime());
		expect(formatValue(at(threePm, "Tokyo"))).toBe("= 11:00 PM");
		expect(formatValue(at(threePm, "Tokyo", "Paris"))).toBe("= Tokyo 11:00 PM, Paris 4:00 PM");
		expect(tokyo).toBeDefined();
	});

	test("a failed or pending time passes through; anything else, and nothing, is refused by name", () => {
		const failed = errorValue("X", "no");
		expect(at(failed, "Tokyo")).toBe(failed);
		const pending = pendingValue("k");
		expect(at(pending, "Tokyo")).toBe(pending);
		expect(at(numberValue(5), "Tokyo").errorCode).toBe("TIME_ZONE_EXPECTED_TIME");
		expect(at(stringValue("3pm"), "Tokyo").errorMessage).toContain("this holds");
		expect(zoneConvertNamedHandler([]).errorCode).toBe("TIME_ZONE_EXPECTED_TIME");
	});

	test("a time outside the calendar's range is refused rather than written as NaN", () => {
		// The value is refused where it is built (DATE_OUT_OF_RANGE), and a
		// failed time passes through the zone unchanged.
		expect(at(datetimeValue(8.64e15 * 2), "Tokyo").errorCode).toBe("DATE_OUT_OF_RANGE");
		expect(at(datetimeValue(NaN), "Tokyo").errorCode).toBe("DATE_OUT_OF_RANGE");
		// A datetime built past the constructor still meets the zone's own guard.
		for (const instant of [8.64e15 * 2, NaN]) {
			expect(at(new Value(ValueType.Datetime, instant), "Tokyo").errorCode).toBe("TIME_ZONE_EXPECTED_TIME");
		}
	});

	test("a skipped wall-clock reading is refused as the clock-time form refuses it", () => {
		// 1:30am in London on 29 March 2026 does not happen: the clocks go forward.
		const skipped = datetimeValue(new Date(2026, 2, 29, 1, 30).getTime());
		expect(at(skipped, "Tokyo").errorCode).toBe(newTrackedEngine().evaluateExpression("1:30am London on 29 March 2026 in Tokyo").errorCode);
	});
});

describe("adversarial", () => {
	test("security: prototype words as the variable and as the zone, markup after the line, and the prototype untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestDocument(`${word} = 3pm\n${word} London in Tokyo`);
				expectHonestDocument(`t = 3pm\nt ${word} in Tokyo`);
				expectHonestDocument(`t = 3pm\nt London in ${word}`);
			}
		});
		for (const line of fill("t London in Tokyo X", TEXT_EDGES)) expectHonestDocument(`t = 3pm\n${line}`);
		expectHonestDocument(`t = 3pm\nt London in ${Array.from({ length: 200 }, () => "Tokyo").join(", ")}`);
	});

	test("realistic: the time from the line above through both passes, the single-line path, and a typo in the zone", () => {
		const text = "t = 3pm\nt London in Tokyo\nt Londn in Tokyo";
		const { batch, incremental } = expectHonestDocument(text);
		expect(batch[1]).toBe("= 11:00 PM");
		expect(batch[2]).toMatch(/^ERROR /);
		expect(incremental).toEqual(batch);
		expect(evaluateDocument(newTrackedEngine(), text).lines[1].result?.toString()).toBe(newTrackedEngine().parseDocument(text).lines[1].result?.toString());
		expect(() => newTrackedEngine().evaluateLine(1, "t London in Tokyo")).toThrow(/Undefined variable: t/);
	});

	test("edge: every numeric edge as the variable's value, a date with a time, and CRLF", () => {
		for (const line of fill("t = X", NUMERIC_EDGES)) expectHonestDocument(`${line}\nt London in Tokyo`, { allowNaN: true });
		expect(doc("t = 2026-09-23T15:00\nt London in Tokyo")[1]).toBe("= 11:00 PM");
		expect(doc("t = 3pm\r\nt London in Tokyo\r\n")[1]).toBe("= 11:00 PM");
	});
});
