import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { Value, ValueType, uomValue, numberValue, errorValue } from "@solve-js/vm/Value";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { checkPackageCompatibility } from "@solve-js/api/PackageCompatibility";
import { UnitAliasTable } from "@solve-js/packages/uom/UnitAliasTable";
import { UserUnitTable } from "@solve-js/packages/uom/UserUnitTable";
import { unitAliasRule, unitLabelToken, userUnitExpansionRule } from "@solve-js/packages/uom/normalizer/UserUnitNormalizerRule";
import { labelQuantity, UNIT_LABEL_BUILTIN } from "@solve-js/vm/UnitLabels";
import { builtinFunctionNames } from "@solve-js/vm/VMBuiltinArity";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { serializeValue } from "@solve-js/worker/serialize";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";

/**
 * Issue #762: no package field let a language package say that a word means a
 * unit the engine already has, and a unit a document defined could not be the
 * target of a conversion. `5 km in Meile` said Meile is not a unit, and `84
 * days in sprints` that sprints is not one.
 *
 * `IEnginePackage.unitAliases` declares the words; the `uom:unit-alias`
 * normaliser rule reads them after a value and after `in`/`into`/`to`, and the
 * `uom:user-unit` rule now reads a document's unit in both places too. Either
 * way a unit label (`Value.unitLabel`) names the quantity for display while the
 * quantity stays in its own unit.
 */

/** The package the unit-aliases guide shows. */
const GERMAN: IEnginePackage = { name: "german-units", unitAliases: { Meile: "mile", Meilen: "miles", Tage: "days", Stunden: "hours" } };

function engineWith(...extra: IEnginePackage[]): ExpressionEngine {
	return newTrackedEngine({ packages: [...BUILTIN_PACKAGES, ...extra], config: { network: { enabled: false } } });
}

/** A line's answer without `= `, or `refused`. */
function answer(engine: ExpressionEngine, line: string): string {
	try {
		const value = engine.evaluateExpression(line);
		if (value.type === ValueType.Error) return "refused";
		return formatValue(value).replace(/^=\s*/, "");
	} catch (e) {
		if (e instanceof EngineError) return "refused";
		throw e;
	}
}

/** A document result's lines as text: the answer without `= `, or `ERROR <message>`. */
function show(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
	});
}

/** A document through both passes, which must agree. */
function bothPasses(lines: string[], ...extra: IEnginePackage[]): string[] {
	const text = lines.join("\n");
	const batch = show(engineWith(...extra).parseDocument(text));
	const incremental = show(evaluateDocument(engineWith(...extra), text));
	expect(incremental).toEqual(batch);
	return batch;
}

/** The raw tokens a line lexes to under English. */
function lex(text: string): Token[] {
	const lexer = new Lexer("en");
	lexer.resetExpression(text);
	return Array.from(lexer);
}

describe("the issue's lines", () => {
	test("a document's own units, through both passes", () => {
		const doc = [
			"1 Tage = 1 day", "3 Tage", "3 Tage in hours",
			"1 Meile = 1 mile", "2 Meile", "2 Meile in km", "5 km in Meile",
			"1 sprint = 2 weeks", "6 sprints in days", "84 days in sprints", "84 days in sprint", "6 sprints in kg",
		];
		expect(bothPasses(doc)).toEqual([
			"Tage defined", "3 Tage", "72 hours",
			"Meile defined", "2.00 Meile", "3.22 km", "3.11 Meile",
			"sprint defined", "84 days", "6 sprints", "6 sprint", "ERROR a duration cannot be converted to a mass",
		]);
	});

	test("a package's aliases", () => {
		const engine = engineWith(GERMAN);
		expect(answer(engine, "2 Meile")).toBe("2.00 Meile");
		expect(answer(engine, "2 Meile in km")).toBe("3.22 km");
		expect(answer(engine, "5 km in Meile")).toBe("3.11 Meile");
		expect(answer(engine, "3 Tage")).toBe("3 Tage");
	});

	test("the German engine reads a German package's words", () => {
		const engine = newTrackedEngine({ locale: "de", packages: [...BUILTIN_PACKAGES, GERMAN] });
		expect(answer(engine, "3 Tage")).toBe("3 Tage");
		expect(answer(engine, "5 km in Meilen")).toBe("3.11 Meilen");
		expect(answer(engine, "5 km in miles")).toBe("3.11 miles");
	});
});

