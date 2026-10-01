import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, NUMERIC_EDGES, TEXT_EDGES, expectHonestLine, expectHonestDocument, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { stringValue } from "@solve-js/vm/Value";
import {
	registerAsConverter,
	unregisterAsConverter,
	resolveAsConverter,
	matchAsConverter,
	asConverterRegistry,
	asConverterExactRegistry,
	type AsConverter,
} from "@solve-js/vm/VMBuiltins";

/**
 * Issue #824: `as` lower-cased its target before looking the converter up, so a
 * unit's prefix, which is carried by its case, was lost: `5 W as mW` answered
 * five millionths of a megawatt where `5 W in mW` answered 5,000 milliwatts. The
 * converter registry now keeps each spelling, `as` tries the target as typed
 * first, and a folded spelling that two units share, or that would turn one
 * prefix into another, is refused by name. The same folding had reached `in`
 * through the rule that sends `in <converter>` to `as`: `1 V in MV` answered in
 * millivolts.
 */

function show(line: string): string {
	try {
		const value = newTrackedEngine().evaluateExpression(line);
		const text = formatValue(value).replace(/^=\s*/, "");
		return value.isError() ? `ERROR ${text}` : text;
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

function doc(text: string): string[] {
	return newTrackedEngine().parseDocument(text, { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? (line.result.isError() ? "ERROR " : "") + formatValue(line.result).replace(/^=\s*/, "") : "");
}

function incremental(text: string): string[] {
	return evaluateDocument(newTrackedEngine(), text, { inputType: "markdown" }).lines.map((line) =>
		line.error ? `ERROR ${line.error}` : line.result ? (line.result.isError() ? "ERROR " : "") + formatValue(line.result).replace(/^=\s*/, "") : "");
}

describe("the issue's lines", () => {
	test.each([
		["5 W as mW", "5,000.00 mW"],
		["5 W in mW", "5,000.00 mW"],
		["5 J as mJ", "5,000.00 mJ"],
		["5 Pa as mPa", "5,000.00 mPa"],
		["5 MW as mW", "5,000,000,000.00 mW"],
		["5 kW as MW", "0.01 MW"],
		["5 W as MW", "5e-6 MW"],
	])("%s gives %s", (line, expected) => {
		expect(show(line)).toBe(expected);
	});
});

describe("each prefix pair that differs only by case agrees through as and in", () => {
	const pairs: Array<[string, string]> = [];
	for (const base of ["W", "J", "Pa", "N", "Wh"]) {
		pairs.push([`m${base}`, `M${base}`], [`p${base}`, `P${base}`]);
	}
	test.each(pairs)("%s and %s", (lower, upper) => {
		const base = lower.slice(1);
		for (const target of [lower, upper]) {
			expect(show(`1 ${base} as ${target}`)).toBe(show(`1 ${base} in ${target}`));
		}
		expect(show(`1 ${base} as ${lower}`)).not.toBe(show(`1 ${base} as ${upper}`));
	});

	test.each(["W", "J", "Pa", "N", "Wh"])("every prefix before %s reads the same through as and in", (base) => {
		for (const prefix of ["p", "n", "µ", "m", "k", "M", "G", "T", "P"]) {
			expect(show(`3 ${base} as ${prefix}${base}`)).toBe(show(`3 ${base} in ${prefix}${base}`));
		}
	});

	test("the volt's two prefixes, and the megavolt the unit table does not spell", () => {
		expect(show("5 V as mV")).toBe("5,000.00 mV");
		expect(show("5 V as kV")).toBe(show("5 V in kV"));
		expect(show("1 V in MV")).toBe('ERROR "MV" is not a unit.');
		expect(show("1 V as MV")).toMatch(/^ERROR "as MV" is not a unit: the one spelled alike is "as mV"/);
	});
});

describe("a folded spelling is refused where its prefix would change, and read where it would not", () => {
	test("a lower-case spelling two units share is refused, naming both", () => {
		expect(show("5 W as mw")).toBe('ERROR "as mw" could be "as mW" or "as MW": write the unit with its prefix in its own case (m is milli, M is mega, p is pico, P is peta)');
		expect(show("1 W as pw")).toMatch(/^ERROR "as pw" could be "as pW" or "as PW"/);
		expect(show("5 J as Mj")).toMatch(/^ERROR "as Mj" could be "as mJ" or "as MJ"/);
	});

	test("after in, such a spelling is a unit conversion and refused as one", () => {
		expect(show("5 W in mw")).toBe('ERROR "mw" is not a unit.');
		expect(show("1 V in Mv")).toBe('ERROR "Mv" is not a unit.');
	});

	test("a letter that is not a prefix still folds", () => {
		expect(show("10 N as n")).toBe("10.00 N");
		expect(show("1 kWh as KWH")).toBe("1.00 kWh");
		expect(show("5 kW as kw")).toBe("5.00 kW");
		expect(show("5 kW in kw")).toBe("5.00 kW");
	});

	test("word converters stay case-insensitive (the boundary)", () => {
		expect(show("2024-01-01 as ISO8601")).toBe(show("2024-01-01 as iso8601"));
		expect(show("255 in ROMAN")).toBe("CCLV");
		expect(show("255 as Roman")).toBe("CCLV");
	});

	test("an unknown converter names the target as it was typed", () => {
		expect(show("5 as Foo")).toBe('ERROR Unknown converter "as Foo"');
	});
});

describe("the parts", () => {
	const names: string[] = [];
	const register = (name: string, handler: AsConverter): void => {
		names.push(name);
		registerAsConverter(name, handler);
	};
	afterEach(() => {
		for (const name of names.splice(0)) unregisterAsConverter(name);
	});
	const milli: AsConverter = () => stringValue("milli");
	const mega: AsConverter = () => stringValue("mega");

	test("a spelling with capitals is kept exactly, and its lower-cased key reaches it", () => {
		register("zQ", milli);
		expect(asConverterExactRegistry.get("zQ")).toBe(milli);
		expect(matchAsConverter("zQ")).toBe("exact");
		expect(matchAsConverter("zq")).toBe("folded");
		expect(resolveAsConverter("zq")).toBe(milli);
	});

	test("a case pair keeps both spellings and refuses the shared key", () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		register("mZq", milli);
		register("MZq", mega);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
		expect(resolveAsConverter("mZq")).toBe(milli);
		expect(resolveAsConverter("MZq")).toBe(mega);
		expect(matchAsConverter("mzq")).toBe("ambiguous");
		const refusal = resolveAsConverter("mzq")?.(stringValue("x"));
		expect(refusal?.errorCode).toBe("AS_CONVERTER_AMBIGUOUS_CASE");
		expect(refusal?.errorMessage).toContain('"as mzq" could be "as mZq" or "as MZq"');
		// The lower-cased map alone, which a reader of it might consult, refuses too.
		expect(asConverterRegistry.get("mzq")?.(stringValue("x")).errorCode).toBe("AS_CONVERTER_AMBIGUOUS_CASE");
	});

	test("registering the same spellings again, as each new engine does, keeps the pair", () => {
		register("mZr", milli);
		register("MZr", mega);
		registerAsConverter("mZr", milli);
		registerAsConverter("MZr", mega);
		expect(resolveAsConverter("mZr")).toBe(milli);
		expect(resolveAsConverter("MZr")).toBe(mega);
		expect(matchAsConverter("mzr")).toBe("ambiguous");
	});

	test("a fold that changes a prefix's case is refused", () => {
		register("mZs", milli);
		expect(matchAsConverter("MZs")).toBe("prefix");
		const refusal = resolveAsConverter("MZs")?.(stringValue("x"));
		expect(refusal?.errorCode).toBe("AS_CONVERTER_PREFIX_CASE");
		expect(refusal?.errorMessage).toContain('the one spelled alike is "as mZs"');
		register("pZs", milli);
		expect(matchAsConverter("PZs")).toBe("prefix");
	});

	test("unregistering one of a pair gives the key back to the other", () => {
		register("mZt", milli);
		register("MZt", mega);
		unregisterAsConverter("MZt");
		expect(matchAsConverter("mzt")).toBe("folded");
		expect(resolveAsConverter("mzt")).toBe(milli);
		expect(resolveAsConverter("MZt")?.(stringValue("x")).errorCode).toBe("AS_CONVERTER_PREFIX_CASE");
		unregisterAsConverter("mZt");
		expect(matchAsConverter("mzt")).toBeUndefined();
		expect(resolveAsConverter("mZt")).toBeUndefined();
	});

	test("a lower-case name and a capitalised one for the same key are a collision, which warns and overwrites", () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		register("zu", milli);
		register("Zu", mega);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).not.toContain("—");
		warn.mockRestore();
		expect(resolveAsConverter("zu")).toBe(mega);
		expect(resolveAsConverter("Zu")).toBe(mega);
	});

	test("a one-letter spelling has no prefix, so folding it is never a prefix change", () => {
		register("Zv", milli);
		expect(matchAsConverter("zv")).toBe("folded");
		register("Z", mega);
		expect(matchAsConverter("z")).toBe("folded");
	});

	test("hostile names miss rather than reach an inherited property", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(matchAsConverter(word)).toBeUndefined();
			expect(resolveAsConverter(word)).toBeUndefined();
		}
		expect(matchAsConverter("")).toBeUndefined();
	});
});

