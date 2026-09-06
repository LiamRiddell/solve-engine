/**
 * The generated unit table, swept end to end rather than sampled.
 *
 * Every test here runs over all 1456 spellings. A table is exactly the kind of
 * artefact that hand-written tests miss: a single transcribed ratio can be
 * wrong for years because nobody ever wrote the one assertion that would have
 * caught it. Two of the four sweeps below found precisely that.
 *
 * Three properties are checked, none of which depends on knowing any real-world
 * constant:
 *
 * 1. A conversion to a measure's base unit and back returns the original value.
 * 2. A spelling of the form "square X" / "cubic X" holds the square / cube of
 *    the ratio the table already records for X, because that is what those
 *    words mean. This is what caught `square decimetre`.
 * 3. A best-unit list ascends, because `convertToBestMetric` walks it forwards
 *    and stops at the first threshold the magnitude does not reach. This is
 *    what caught illuminance.
 *
 * Plus one property that spans the table and the lexer: a spelling the lexer
 * claims must survive being typed. `turns` and `°` were both in the table and
 * unlexable before, so the two vocabularies are known to drift.
 *
 * Where a sweep found a real defect, the truthful assertion is written as
 * `test.failing`. That keeps the correct expected value in the file rather than
 * a wrong one, and turns red the day someone fixes the bug, which is when the
 * `.failing` should be deleted.
 */

import { describe, expect, test } from "@jest/globals";
import {
	BEST_UNITS_METRIC,
	MEASURE_KIND_NAMES,
	UNIT_TABLE,
} from "@solve-js/uom/generated/UnitTable.generated";
import { lookupUnit, convertToBestMetric } from "@solve-js/uom/UnitConversion";
import { convertUnit, getBestUnit } from "@solve-js/uom/UomConverter";
import { knownUnits } from "@solve-js/lexer/units";
import { newTrackedEngine } from "@tools/trackedEngine";
import { ValueType } from "@solve-js/vm/Value";

const ALL_SPELLINGS = Object.keys(UNIT_TABLE);

/** The spelling whose ratio is exactly one, which is what a measure states its ratios against. */
function baseSpellingFor(kind: number): string | undefined {
	return ALL_SPELLINGS.find((s) => UNIT_TABLE[s][0] === kind && UNIT_TABLE[s][1] === 1);
}

/**
 * A "square X" or "cubic X" spelling paired with the length spelling X, for
 * every such entry whose X the table also carries as a length.
 *
 * Only the word forms are enumerated here. The symbol forms (`dm2`, `dm²`)
 * carry the identical ratio in the table, so an error in one is an error in
 * all of them, and the symbol test below pins that separately.
 */
function derivedAreaAndVolumeSpellings(): { spelling: string; length: string; power: number }[] {
	const found: { spelling: string; length: string; power: number }[] = [];
	for (const spelling of ALL_SPELLINGS) {
		const match = /^(square|cubic) (\w+)$/.exec(spelling);
		if (match === null) continue;
		const [, form, lengthName] = match;
		const lengthEntry = lookupUnit(lengthName);
		if (lengthEntry === undefined) continue;
		if (MEASURE_KIND_NAMES[lengthEntry[0]] !== "length") continue;
		found.push({ spelling, length: lengthName, power: form === "square" ? 2 : 3 });
	}
	return found;
}

/**
 * The four spellings of the square decimetre, which the table used to record as
 * 0.1 square metres when a decimetre is 0.1 metres and the square of that is
 * 0.01. The sweep below covers them like every other prefix now; they are still
 * named here so the case that found the defect keeps its own assertion.
 */
const SQUARE_DECIMETRE_SPELLINGS = new Set([
	"square decimeter",
	"square decimetre",
	"square decimeters",
	"square decimetres",
]);

