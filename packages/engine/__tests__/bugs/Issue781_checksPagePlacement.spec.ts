import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { createEngine } from "@solve-js/api/createEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { PROTOTYPE_WORDS } from "@tools/adversarial";
import { ValueType } from "@solve-js/vm/Value";

/**
 * #781: checks have their own page, `syntax/checks.md`, in the "Working across
 * lines" group, and the two pages that read no other line (conditionals, and
 * map, reduce and aggregates) sit with the arithmetic and the list work. The
 * sidebar is read as text, the way `check-sidebar.mjs` reads it, and the page's
 * claims about how a check sits among other lines are held against the engine
 * through both document passes.
 */

const ROOT = path.resolve(__dirname, "../../../..");
const CONFIG = fs.readFileSync(path.join(ROOT, "docs/astro.config.mjs"), "utf8");
const DOCS = path.join(ROOT, "docs/src/content/docs");

/** The slugs a sidebar group lists, in order, read from the config text. */
function group(label: string): string[] {
	const start = CONFIG.indexOf(`label: "${label}"`);
	expect(start).toBeGreaterThan(-1);
	const end = CONFIG.indexOf("],", start);
	return Array.from(CONFIG.slice(start, end).matchAll(/slug:\s*"([^"]+)"/g), (m) => m[1]);
}

const show = (value: Parameters<typeof formatValue>[0]) => formatValue(value, DEFAULT_FORMATTING_SETTINGS).replace(/^=\s*/, "");

describe("where the pages sit", () => {
	test("checks is its own page, before goal seek in Working across lines", () => {
		expect(fs.existsSync(path.join(DOCS, "syntax/checks.md"))).toBe(true);
		const across = group("Working across lines");
		expect(across.indexOf("syntax/checks")).toBe(across.indexOf("syntax/goal-seek") - 1);
	});

	test("conditionals and map-reduce no longer sit with the cross-line forms", () => {
		const across = group("Working across lines");
		expect(across).not.toContain("syntax/conditionals");
		expect(across).not.toContain("syntax/map-reduce-and-aggregates");
		expect(group("Arithmetic")).toContain("syntax/conditionals");
		const statistics = group("Statistics");
		expect(statistics.indexOf("syntax/map-reduce-and-aggregates")).toBe(statistics.indexOf("syntax/vectors-and-matrices") + 1);
	});

	test("conditionals.md keeps a Checks heading that points at the new page, so the old anchor lands", () => {
		const page = fs.readFileSync(path.join(DOCS, "syntax/conditionals.md"), "utf8");
		const section = page.slice(page.indexOf("## Checks"), page.indexOf("## `and` between comparisons"));
		expect(section).toContain("(/syntax/checks/)");
		expect(section).not.toContain("```");
	});

	test("nothing links the old anchor any more", () => {
		const walk = (dir: string): string[] =>
			fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.mdx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
		for (const file of [...walk(DOCS), path.join(ROOT, "README.md")]) {
			expect({ file, old: fs.readFileSync(file, "utf8").includes("/syntax/conditionals/#checks") }).toEqual({ file, old: false });
		}
	});

	test("the cheatsheet gives checks its own line and keeps check off the conditionals line", () => {
		const sheet = fs.readFileSync(path.join(DOCS, "syntax/cheatsheet.md"), "utf8");
		expect(sheet).toContain("**[Checks](/syntax/checks/)**");
		const conditionals = sheet.slice(sheet.indexOf("**[Conditionals]"), sheet.indexOf("## Numbers"));
		expect(conditionals).not.toContain("check ");
	});
});

describe("what the page says a check does, through both passes", () => {
	const both = (source: string) => {
		const batch = createEngine({ config: { network: { enabled: false } } }).parseDocument(source);
		const incremental = evaluateDocument(createEngine({ config: { network: { enabled: false } } }), source);
		// A failed check comes back as an error-typed value rather than a line
		// error, so it is marked the way DocExamples.spec.ts marks it.
		const read = (lines: typeof batch.lines) =>
			lines.map((l) => (l.error ? `ERROR: ${l.error}` : l.result ? `${l.result.type === ValueType.Error ? "ERROR: " : ""}${show(l.result)}` : ""));
		return { batch: read(batch.lines), incremental: read(incremental.lines), checks: batch.checks };
	};

	test("a total above steps over a failed check", () => {
		const { batch, incremental, checks } = both("£900\n£300\ncheck line 1 + line 2 <= £1,000\ntotal above");
		expect(batch[2]).toBe("ERROR: check failed: £1,200.00 is more than £1,000.00");
		expect(batch[3]).toBe("£1,200.00");
		expect(incremental).toEqual(batch);
		expect(checks).toEqual({ passed: 0, failed: 1 });
	});

	test("a variable called check keeps working", () => {
		const { batch, incremental, checks } = both("check = 45\ncheck * 2");
		expect(batch).toEqual(["45", "90"]);
		expect(incremental).toEqual(batch);
		expect(checks).toBeUndefined();
	});

	test("incomparable sides are refused as incomparable, text only by equality", () => {
		const { batch, incremental } = both('check 1 m == 1 kg\ncheck "a" == "a"\ncheck "a" > "b"');
		expect(batch).toEqual([
			"ERROR: check: length and mass cannot be compared",
			"✓",
			"ERROR: check: text can only be compared with == or !=, not >",
		]);
		expect(incremental).toEqual(batch);
	});

	test("edge cases: zero, negative zero, 2^53 and an empty line between", () => {
		const { batch, incremental } = both("check 0 == -0\n\ncheck 2^53 + 1 > 2^53\ncheck -1 < 0");
		expect(batch).toEqual(["✓", "", "✓", "✓"]);
		expect(incremental).toEqual(batch);
	});

	test("a check over a name that is an inherited property word is honest, and the prototype is untouched", () => {
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		for (const word of PROTOTYPE_WORDS) {
			const { batch, incremental } = both(`check ${word} == 1`);
			expect(incremental).toEqual(batch);
			expect(batch[0]).not.toMatch(/\[object Object\]|TypeError|RangeError|function/);
		}
		expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
	});
});
