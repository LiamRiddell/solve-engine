import { describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { EXTENDED_UNITS, IMPERIAL_MPG_SPELLINGS, MILES_PER_IMPERIAL_GALLON_IN_KM_PER_LITRE } from "@solve-js/uom/ExtendedUnits";
import { PROTOTYPE_WORDS } from "@tools/adversarial";

/**
 * #782, the part left open: the unit reference read `ExtendedUnits.ts` one
 * `key: { measure, toBase }` line at a time, so the five spellings of miles per
 * imperial gallon, spread into the table from `IMPERIAL_MPG_SPELLINGS`, were
 * accepted by the engine and missing from the page that lists every spelling.
 * `scripts/lib/extended-units.mjs` now reads the spread too, and fails the run
 * on a spread it cannot read, so a new list cannot be left off quietly. The
 * reader is an ES module the jest transform does not load, so it is called
 * through a child `node`, as the headline spec calls `unit-names.mjs`.
 */

const REPO = path.resolve(__dirname, "../../../..");
const LIB = path.join(REPO, "scripts/lib/extended-units.mjs");
const EXTENDED = path.join(REPO, "packages/engine/src/uom/ExtendedUnits.ts");
const PAGE = path.join(REPO, "docs/src/content/docs/syntax/unit-reference.md");

interface Entry {
	spelling: string;
	measure: string;
	ratio: number;
}

/** Runs the reader over `source` in a child node, returning its entries or the message it threw. */
function read(source: string): Entry[] | { error: string } {
	const program = `import * as lib from ${JSON.stringify(`file://${LIB}`)};
let out;
try { out = lib.readExtendedEntries(${JSON.stringify(source)}); } catch (e) { out = { error: e.message }; }
process.stdout.write(JSON.stringify(out));`;
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8", timeout: 30_000 });
	if (result.status !== 0) throw new Error(result.stderr);
	return JSON.parse(result.stdout) as Entry[] | { error: string };
}

/** Runs `ratioValue` in a child node. */
function ratio(raw: string, constants: Record<string, string> = {}): number | { error: string } {
	const program = `import * as lib from ${JSON.stringify(`file://${LIB}`)};
let out;
try { out = lib.ratioValue(${JSON.stringify(raw)}, new Map(Object.entries(${JSON.stringify(constants)}))); } catch (e) { out = { error: e.message }; }
process.stdout.write(JSON.stringify(out));`;
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8", timeout: 30_000 });
	if (result.status !== 0) throw new Error(result.stderr);
	return JSON.parse(result.stdout) as number | { error: string };
}

const spread = (list: string, body = 'measure: "fuelEconomy", toBase: 2') =>
	`export const ${list}: readonly string[] = ["a b", "c d"];\nexport const T = {\n  x: { measure: "length", toBase: 1 },\n  ...Object.fromEntries(\n    ${list}.map((s) => [s, { ${body} }]),\n  ),\n};\n`;

describe("the real table", () => {
	const entries = read(fs.readFileSync(EXTENDED, "utf8")) as Entry[];

	test("every spread spelling of miles per imperial gallon is read, at its ratio", () => {
		for (const spelling of IMPERIAL_MPG_SPELLINGS) {
			const found = entries.filter((e) => e.spelling === spelling);
			expect({ spelling, found }).toEqual({ spelling, found: [{ spelling, measure: "fuelEconomy", ratio: MILES_PER_IMPERIAL_GALLON_IN_KM_PER_LITRE }] });
		}
	});

	test("the reader finds every spelling the table defines, spread or not, and nothing else", () => {
		expect(entries.map((e) => e.spelling).sort()).toEqual(Object.keys(EXTENDED_UNITS).sort());
		for (const e of entries) expect(e.ratio).toBeCloseTo(EXTENDED_UNITS[e.spelling].toBase, 12);
	});

	test("the page lists every spread spelling, in one row with its name", () => {
		const page = fs.readFileSync(PAGE, "utf8");
		const row = page.split("\n").find((line) => line.startsWith("| mile per imperial gallon |"));
		expect(row).toBeDefined();
		for (const spelling of IMPERIAL_MPG_SPELLINGS) expect(row).toContain(`\`${spelling}\``);
	});
});