describe("every unit returns to itself", () => {
	test("a conversion to the measure's base unit and back is the identity", () => {
		// The weakest property a conversion table can have, and therefore the one
		// worth checking over all of it. A ratio that is wrong in a self-
		// consistent way survives this, which is why the dimensional sweep below
		// exists as well.
		const broken: string[] = [];
		for (const spelling of ALL_SPELLINGS) {
			const base = baseSpellingFor(UNIT_TABLE[spelling][0]);
			if (base === undefined) continue;
			try {
				const there = convertUnit(1, spelling, base);
				const back = convertUnit(there, base, spelling);
				if (!Number.isFinite(back) || Math.abs(back - 1) > 1e-9) {
					broken.push(`${spelling} -> ${base} -> ${spelling} = ${back}`);
				}
			} catch (error) {
				broken.push(`${spelling}: ${(error as Error).message}`);
			}
		}
		expect(broken).toEqual([]);
	});

	test("and the sweep is actually covering the whole table", () => {
		// A guard on the guard. If `baseSpellingFor` ever stopped finding a base,
		// the loop above would skip that measure silently and still pass.
		expect(ALL_SPELLINGS.length).toBeGreaterThan(1400);
		for (const kind of Object.keys(MEASURE_KIND_NAMES).map(Number)) {
			expect(baseSpellingFor(kind)).toBeDefined();
		}
	});
});

describe("a squared unit is the square of the unit", () => {
	test("holds for every prefix, the decimetre included", () => {
		const wrong: string[] = [];
		for (const { spelling, length, power } of derivedAreaAndVolumeSpellings()) {
			const expected = lookupUnit(length)![1] ** power;
			const actual = UNIT_TABLE[spelling][1];
			if (Math.abs(actual - expected) / Math.abs(expected) > 1e-9) {
				wrong.push(`${spelling}: table ${actual}, ${length}^${power} is ${expected}`);
			}
		}
		expect(wrong).toEqual([]);
		// Twelve metric prefixes in two forms, plus the unprefixed pair.
		expect(derivedAreaAndVolumeSpellings().length).toBeGreaterThan(50);
	});

	test("a square decimetre is a hundredth of a square metre", () => {
		// Was a bug: the table recorded 0.1 rather than 0.01, so a square
		// decimetre was ten times too large and every conversion through it out
		// by ten. A decimetre is a tenth of a metre and 0.1 squared is 0.01; the
		// table's own `decimeter` entry is 0.1 and every other prefix squares
		// correctly. The defect was upstream in `convert`, so the fix is a
		// documented override in scripts/generate-unit-table.mjs rather than an
		// edit to the generated file.
		for (const spelling of SQUARE_DECIMETRE_SPELLINGS) {
			expect(UNIT_TABLE[spelling][1]).toBeCloseTo(0.01, 12);
		}
		expect(UNIT_TABLE["dm2"][1]).toBeCloseTo(0.01, 12);
		expect(UNIT_TABLE["dm²"][1]).toBeCloseTo(0.01, 12);
	});

	test("so a square metre is a hundred square decimetres", () => {
		// The user-visible shape of the same defect, through the whole engine.
		expect(convertUnit(1, "m2", "dm2")).toBeCloseTo(100, 9);
		expect(convertUnit(1, "dm2", "cm2")).toBeCloseTo(100, 9);
		expect(convertUnit(100, "dm2", "m2")).toBeCloseTo(1, 9);
	});

	test("the cubic decimetre, by contrast, is right, and is the litre", () => {
		// Worth pinning next to the broken area entry: the same prefix is correct
		// in the volume table, so this is one transcribed ratio and not a whole
		// missing prefix.
		expect(UNIT_TABLE["cubic decimeter"][1]).toBeCloseTo(0.001, 12);
		expect(convertUnit(1, "dm3", "l")).toBeCloseTo(1, 9);
		expect(convertUnit(1, "m3", "dm3")).toBeCloseTo(1000, 9);
	});
});

