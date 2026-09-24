/**
 * Geo: places by their coordinates, the great-circle distance and initial
 * bearing between two of them, and angles in degrees, minutes and seconds.
 *
 * The reference figures are not this package's own output read back. They were
 * computed separately, in Python, with the atan2 form of the spherical central
 * angle rather than the haversine this package uses, on the same sphere of
 * mean radius 6,371.0088 km; the two formulas agree to far better than the
 * tolerances asserted. The places are city-centre coordinates as a map gives
 * them (London 51.5074, -0.1278; Paris 48.8566, 2.3522; Tokyo 35.6762,
 * 139.6503; New York 40.7128, -74.0060; Sydney -33.8688, 151.2093).
 *
 * The analytic cases need no reference at all: half the Earth's circumference
 * is pi times the radius, a quarter is half that, and one degree of arc is
 * pi / 180 of the radius, which is the figure a pair either side of the 180°
 * meridian must give, and not 359 degrees' worth the long way round.
 */

import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import {
	EARTH_MEAN_RADIUS_KM,
	GEO_PACKAGE,
	anglePartsToDegrees,
	formatDms,
	formatPlaceDms,
	greatCircleKm,
	initialBearing,
	placeProblem,
} from "@solve-js/packages/geo";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

const LONDON = { lat: 51.5074, lon: -0.1278 };
const PARIS = { lat: 48.8566, lon: 2.3522 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };
const NEW_YORK = { lat: 40.7128, lon: -74.006 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };

/** Evaluate one line on a fresh engine. */
const evaluate = (expression: string): Value => {
	const engine = newTrackedEngine();
	try {
		return engine.evaluateExpression(expression);
	} finally {
		engine.clear();
	}
};

/** A line's display, the leading marker removed. */
const answer = (expression: string): string => formatValue(evaluate(expression)).replace(/^=\s*/, "");

/** A refusal's code and message, asserting it is a refusal and not a throw or a number. */
const refusal = (expression: string): { code: string; message: string } => {
	const value = evaluate(expression);
	expect(value.type).toBe(ValueType.Error);
	return { code: String(value.value), message: String(value.unit) };
};