describe("packages/unit-aliases.md: every row of the guide's table", () => {
	const page = fs.readFileSync(path.resolve(__dirname, "../../../../docs/src/content/docs/packages/unit-aliases.md"), "utf8");
	const rows = page.split("\n").filter((l) => /^\| `/.test(l)).map((l) => l.split("|").map((c) => c.trim().replace(/^`|`$/g, "")).slice(1, 3));

	test("the page has its table", () => {
		expect(rows.length).toBeGreaterThanOrEqual(8);
	});

	test.each(rows)("%s is %s", (line, expected) => {
		expect(answer(engineWith(GERMAN), line)).toBe(expected);
	});
});

describe("what a label changes and what it does not", () => {
	test("the quantity converts and adds as its own unit", () => {
		expect(bothPasses(["x = 5 km in Meile", "x", "x in km", "x * 2", "2 Meile + 3 km"], GERMAN)).toEqual([
			"3.11 Meile", "3.11 Meile", "5.00 km", "6.21 mile", "3.86 mile",
		]);
	});

	test("rounding keeps the name, and rounds the count the reader sees", () => {
		expect(answer(engineWith(GERMAN), "5 km in Meile to 4 dp")).toBe("3.1069 Meile");
		expect(bothPasses(["1 sprint = 2 weeks", "3 weeks in sprints to 1 dp", "1 day in sprints to 3 dp"]).slice(1)).toEqual(["1.5 sprints", "0.071 sprints"]);
	});

	test("a whole number of days renamed shows no places, a distance keeps the setting's", () => {
		const engine = engineWith(GERMAN);
		expect(answer(engine, "3 Tage")).toBe("3 Tage");
		expect(answer(engine, "36 hours in Tage")).toBe("1.50 Tage");
		expect(answer(engine, "1 mile in Meile")).toBe("1.00 Meile");
	});
});

// ── Unit tests of the parts ──────────────────────────────────────────────

describe("UnitAliasTable", () => {
	test("ordinary: add, look up, remove", () => {
		const table = new UnitAliasTable();
		expect(table.isEmpty).toBe(true);
		table.add("p", "Meile", "mile");
		expect(table.isEmpty).toBe(false);
		expect(table.unitFor("Meile")).toBe("mile");
		expect(table.unitFor("meile")).toBeUndefined();
		expect(table.words).toEqual(["Meile"]);
		expect(table.removeOwner("p")).toBe(1);
		expect(table.isEmpty).toBe(true);
	});

	test("a later claim wins and removing it hands the word back", () => {
		const table = new UnitAliasTable();
		table.add("a", "Meile", "mile");
		table.add("b", "Meile", "km");
		expect(table.unitFor("Meile")).toBe("km");
		table.removeOwner("b");
		expect(table.unitFor("Meile")).toBe("mile");
		table.removeOwner("a");
		expect(table.unitFor("Meile")).toBeUndefined();
	});

	test("boundary: removing an owner that claimed nothing removes nothing", () => {
		const table = new UnitAliasTable();
		table.add("a", "Tage", "days");
		expect(table.removeOwner("nobody")).toBe(0);
		expect(table.unitFor("Tage")).toBe("days");
	});

	test("hostile: a prototype word is an ordinary key", () => {
		expectPrototypeUntouched(() => {
			const table = new UnitAliasTable();
			for (const word of PROTOTYPE_WORDS) expect(table.unitFor(word)).toBeUndefined();
			table.add("p", "__proto__", "mile");
			table.add("p", "constructor", "km");
			expect(table.unitFor("__proto__")).toBe("mile");
			expect(table.unitFor("constructor")).toBe("km");
			expect(table.unitFor("toString")).toBeUndefined();
		});
	});
});

describe("unitAliasRule", () => {
	const table = new UnitAliasTable();
	table.add("p", "Meile", "mile");
	const rule = unitAliasRule(table);

	test("after a number: the unit, then a label naming the word", () => {
		const tokens = lex("2 Meile");
		const match = rule.match(tokens, 0);
		expect(match?.consumed).toBe(2);
		expect(match?.replacement.map((t) => `${t.type}:${t.value}`)).toEqual(["NUMBER:2", "UNIT:mile", "UNIT_LABEL:Meile"]);
		expect(match?.replacement[2].text).toBe("1");
		// The unit covers the word the reader wrote, for an editor painting it.
		expect(match?.replacement[1].sourceEnd).toBe(tokens[1].offset + "Meile".length);
	});

	test("after a conversion word, and not at the start of a line", () => {
		const tokens = lex("5 km in Meile");
		expect(rule.match(tokens, 2)?.replacement.map((t) => t.type)).toEqual(["IN", "UNIT", "UNIT_LABEL"]);
		expect(rule.match(lex("in Meile"), 0)).toBeNull();
	});

	test("boundary: a bare word, a word before `=`, a word no package aliases, an empty table", () => {
		expect(rule.match(lex("Meile"), 0)).toBeNull();
		expect(rule.match(lex("the Meile"), 0)).toBeNull();
		expect(rule.match(lex("2 Meile = 3"), 0)).toBeNull();
		expect(rule.match(lex("2 Kilometer"), 0)).toBeNull();
		expect(unitAliasRule(new UnitAliasTable()).match(lex("2 Meile"), 0)).toBeNull();
	});

	test("hostile: a prototype word and a position past the end", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(rule.match(lex(`2 ${word}`), 0)).toBeNull();
			expect(rule.match(lex("2"), 0)).toBeNull();
		});
	});
});

describe("userUnitExpansionRule, as a conversion target and a rename", () => {
	const table = new UserUnitTable();
	table.define(["sprint"], "2", "weeks");
	table.define(["click"], "1", "km");
	const rule = userUnitExpansionRule(table, 82, Number);

	test("a target: the base unit, then a label counting in the name", () => {
		const match = rule.match(lex("84 days in sprints"), 2);
		expect(match?.replacement.map((t) => `${t.type}:${t.value}`)).toEqual(["IN:in", "UNIT:weeks", "UNIT_LABEL:sprints"]);
		expect(match?.replacement[2].text).toBe("2");
	});

	test("a rename is labelled after a value; any other ratio still expands", () => {
		expect(rule.match(lex("3 clicks"), 0)?.replacement.map((t) => t.type)).toEqual(["NUMBER", "UNIT", "UNIT_LABEL"]);
		expect(rule.match(lex("6 sprints"), 0)?.replacement.map((t) => t.type)).toEqual(["NUMBER", "STAR", "NUMBER", "UNIT"]);
	});

	test("boundary: a ratio no count could be shown in is left for the target to refuse", () => {
		const zero = new UserUnitTable();
		zero.define(["blip"], "0", "days");
		expect(userUnitExpansionRule(zero, 82, Number).match(lex("5 days in blips"), 2)).toBeNull();
		const unreadable = new UserUnitTable();
		unreadable.define(["blip"], "x", "days");
		expect(userUnitExpansionRule(unreadable, 82, () => Number.NaN).match(lex("5 days in blips"), 2)).toBeNull();
	});

	test("hostile: a prototype word after `in` reaches no definition", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(rule.match(lex(`5 days in ${word}`), 2)).toBeNull();
		});
	});
});

describe("unitLabelToken", () => {
	test("sits after the unit it names, with the count as its text", () => {
		const [unit] = lex("mile");
		const label = unitLabelToken("Meile", 1, unit);
		expect(label.type).toBe("UNIT_LABEL");
		expect(label.value).toBe("Meile");
		expect(label.text).toBe("1");
		expect(label.offset).toBe(unit.offset + unit.text.length);
		expect(unitLabelToken("sprints", 2.5, unit).text).toBe("2.5");
	});
});

describe("labelQuantity", () => {
	test("labels a copy of a quantity and leaves the original", () => {
		const q = uomValue(3, "days");
		const labelled = labelQuantity(q, "Tage", 1);
		expect(labelled).not.toBe(q);
		expect(labelled.unitLabel).toEqual({ name: "Tage", per: 1 });
		expect(q.unitLabel).toBeUndefined();
		expect(labelled.unit).toBe("days");
		expect(labelled.toNumber()).toBe(3);
	});

	test("boundary: anything but a quantity, an empty name, a count that is not positive and finite", () => {
		const n = numberValue(3);
		expect(labelQuantity(n, "Tage", 1)).toBe(n);
		const e = errorValue("X", "y");
		expect(labelQuantity(e, "Tage", 1)).toBe(e);
		const q = uomValue(3, "days");
		for (const per of [0, -1, Number.NaN, Infinity]) expect(labelQuantity(q, "Tage", per)).toBe(q);
		expect(labelQuantity(q, "", 1)).toBe(q);
	});

	test("the builtin index is not a name a reader can call or be offered", () => {
		expect(UNIT_LABEL_BUILTIN).toBe(116);
		expect(builtinFunctionNames()).not.toContain("unitLabel");
		expect(answer(newTrackedEngine(), "unitLabel(3)")).toBe("refused");
	});
});

describe("a labelled value leaving the engine", () => {
	test("formatted under its name, counted in it", () => {
		const twelveWeeks = labelQuantity(uomValue(12, "weeks"), "sprints", 2);
		expect(formatValue(twelveWeeks)).toBe("= 6 sprints");
		expect(formatValue(labelQuantity(uomValue(3.10686, "mile"), "Meile", 1))).toBe("= 3.11 Meile");
		// Money keeps its symbol.
		expect(formatValue(labelQuantity(uomValue(5, "USD"), "Taler", 1))).toBe("= $5.00");
	});

	test("in JSON, across the worker boundary and through a snapshot", () => {
		const engine = engineWith(GERMAN);
		engine.parseDocument("x = 5 km in Meile");
		const x = engine.evaluateExpression("x");
		expect(x.toJSON().unitLabel).toEqual({ name: "Meile", per: 1 });
		expect(serializeValue(x).unitLabel).toEqual({ name: "Meile", per: 1 });
		expect(serializeValue(x).text).toBe("= 3.11 Meile");
		const restored = ExpressionEngine.fromJSON(engine.toJSON(), { packages: [...BUILTIN_PACKAGES, GERMAN] });
		try {
			expect(formatValue(restored.evaluateExpression("x"))).toBe("= 3.11 Meile");
		} finally {
			restored.clear();
		}
	});

	test("a snapshot carrying a malformed label is refused, not restored", () => {
		const engine = engineWith(GERMAN);
		engine.parseDocument("x = 5 km in Meile");
		const snapshot = JSON.parse(JSON.stringify(engine.toJSON()));
		const cell = JSON.stringify(snapshot).includes('"ul"');
		expect(cell).toBe(true);
		const broken = JSON.parse(JSON.stringify(snapshot).replace(/"ul":\{[^}]*\}/, '"ul":{"name":"","per":-1}'));
		expect(() => ExpressionEngine.fromJSON(broken, { packages: [...BUILTIN_PACKAGES, GERMAN] })).toThrow(EngineError);
	});
});

describe("registration", () => {
	let warn: ReturnType<typeof jest.spyOn>;
	beforeEach(() => {
		warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
	});
	afterEach(() => {
		warn.mockRestore();
	});

	test.each([
		["mile", "a unit"],
		["in", "the keyword IN"],
		["sqrt", "a built-in function"],
		["two words", "more than one word"],
		["", "an empty word"],
	])("the word %j is refused as unreachable (%s)", (word, readAs) => {
		const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES] });
		try {
			engine.registerPackage({ name: "bad", unitAliases: { [word]: "mile" } });
			throw new Error("registered");
		} catch (e) {
			expect((e as EngineError).code).toBe("PLUGIN_UNIT_ALIAS_UNREACHABLE");
			expect((e as EngineError).message).toContain(readAs);
		}
		expect(engine.getContext()).toBeDefined();
	});

	test.each(["furlongz", "5 km", "", "m/s", "x".repeat(1000)])("the target %j is refused as no unit", (unit) => {
		const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES] });
		expect(() => engine.registerPackage({ name: "bad", unitAliases: { Meile: unit } })).toThrow(expect.objectContaining({ code: "PLUGIN_UNIT_ALIAS_TARGET_UNKNOWN" }));
		// Nothing was written.
		expect(answer(engine, "2 Meile")).toBe("refused");
	});

	test("a refused package registers nothing, even its good aliases", () => {
		const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES] });
		expect(() => engine.registerPackage({ name: "half", unitAliases: { Meile: "mile", mile: "km" } })).toThrow();
		expect(answer(engine, "2 Meile")).toBe("refused");
	});

	test("unregistering removes an alias, and a second package's claim is handed back", () => {
		const other: IEnginePackage = { name: "other", unitAliases: { Meile: "km" } };
		const engine = engineWith(GERMAN, other);
		expect(answer(engine, "2 Meile")).toBe("2.00 Meile");
		expect(formatValue(engine.evaluateExpression("2 Meile in m"))).toBe("= 2,000.00 m");
		engine.unregisterPackage("other");
		expect(formatValue(engine.evaluateExpression("2 Meile in m"))).toBe("= 3,218.69 m");
		engine.unregisterPackage("german-units");
		expect(answer(engine, "2 Meile")).toBe("refused");
	});

	test("two packages aliasing one word to different units is a compatibility warning", () => {
		const report = checkPackageCompatibility({ name: "b", unitAliases: { Meile: "km" } }, [GERMAN]);
		expect(report.conflicts.map((c) => [c.kind, c.severity])).toEqual([["unitAlias", "warning"]]);
		expect(checkPackageCompatibility({ name: "b", unitAliases: { Meile: "mile" } }, [GERMAN]).conflicts).toEqual([]);
	});

	test("an alias is per engine", () => {
		const withIt = engineWith(GERMAN);
		const without = engineWith();
		expect(answer(withIt, "2 Meile")).toBe("2.00 Meile");
		expect(answer(without, "2 Meile")).toBe("refused");
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test("a prototype word as an alias key and as a line's word", () => {
		expectPrototypeUntouched(() => {
			const engine = engineWith({ name: "proto", unitAliases: { constructor: "mile", toString: "km" } });
			expect(answer(engine, "2 constructor")).toBe("2.00 constructor");
			expect(answer(engine, "5 km in toString")).toBe("5.00 toString");
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`2 ${word}`, { engine });
				expectHonestLine(`5 km in ${word}`, { engine });
			}
		});
	});

	test("a document defining a prototype word as a unit", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const lines = bothPasses([`1 ${word} = 2 weeks`, `84 days in ${word}`]);
				for (const line of lines) expect(line).not.toMatch(/\[object |is not a function|Cannot read/);
			}
		});
	});

	test("markup- and injection-shaped alias words are refused or read as text", () => {
		for (const word of ["<b>", "'; DROP", "${x}"]) {
			const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES] });
			expect(() => engine.registerPackage({ name: "m", unitAliases: { [word]: "mile" } })).toThrow(expect.objectContaining({ code: "PLUGIN_UNIT_ALIAS_UNREACHABLE" }));
		}
		const engine = engineWith(GERMAN);
		for (const text of TEXT_EDGES) {
			expectHonestLine(`2 Meile ${text}`, { engine });
			expectHonestLine(`5 km in Meile${text}`, { engine });
		}
	});

	test("look-alike characters are not the alias", () => {
		const engine = engineWith(GERMAN);
		expect(answer(engine, "2 Mei​le")).toBe("refused");
		expect(answer(engine, "2 Ｍeile")).toBe("refused");
		expect(answer(engine, "2 ‮Meile")).toBe("refused");
	});

	test("a thousand aliases and a long line of them stay within budget", () => {
		const many: Record<string, string> = {};
		for (let i = 0; i < 1000; i++) many[`Wort${i}`] = "mile";
		const engine = engineWith({ name: "many", unitAliases: many });
		expectHonestLine(Array.from({ length: 500 }, (_, i) => `${i} Wort${i}`).join(" + "), { engine, budgetMs: 5_000 });
		expectHonestLine(RESOURCE_PROBES.longSum(), { engine, budgetMs: 5_000 });
	});
});

describe("adversarial: realistic breakage", () => {
	test("an alias colliding with a variable: after a value it is the unit, elsewhere the variable", () => {
		expect(bothPasses([":Meile = 5", "2 Meile", "Meile * 2"], GERMAN)).toEqual(["5", "2.00 Meile", "10"]);
	});

	test("an alias mid-sentence in prose is left alone", () => {
		const lines = bothPasses(["the Meile is long", "a Meile away"], GERMAN);
		for (const line of lines) expect(line).not.toContain("mile");
	});

	test("a document's own definition of a package's word wins on that document", () => {
		expect(bothPasses(["1 Meile = 2 km", "2 Meile", "5 km in Meile"], GERMAN)).toEqual(["Meile defined", "4.00 km", "2.50 Meile"]);
	});

	test("a plural the trailing-s rule gets wrong is refused honestly", () => {
		expect(bothPasses(["1 Woche = 1 week", "3 Wochen"])[1]).toMatch(/^ERROR /);
		// A package lists each form, so its plural reads.
		expect(answer(engineWith(GERMAN), "5 km in Meilen")).toBe("3.11 Meilen");
	});

	test("a unit that does not fit is refused, naming the dimensions", () => {
		expect(bothPasses(["5 kg in Meile"], GERMAN)[0]).toBe("ERROR a mass cannot be converted to a length");
		expect(bothPasses(["1 sprint = 2 weeks", "5 kg in sprints"])[1]).toBe("ERROR a mass cannot be converted to a duration");
	});

	test("a value from the line above, a check over it, a tag and a what-if through it", () => {
		expect(bothPasses(["d = 10 km", "d in Meile", "check (d in Meile) > 6 mile", "prev"], GERMAN)).toEqual(["10.00 km", "6.21 Meile", "✓", "✓"]);
		const engine = engineWith(GERMAN);
		const scenario = engine.whatIf("d = 10 km\nd in Meile", { d: "20 km" });
		expect(formatValue(scenario.lines[1].result!)).toBe("= 12.43 Meile");
	});

	test("an edit to a definition re-answers the target on the incremental path", () => {
		const engine = engineWith();
		const text = "1 sprint = 2 weeks\n84 days in sprints";
		expect(show(evaluateDocument(engine, text))[1]).toBe("6 sprints");
		expect(show(evaluateDocument(engine, text.replace("2 weeks", "3 weeks")))[1]).toBe("4 sprints");
	});

	test("an explanation of a line converting into an alias answers the same", () => {
		const engine = engineWith(GERMAN);
		expect(formatValue(engine.explainLine("5 km in Meile").result)).toBe("= 3.11 Meile");
	});
});

describe("adversarial: edge cases", () => {
	test.each([...fill("X Meile", NUMERIC_EDGES), ...fill("X km in Meile", NUMERIC_EDGES), ...fill("X Tage in hours", NUMERIC_EDGES)])("%s is honest", (line) => {
		expectHonestLine(line, { engine: engineWith(GERMAN), allowNaN: line.includes("0/0") });
	});

	test.each(fill("1 sprint = 2 weeks\nX days in sprints", NUMERIC_EDGES))("a defined target over %j", (text) => {
		const lines = bothPasses(text.split("\n"));
		for (const line of lines) expect(line).not.toMatch(/undefined|\[object /);
	});

	test("zero, negative zero and a negative", () => {
		const engine = engineWith(GERMAN);
		expect(answer(engine, "0 Meile")).toBe("0.00 Meile");
		expect(answer(engine, "-0 km in Meile")).toBe("0.00 Meile");
		expect(answer(engine, "-5 km in Meile")).toBe("-3.11 Meile");
		expect(bothPasses(["1 sprint = 2 weeks", "-14 days in sprints", "0 days in sprints"]).slice(1)).toEqual(["-1 sprints", "0 sprints"]);
	});

	test("a ratio with a decimal comma under de", () => {
		const engine = newTrackedEngine({ locale: "de" });
		expect(show(engine.parseDocument("1 schicht = 2,5 days\n5 days in schicht"))[1]).toBe("2 schicht");
	});

	test("a CRLF document and a trailing newline", () => {
		expect(bothPasses(["1 sprint = 2 weeks\r", "84 days in sprints\r", ""])[1]).toBe("6 sprints");
	});

	test("a label never makes a line's value an arithmetic operand", () => {
		// The label is display: the value behind `2 Meile` is exactly two miles.
		const engine = engineWith(GERMAN);
		const v = engine.evaluateExpression("2 Meile");
		expect(v).toBeInstanceOf(Value);
		expect(v.unit).toBe("mile");
		expect(v.toNumber()).toBe(2);
	});
});