describe("best-unit lists ascend", () => {
	test("for every measure, illuminance included", () => {
		// `convertToBestMetric` walks the list forwards, keeps the last entry
		// whose threshold the magnitude reaches, and breaks at the first it does
		// not. A list out of order therefore does not merely pick a poor unit, it
		// runs off the end of the sensible ones.
		const unordered: string[] = [];
		for (const kindText of Object.keys(BEST_UNITS_METRIC)) {
			const kind = Number(kindText);
			const list = BEST_UNITS_METRIC[kind];
			for (let i = 1; i < list.length; i++) {
				if (list[i][1] <= list[i - 1][1]) {
					unordered.push(`${MEASURE_KIND_NAMES[kind]}: ${list[i - 1][0]} then ${list[i][0]}`);
				}
			}
		}
		expect(unordered).toEqual([]);
	});

	test("and the first threshold of every list is its smallest unit", () => {
		// The thresholds are stated in the list's first unit, so that entry has to
		// be the one the others are measured against.
		for (const kindText of Object.keys(BEST_UNITS_METRIC)) {
			const list = BEST_UNITS_METRIC[Number(kindText)];
			expect(list.length).toBeGreaterThan(0);
			expect(list[0][1]).toBe(1);
		}
	});

	test("the illuminance list ascends too", () => {
		// Was a bug: the list read [lux 1, µlx 1e-6, nlx 1e-9, klx 1000], and
		// because the thresholds fell after the first entry, every magnitude at
		// or above one lux walked straight past lux and µlx and settled on
		// nanolux. The two sub-lux entries are gone rather than moved to the
		// front, because the thresholds are stated in the list's first unit and
		// one lux restated in nanolux is 999999999.9999999, one ulp under its own
		// threshold. The generator says so at more length.
		const list = BEST_UNITS_METRIC[6];
		for (let i = 1; i < list.length; i++) {
			expect(list[i][1]).toBeGreaterThan(list[i - 1][1]);
		}
	});

	test("so an ordinary indoor light level stays in lux", () => {
		// 500 lux is a normally lit office. It used to report as five hundred
		// billion nanolux.
		expect(getBestUnit(500, "lux")).toEqual({ value: 500, unit: "lux" });
		expect(getBestUnit(1, "lux")).toEqual({ value: 1, unit: "lux" });
	});

	test("the other measures do pick a sensible unit", () => {
		// The comparison that makes the illuminance result obviously wrong rather
		// than merely surprising.
		expect(convertToBestMetric(1500, "m")).toEqual({ quantity: 1.5, unit: "km" });
		expect(convertToBestMetric(1500, "g")).toEqual({ quantity: 1.5, unit: "kg" });
		expect(convertToBestMetric(3600, "s")).toEqual({ quantity: 60, unit: "min" });
		// Above a kilolux the illuminance list landed correctly even before it was
		// reordered, because its last entry was the only one in ascending
		// position, so this is the case the reorder had to leave alone.
		expect(convertToBestMetric(1500, "lux")).toEqual({ quantity: 1.5, unit: "klx" });
	});
});