describe("great-circle distance, against independent figures", () => {
	test.each([
		["London to Paris", LONDON, PARIS, 343.556535],
		["London to Tokyo", LONDON, TOKYO, 9558.574574],
		["New York to London", NEW_YORK, LONDON, 5570.229874],
		["Sydney to London", SYDNEY, LONDON, 16993.956933],
	])("%s", (_name, a, b, km) => {
		expect(greatCircleKm(a, b)).toBeCloseTo(km, 5);
		// Distance does not care which way it is measured.
		expect(greatCircleKm(b, a)).toBeCloseTo(km, 5);
	});

	test("antipodes are half the circumference apart, pi times the radius", () => {
		const half = Math.PI * EARTH_MEAN_RADIUS_KM;
		expect(greatCircleKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(half, 6);
		expect(greatCircleKm({ lat: 90, lon: 0 }, { lat: -90, lon: 0 })).toBeCloseTo(half, 6);
		expect(greatCircleKm(SYDNEY, { lat: 33.8688, lon: -28.7907 })).toBeCloseTo(half, 6);
	});

	test("a quarter of the way round is a pole from the equator, or 90° along it", () => {
		const quarter = (Math.PI * EARTH_MEAN_RADIUS_KM) / 2;
		expect(greatCircleKm({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(quarter, 6);
		expect(greatCircleKm({ lat: 90, lon: 45 }, { lat: 0, lon: 0 })).toBeCloseTo(quarter, 6);
	});

	test("across the 180° meridian the short way, one degree and not 359", () => {
		const oneDegree = (Math.PI * EARTH_MEAN_RADIUS_KM) / 180;
		expect(greatCircleKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(oneDegree, 6);
		expect(oneDegree).toBeCloseTo(111.19508, 5);
	});

	test("the same place is no distance, and every longitude at a pole is the pole", () => {
		expect(greatCircleKm(LONDON, LONDON)).toBe(0);
		expect(greatCircleKm({ lat: 90, lon: 0 }, { lat: 90, lon: 120 })).toBeCloseTo(0, 9);
	});
});

describe("initial bearing, against independent figures", () => {
	test.each([
		["London to Paris", LONDON, PARIS, 148.115617],
		["London to Tokyo", LONDON, TOKYO, 31.726451],
		["New York to London", NEW_YORK, LONDON, 51.212617],
		["London to New York", LONDON, NEW_YORK, 288.329702],
		["Sydney to London", SYDNEY, LONDON, 319.171427],
		["London to Sydney", LONDON, SYDNEY, 60.713386],
	])("%s", (_name, a, b, degrees) => {
		expect(initialBearing(a, b)).toBeCloseTo(degrees, 5);
	});

	test("the four compass points along the equator and a meridian", () => {
		expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(90, 9);
		expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: -90 })).toBeCloseTo(270, 9);
		expect(initialBearing({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBe(0);
		expect(initialBearing({ lat: 10, lon: 0 }, { lat: 0, lon: 0 })).toBeCloseTo(180, 9);
	});

	test("across the 180° meridian, east is still east", () => {
		expect(initialBearing({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(90, 9);
		expect(initialBearing({ lat: 0, lon: -179.5 }, { lat: 0, lon: 179.5 })).toBeCloseTo(270, 9);
	});

	test("towards the North Pole is due north, never a rounding error short of 360", () => {
		expect(initialBearing(LONDON, { lat: 90, lon: 0 })).toBe(0);
		expect(initialBearing({ lat: 51.5, lon: 0.1 }, { lat: 90, lon: 0 })).toBe(0);
	});

	test("from a pole every direction is the same one, whatever longitude the pole was given", () => {
		expect(initialBearing({ lat: 90, lon: 0 }, LONDON)).toBe(180);
		expect(initialBearing({ lat: 90, lon: 77 }, SYDNEY)).toBe(180);
		expect(initialBearing({ lat: -90, lon: 0 }, TOKYO)).toBe(0);
	});

	test("the same place and exact opposites have no single bearing, and say which", () => {
		expect(initialBearing(LONDON, LONDON)).toBe("same place");
		expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBe("antipodes");
		expect(initialBearing(LONDON, { lat: -51.5074, lon: 179.8722 })).toBe("antipodes");
	});
});

describe("degrees, minutes and seconds", () => {
	test("written out to a hundredth of a second, padded as a map pads them", () => {
		expect(formatDms(51.5074)).toBe(`51°30'26.64"`);
		expect(formatDms(51.5075)).toBe(`51°30'27"`);
		expect(formatDms(0.1278)).toBe(`0°07'40.08"`);
		expect(formatDms(-33.8688)).toBe(`-33°52'07.68"`);
		expect(formatDms(1.5)).toBe(`1°30'00"`);
	});

	test("a value that rounds up carries into the minutes and degrees, never 60 seconds", () => {
		expect(formatDms(0.9999999)).toBe(`1°00'00"`);
		expect(formatDms(10.0166666666)).toBe(`10°01'00"`);
	});

	test("a negative angle too small to show is not written as minus zero", () => {
		expect(formatDms(-0.000000001)).toBe(`0°00'00"`);
	});

	test("a place carries compass letters instead of signs", () => {
		expect(formatPlaceDms(LONDON)).toBe(`51°30'26.64"N 0°07'40.08"W`);
		expect(formatPlaceDms(SYDNEY)).toBe(`33°52'07.68"S 151°12'33.48"E`);
	});

	test("the parts of a literal become signed decimal degrees", () => {
		const degreesOf = (answer: { degrees: number } | { problem: string }): number =>
			"degrees" in answer ? answer.degrees : Number.NaN;
		expect(degreesOf(anglePartsToDegrees("51", "30", "27", undefined))).toBeCloseTo(51.5075, 12);
		expect(degreesOf(anglePartsToDegrees("33", "52.128", undefined, "S"))).toBeCloseTo(-33.8688, 12);
		expect(degreesOf(anglePartsToDegrees("0.1278", undefined, undefined, "W"))).toBe(-0.1278);
	});

	test("parts that do not make an angle say which part is wrong", () => {
		expect(anglePartsToDegrees("51", "75", undefined, undefined)).toEqual({
			problem: `51°75' has 75 minutes: minutes of arc run from 0 to 59, and 60 of them make a degree`,
		});
		expect(anglePartsToDegrees("51", "30", "60", undefined)).toHaveProperty("problem");
		expect(anglePartsToDegrees("51.5", "30", undefined, undefined)).toHaveProperty("problem");
		expect(anglePartsToDegrees("51", "30.5", "10", undefined)).toHaveProperty("problem");
		expect(anglePartsToDegrees("90", "0", "1", "N")).toHaveProperty("problem");
		expect(anglePartsToDegrees("180", "0", "1", "W")).toHaveProperty("problem");
	});

	test("a latitude or longitude past the globe is named", () => {
		expect(placeProblem(90, 180)).toBeNull();
		expect(placeProblem(-90, -180)).toBeNull();
		expect(placeProblem(90.5, 0)).toMatch(/^latitude 90.5° is past a pole/);
		expect(placeProblem(0, -180.5)).toMatch(/^longitude -180.5° is outside -180° to 180°/);
		expect(placeProblem(Number.NaN, 0)).toMatch(/^latitude/);
	});
});

describe("on a line", () => {
	test("distance from a place to a place, in kilometres", () => {
		expect(answer("distance from (51.5074, -0.1278) to (48.8566, 2.3522)")).toBe("343.56 km");
		expect(answer("distance from 51.5074°N 0.1278°W to 35.6762°N 139.6503°E")).toBe("9,558.57 km");
	});

	test("the distance converts like any length", () => {
		expect(answer("distance from 51.5074°N 0.1278°W to 35.6762°N 139.6503°E in miles")).toBe("5,939.42 miles");
		expect(answer("distance from 51.5074°N 0.1278°W to 35.6762°N 139.6503°E in nmi")).toBe("5,161.22 nmi");
	});

	test("between ... and reads the same", () => {
		expect(answer("distance between (51.5074, -0.1278) and (48.8566, 2.3522)")).toBe("343.56 km");
	});

	test("a pair a map copies, two numbers and a comma, needs no brackets", () => {
		expect(answer("distance from 51.5074, -0.1278 to 48.8566, 2.3522")).toBe("343.56 km");
		expect(answer("distance between 51.5074, -0.1278 and 48.8566, 2.3522")).toBe("343.56 km");
	});

	test("lettered angles may come in either order, and with a comma", () => {
		expect(answer("distance from 0.1278°W 51.5074°N to 2.3522°E, 48.8566°N")).toBe("343.56 km");
		expect(answer("distance from (0.1278°W, 51.5074°N) to (2.3522°E, 48.8566°N)")).toBe("343.56 km");
	});

	test("degrees, minutes and seconds are the same places", () => {
		expect(answer(`distance from 51°30'26.64"N 0°07'40.08"W to 48°51'23.76"N 2°21'07.92"E`)).toBe("343.56 km");
	});

	test("places held in variables, across a document", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "London = 51.5074°N 0.1278°W");
		engine.evaluateLine(2, "Tokyo = 35.6762°N 139.6503°E");
		expect(formatValue(engine.evaluateLine(3, "distance from London to Tokyo"))).toBe("= 9,558.57 km");
		expect(formatValue(engine.evaluateLine(4, "bearing from London to Tokyo"))).toBe("= 31.73 degrees");
		expect(formatValue(engine.evaluateLine(5, "London as dms"))).toBe(`= 51°30'26.64"N 0°07'40.08"W`);
	});

	test("bearing, the starting compass heading, in degrees", () => {
		expect(answer("bearing from (51.5074, -0.1278) to (48.8566, 2.3522)")).toBe("148.12 degrees");
		expect(answer("bearing from (51.5074, -0.1278) to (48.8566, 2.3522) as dms")).toBe(`148°06'56.22"`);
		expect(answer("bearing from (0, 179.5) to (0, -179.5)")).toBe("90.00 degrees");
		expect(answer("bearing from (90, 0) to (51.5074, -0.1278)")).toBe("180.00 degrees");
	});

	test("an angle literal on its own is degrees", () => {
		expect(answer(`51°30'27"`)).toBe("51.51 degrees");
		expect(evaluate(`51°30'27"`).toNumber()).toBeCloseTo(51.5075, 12);
		expect(evaluate("0.1278°W").toNumber()).toBeCloseTo(-0.1278, 12);
		expect(evaluate(`33°52'07.68"S`).toNumber()).toBeCloseTo(-33.8688, 12);
	});

	test("two lettered angles side by side are a place, latitude first", () => {
		expect(answer(`51°30'26.64"N 0°07'40.08"W`)).toBe("[51.51, -0.13]");
		expect(answer("51.5072° N, 0.1276° W")).toBe("[51.51, -0.13]");
	});

	test("inside a list the angles stay separate elements", () => {
		expect(answer("[51.5°N, 0.12°W]")).toBe("[51.50, -0.12]");
		expect(answer("max(51°N, 12°E)")).toBe("51.00 degrees");
	});

	test("as dms, on an angle, a plain number of degrees, and a place", () => {
		expect(answer("51.5074° as dms")).toBe(`51°30'26.64"`);
		expect(answer("51.5074 as dms")).toBe(`51°30'26.64"`);
		expect(answer("1 rad as dms")).toBe(`57°17'44.81"`);
		expect(answer("(51.5074, -0.1278) as dms")).toBe(`51°30'26.64"N 0°07'40.08"W`);
	});
});

describe("what is refused, and how", () => {
	test("a latitude past a pole, a longitude past 180°", () => {
		expect(refusal("distance from (91, 0) to (0, 0)").code).toBe("GEO_OUT_OF_RANGE");
		expect(refusal("distance from (0, 0) to (0, 181)").code).toBe("GEO_OUT_OF_RANGE");
		expect(refusal("91°N").message).toBe("91°N is past a pole: a latitude runs from 0° to 90° north or south");
		expect(refusal("181°E").code).toBe("GEO_BAD_ANGLE");
	});

	test("minutes or seconds of 60 or more", () => {
		expect(refusal(`51°75'`).code).toBe("GEO_BAD_ANGLE");
		expect(refusal(`51°30'75"`).message).toContain("has 75 seconds");
	});

	test("something that is not a place", () => {
		expect(refusal("distance from 5 to (0, 0)").message).toBe(
			"the first place is not a latitude and a longitude: write it as (51.5074, -0.1278) or 51.5074°N 0.1278°W",
		);
		expect(refusal("distance from (1, 2, 3) to (0, 0)").message).toContain("has 3 numbers");
		expect(refusal("distance from (0, 0) to 5 kg, 3").code).toBe("GEO_EXPECTED_PLACE");
	});

	test("two latitudes are not a place", () => {
		expect(refusal("51°N 48°N").code).toBe("GEO_NOT_A_PLACE");
	});

	test("a bearing with no single direction", () => {
		expect(refusal("bearing from (0, 0) to (0, 0)").message).toContain("same point");
		expect(refusal("bearing from (0, 0) to (0, 180)").message).toContain("exactly opposite sides");
	});

	test("as dms of something that is not an angle", () => {
		expect(refusal("5 kg as dms").message).toBe(
			`"as dms" writes an angle in degrees, minutes and seconds, and 5 kg is not an angle`,
		);
	});

	test("a missing second place is a parse error that names the form", () => {
		const engine = newTrackedEngine();
		expect(() => engine.evaluateExpression("distance from (0, 0)")).toThrow(/expects a place, then "to" and a second place/);
	});
});

describe("what it leaves alone", () => {
	test("distance and bearing are still ordinary variable names", () => {
		const engine = newTrackedEngine();
		engine.evaluateLine(1, "distance = 5 km");
		engine.evaluateLine(2, "bearing = 30");
		expect(formatValue(engine.evaluateLine(3, "distance * 2"))).toBe("= 10.00 km");
		expect(formatValue(engine.evaluateLine(4, "bearing + 1"))).toBe("= 31");
	});

	test("the plain degree sign and temperatures", () => {
		expect(answer("90°")).toBe("90.00 degrees");
		expect(answer("sin(30°)")).toBe("0.50");
		expect(answer("20°C in F")).toBe("68.00 F");
	});

	test("time in a city is the time package's, unchanged", () => {
		expect(evaluate("time in London").type).toBe(ValueType.String);
	});
});

describe("the package is removable", () => {
	test("createEngine registers it", () => {
		expect(BUILTIN_PACKAGES).toContain(GEO_PACKAGE);
	});

	test("without it the forms are not recognised, and nothing else changes", () => {
		const engine = newTrackedEngine({ packages: BUILTIN_PACKAGES.filter((p) => p !== GEO_PACKAGE) });
		expect(() => engine.evaluateExpression("distance from (0, 0) to (0, 90)")).toThrow();
		expect(() => engine.evaluateExpression(`51°30'27"`)).toThrow();
		expect(formatValue(engine.evaluateExpression("90°"))).toBe("= 90.00 degrees");
	});
});