describe("both document passes read the prefixes alike", () => {
	const lines = "power = 5 W\npower as mW\npower as MW\npower as mw\n1 V in MV";
	test("the answers", () => {
		expect(doc(lines)).toEqual([
			"5.00 W",
			"5,000.00 mW",
			"5e-6 MW",
			'ERROR "as mw" could be "as mW" or "as MW": write the unit with its prefix in its own case (m is milli, M is mega, p is pico, P is peta)',
			'ERROR "MV" is not a unit.',
		]);
		expect(incremental(lines)).toEqual(doc(lines));
	});

	test("one engine asked mW then MW does not reuse the first compilation", () => {
		const engine = newTrackedEngine();
		expect(formatValue(engine.evaluateExpression("5 W as mW"))).toBe("= 5,000.00 mW");
		expect(formatValue(engine.evaluateExpression("5 W as MW"))).toBe("= 5e-6 MW");
		expect(formatValue(engine.evaluateExpression("5 W as mW"))).toBe("= 5,000.00 mW");
	});
});

describe("adversarial", () => {
	test("security: prototype words and look-alike prefixes after as and in", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`5 W as ${word}`);
				expectHonestLine(`5 W in ${word}`);
			}
			// A fullwidth W, a Cyrillic М and a zero-width space are not the watt or the mega prefix.
			for (const target of ["mＷ", "Мw", "m​W", "‮mW"]) {
				const outcome = expectHonestLine(`5 W as ${target}`);
				expect(outcome.kind === "value" && outcome.text.includes("mW")).toBe(false);
			}
			expectHonestLine(`5 W as ${"m".repeat(10_000)}W`);
			expectHonestLine(`5 W as <script>mW</script>`);
		});
	});

	test("realistic breakage: a value from the line above, a sum, a typo, a what-if and a check", () => {
		expect(doc("5 W\nline 1 as mW")).toEqual(["5.00 W", "5,000.00 mW"]);
		expect(show("(2 W + 3 W) as mW")).toBe("5,000.00 mW");
		expect(show("5 W as mWW")).toMatch(/^ERROR/);
		expect(show("5 kg as mW")).toBe("ERROR kg cannot be expressed as mW: they do not measure the same thing");
		expect(show("5 as mW")).toBe('ERROR "as mW" expects a quantity with a unit');
		expectHonestDocument("p = 5 W\np as mW\np as MW\ntotal above");
	});

	test("edge cases: zero, negatives and the largest doubles", () => {
		for (const line of fill("X W as mW", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		expect(show("0 W as mW")).toBe("0.00 mW");
		expect(show("-3 kW as mW")).toBe("-3,000,000.00 mW");
		expect(show("1e308 W as mW")).toBe(show("1e308 W in mW"));
		for (const edge of TEXT_EDGES) expectHonestLine(`5 W as mW${edge}`);
	});
});