describe("a spelling the lexer claims can actually be typed", () => {
	/** Table spellings the lexer admits, which is what this section is about. */
	const LEXABLE_TABLE_SPELLINGS = ALL_SPELLINGS.filter((s) => knownUnits.has(s));

	test("there are enough of them for this sweep to mean anything", () => {
		expect(LEXABLE_TABLE_SPELLINGS.length).toBeGreaterThan(900);
	});

	test("each one evaluates to a Uom carrying that same unit", () => {
		// A table entry the lexer admits but the engine turns into something else
		// is worse than one it rejects: rejection is an error message, and this is
		// a number. This is the sweep that found `mN`, `MN` and `TN` being eaten
		// by the magnitude-suffix rule; they are back in it now.
		const broken: string[] = [];
		for (const spelling of LEXABLE_TABLE_SPELLINGS) {
			const engine = newTrackedEngine();
			try {
				const value = engine.evaluateExpression(`1 ${spelling}`);
				if (value.type !== ValueType.Uom || value.unit !== spelling) {
					broken.push(`1 ${spelling} is ${ValueType[value.type]} ${String(value.unit)}`);
				}
			} catch (error) {
				broken.push(`1 ${spelling} threw: ${(error as Error).message}`);
			} finally {
				engine.clear();
			}
		}
		expect(broken).toEqual([]);
	});

	test("including the newton's own metric prefixes", () => {
		// Was a bug: `LargeNumberSuffixNormalizerRule` matched the word magnitudes
		// "mn", "bn" and "tn" case-insensitively, so `5 mN` fused into the number
		// five million before the unit system ever saw it, and the same ate `MN`
		// and `TN`. A word magnitude no longer accepts a token the lexer typed as
		// a UNIT.
		const engine = newTrackedEngine();
		try {
			for (const [source, expectedNewtons] of [
				["5 mN", 0.005],
				["1 MN", 1_000_000],
				["1 TN", 1e12],
			] as const) {
				const value = engine.evaluateExpression(source);
				expect(value.type).toBe(ValueType.Uom);
				expect(convertUnit(value.toNumber(), value.unit!, "newton")).toBeCloseTo(expectedNewtons, 9);
			}
		} finally {
			engine.clear();
		}
	});

	test("the neighbouring prefixes, which nothing collides with, are fine", () => {
		// Establishes that the three above are a name collision and not a missing
		// corner of the force table.
		expect(convertUnit(1, "kN", "newton")).toBeCloseTo(1000, 9);
		expect(convertUnit(1, "GN", "newton")).toBeCloseTo(1e9, 9);
		expect(convertUnit(5, "mN", "newton")).toBeCloseTo(0.005, 12);
	});

	test("a conversion out and back through the engine returns the original", () => {
		// The same round trip as the first sweep, but driven through the parser
		// and the VM so a defect anywhere in that path shows up too. Temperature
		// is excluded because its scales do not share an origin and the round trip
		// is asserted separately in UnitsConversionSafety.spec.ts.
		const broken: string[] = [];
		for (const spelling of LEXABLE_TABLE_SPELLINGS) {
			const kind = UNIT_TABLE[spelling][0];
			if (MEASURE_KIND_NAMES[kind] === "temperature") continue;
			const base = ALL_SPELLINGS.find(
				(other) => other !== spelling && UNIT_TABLE[other][0] === kind
					&& UNIT_TABLE[other][1] === 1 && knownUnits.has(other),
			);
			if (base === undefined) continue;
			const engine = newTrackedEngine();
			try {
				const there = engine.evaluateExpression(`1 ${spelling} in ${base}`);
				const back = engine.evaluateExpression(`${there.toNumber()} ${base} in ${spelling}`);
				if (!Number.isFinite(back.toNumber()) || Math.abs(back.toNumber() - 1) > 1e-6) {
					broken.push(`1 ${spelling} <-> ${base} came back as ${back.toNumber()}`);
				}
			} catch (error) {
				broken.push(`1 ${spelling} <-> ${base} threw: ${(error as Error).message}`);
			} finally {
				engine.clear();
			}
		}
		expect(broken).toEqual([]);
	});
});