describe("readExtendedEntries, ordinary, boundary and hostile sources", () => {
	test("a spread of a list is one entry per spelling, in source order", () => {
		expect(read(spread("SPELLINGS"))).toEqual([
			{ spelling: "x", measure: "length", ratio: 1 },
			{ spelling: "a b", measure: "fuelEconomy", ratio: 2 },
			{ spelling: "c d", measure: "fuelEconomy", ratio: 2 },
		]);
	});

	test("a quoted key, a spelling with a space, is read as the bare ones are (the page left the cups out too)", () => {
		expect(read('export const T = {\n  "US cup": { measure: "volume", toBase: 0.0002365882365 },\n  kn: { measure: "speed", toBase: 1852 / 3600 },\n};\n')).toEqual([
			{ spelling: "US cup", measure: "volume", ratio: 0.0002365882365 },
			{ spelling: "kn", measure: "speed", ratio: 1852 / 3600 },
		]);
	});

	test("a spread's ratio may be a constant the file exports", () => {
		const source = `export const K = 3 / 4;\n${spread("SPELLINGS", 'measure: "fuelEconomy", toBase: K')}`;
		expect((read(source) as Entry[]).map((e) => e.ratio)).toEqual([1, 0.75, 0.75]);
	});

	test("a spread of a shape the reader does not know fails the run, rather than leaving spellings off", () => {
		const source = `export const T = {\n  x: { measure: "length", toBase: 1 },\n  ...OTHER_UNITS,\n};\n`;
		expect(read(source)).toEqual({ error: expect.stringContaining("spreads 1 lists into the table and 0 could be read") });
	});

	test("a spread of a list the file does not define fails the run", () => {
		const source = spread("SPELLINGS").replace("export const SPELLINGS", "export const ELSEWHERE");
		expect(read(source)).toEqual({ error: expect.stringContaining("SPELLINGS, which the file does not export") });
	});

	test("an empty file and an empty list read as nothing", () => {
		expect(read("")).toEqual([]);
		expect(read(spread("SPELLINGS").replace('["a b", "c d"]', "[]"))).toEqual([{ spelling: "x", measure: "length", ratio: 1 }]);
	});

	test("prototype words as spellings and as a list's name are read as text", () => {
		const words = JSON.stringify([...PROTOTYPE_WORDS]).slice(1, -1);
		const out = read(spread("SPELLINGS").replace('"a b", "c d"', words)) as Entry[];
		expect(out.slice(1).map((e) => e.spelling)).toEqual([...PROTOTYPE_WORDS]);
		expect(Object.prototype.hasOwnProperty.call(Object.prototype, "a b")).toBe(false);
	});

	test("markup- and code-shaped ratio text is refused, never run", () => {
		expect(read(spread("SPELLINGS", 'measure: "fuelEconomy", toBase: process.exit(1)'))).toEqual({ error: expect.stringContaining("Cannot read the ratio") });
		expect(read(spread("SPELLINGS", 'measure: "fuelEconomy", toBase: <b>1</b>'))).toEqual({ error: expect.stringContaining("Cannot read the ratio") });
	});
});

describe("ratioValue", () => {
	test("a number, a product or quotient, separators, and a named constant", () => {
		expect(ratio("0.44704")).toBe(0.44704);
		expect(ratio("1852 / 3600")).toBe(1852 / 3600);
		expect(ratio("2 * 3")).toBe(6);
		expect(ratio("1_000_000")).toBe(1_000_000);
		expect(ratio("1e-6")).toBe(1e-6);
		expect(ratio("K", { K: "1.609344 / 4.54609" })).toBe(1.609344 / 4.54609);
	});

	test("zero, a negative, and a constant that names itself are handled rather than looped on", () => {
		expect(ratio("0")).toBe(0);
		expect(ratio("-0.5")).toBe(-0.5);
		expect(ratio("K", { K: "K" })).toEqual({ error: expect.stringContaining("Cannot read the ratio") });
	});

	test("an expression of any other shape is refused by name", () => {
		for (const raw of ["", "1 + 2", "Math.PI", "constructor", "__proto__", "1 / 2 / 3"]) {
			expect(ratio(raw)).toEqual({ error: expect.stringContaining("Cannot read the ratio") });
		}
	});
});