describe("what the table holds that cannot be typed", () => {
	test("the unlexable spellings are unlexable for a reason the source states", () => {
		// Not an assertion that the set is empty, which it never will be: 465
		// spellings contain a space, a slash or a non-ASCII character and the
		// lexer reads a unit as one run of [A-Za-z0-9_]. The assertion is that
		// nothing ASCII-shaped is missing without an explanation, since that is
		// the shape `turns` and `°` had.
		const shapedLikeAToken = ALL_SPELLINGS.filter((s) => /^[A-Za-z0-9_]+$/.test(s));
		const unexplained = shapedLikeAToken.filter(
			(s) => !knownUnits.has(s) && s.length > 1 && !isDocumentedExclusion(s),
		);
		expect(unexplained).toEqual([]);
	});

	test("the single letters the base units need are among the casualties", () => {
		// `N` (newton) and `J` (joule) were grandfathered in for dimensional
		// arithmetic (issue #191), so they can now be typed. `L`, the preferred
		// symbol for the litre, is still a casualty (`l` and `mL` work instead):
		// a reachability gap pinned here as a fact about the vocabulary.
		expect(lookupUnit("J")).toBeDefined();
		expect(lookupUnit("N")).toBeDefined();
		expect(lookupUnit("L")).toBeDefined();
		expect(knownUnits.has("J")).toBe(true);
		expect(knownUnits.has("N")).toBe(true);
		expect(knownUnits.has("L")).toBe(false);
		// The longer spellings that do work, so the gap is only in the symbols.
		expect(knownUnits.has("joule")).toBe(true);
		expect(knownUnits.has("newton")).toBe(true);
		expect(knownUnits.has("liter")).toBe(true);
		expect(knownUnits.has("mL")).toBe(true);
	});

	test("the degree symbol works for angles", () => {
		// Which is what makes the temperature case below a gap rather than a
		// policy: there is a normalizer rule for the symbol and it covers one of
		// the two measures that use it.
		const engine = newTrackedEngine();
		try {
			expect(engine.evaluateExpression("90°").type).toBe(ValueType.Uom);
			expect(engine.evaluateExpression("90° in rad").toNumber()).toBeCloseTo(Math.PI / 2, 9);
		} finally {
			engine.clear();
		}
	});

	// Fixed. `°C` and `°F` are in the table and were unreachable, because the
	// lexer reads a unit as one run of `[A-Za-z0-9_]` and the degree-symbol
	// normalizer covered the angle case only. `degreeTemperatureNormalizerRule`
	// retypes the attached symbol forms, so both now convert, along with the
	// precomposed `℃` and `℉` some keyboards emit.
	//
	// A case per spelling: a failing assertion stops the test, so the two would
	// hide each other. See `UnitsCurrencyAndRates.spec.ts`'s header for the
	// regression that shape hid.
	for (const [source, expected] of [
		["20°C in F", 68],
		["68°F in C", 20],
		["20℃ in F", 68],
		["68℉ in C", 20],
	] as const) {
		test(`and for temperatures: ${source}`, () => {
			const engine = newTrackedEngine();
			try {
				expect(engine.evaluateExpression(source).toNumber()).toBeCloseTo(expected, 6);
			} finally {
				engine.clear();
			}
		});
	}

	// BUG, a smaller one. The possibilities list is drawn from MEASURE_SYMBOLS,
	// which is a display vocabulary rather than a typeable one, so `C to ?`
	// answers with `°F`, `°C` and `R` and `kg to ?` with `µg` and `oz t`. A
	// suggestion the user cannot then type is worse than a shorter list.
	//
	// A case per unit rather than a loop inside one `test.failing`: the loop
	// stopped at the first unit that failed, so the other three could be fixed,
	// or broken further, with nothing reported either way.
	for (const unit of ["C", "kg", "lux", "m"]) {
		test.failing(`and "${unit} to ?" only offers units that can be typed`, () => {
			const engine = newTrackedEngine();
			try {
				const answer = engine.evaluateExpression(`${unit} to ?`).value as string;
				const untypeable = answer.split(", ").filter((symbol) => !knownUnits.has(symbol));
				expect(untypeable).toEqual([]);
			} finally {
				engine.clear();
			}
		});
	}

	test("the possibilities list is at least populated and mostly usable", () => {
		const engine = newTrackedEngine();
		try {
			const answer = engine.evaluateExpression("kg to ?").value as string;
			const symbols = answer.split(", ");
			expect(symbols.length).toBeGreaterThan(20);
			expect(symbols.filter((symbol) => knownUnits.has(symbol)).length).toBeGreaterThan(20);
		} finally {
			engine.clear();
		}
	});
});

/**
 * Whether a spelling the lexer rejects is rejected on purpose.
 *
 * The exclusions live in two places: `EXCLUDED_UNIT_SPELLINGS` names the words
 * that collide with English or with a keyword, and the single-character rule
 * admits only a grandfathered thirteen. Both are stated in `lexer/units.ts`.
 */
function isDocumentedExclusion(spelling: string): boolean {
	const excludedWords = new Set([
		"in", "dec", "M", "pm", "are", "ares", "turn", "turns", "grade", "grades",
		"point", "points", "moment", "moments", "shake", "shakes",
	]);
	return excludedWords.has(spelling);
}
