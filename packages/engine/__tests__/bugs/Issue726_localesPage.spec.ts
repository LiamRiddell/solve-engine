import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { EngineError } from "@solve-js/errors/EngineError";
import { ValueType } from "@solve-js/vm/Value";
import { getLocale } from "@solve-js/constants/locales";
import { newTrackedEngine } from "@tools/trackedEngine";
import { PROTOTYPE_WORDS, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #726: nothing set out what each language pack reads. `guide/locales.md`
 * now has the support matrix, and its tables are proven here rather than in
 * `DocExamples.spec.ts`, whose notepad and engine take no locale: a ```solve
 * block always runs on an English engine.
 *
 * Every table on the page whose first header is `Typed` is a matrix: each
 * other header is a locale tag in backticks, each row's first cell a line in
 * backticks, and each cell the answer an engine in that locale gives, written
 * with the default (American English) output settings and the leading `= `
 * left off, or `refused` for a line the engine refuses (thrown, or answered
 * with an error value). A table whose first header is `Tag` is the output
 * half: each row a tag passed as `numberResult.decimalSeparatorLocale`, each
 * header a line an English engine evaluates. Changing what a pack reads turns
 * this red until the page follows.
 */

const PAGE = path.resolve(__dirname, "../../../../docs/src/content/docs/guide/locales.md");

interface Table {
	/** The 1-based line of the header row, for the failure message. */
	line: number;
	header: string[];
	rows: string[][];
}

/** Every markdown table on a page, as cells with surrounding space removed. */
function tables(markdown: string): Table[] {
	const out: Table[] = [];
	const lines = markdown.split(/\r?\n/);
	const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].trim().startsWith("|") || !/^\s*\|\s*-/.test(lines[i + 1] ?? "")) continue;
		const table: Table = { line: i + 1, header: cells(lines[i]), rows: [] };
		let j = i + 2;
		while (j < lines.length && lines[j].trim().startsWith("|")) table.rows.push(cells(lines[j++]));
		out.push(table);
		i = j;
	}
	return out;
}

/** A cell's text inside its backticks, or the cell as it is. */
function unquote(cell: string): string {
	const m = cell.match(/^`(.*)`/);
	return m ? m[1] : cell;
}

/** What an engine in `locale` answers for `line`, as the page's cells write it. */
function answer(locale: string, line: string): string {
	const engine = newTrackedEngine({ locale, config: { network: { enabled: false } } });
	try {
		const value = engine.evaluateExpression(line);
		if (value.type === ValueType.Error) return "refused";
		return formatValue(value, DEFAULT_FORMATTING_SETTINGS).replace(/^=\s*/, "");
	} catch (e) {
		if (e instanceof EngineError) return "refused";
		throw e;
	}
}

const page = fs.readFileSync(PAGE, "utf8");
const all = tables(page);
const matrices = all.filter((t) => t.header[0] === "Typed");
const outputs = all.filter((t) => t.header[0] === "Tag");

describe("guide/locales.md: every matrix cell is what the engine answers", () => {
	test("the page has its matrices", () => {
		// Guards the proof against a rename that would leave it proving nothing.
		expect(matrices.length).toBeGreaterThanOrEqual(4);
		expect(outputs.length).toBe(1);
	});

	const cases = matrices.flatMap((table) =>
		table.rows.flatMap((row) =>
			table.header.slice(1).map((tag, k) => [`line ${table.line}: ${unquote(row[0])} under ${unquote(tag)}`, unquote(tag), unquote(row[0]), unquote(row[k + 1])] as const),
		),
	);

	test.each(cases)("%s", (_label, locale, line, expected) => {
		expect(`${line} // ${answer(locale, line)}`).toBe(`${line} // ${expected}`);
	});

	const written = outputs.flatMap((table) =>
		table.rows.flatMap((row) =>
			table.header.slice(1).map((expression, k) => {
				const tag = unquote(row[0]);
				return [`${unquote(expression)} written for ${tag}`, tag, unquote(expression), unquote(row[k + 1])] as const;
			}),
		),
	);

	test.each(written)("%s", (_label, tag, expression, expected) => {
		const value = newTrackedEngine().evaluateExpression(expression);
		// French groups with a narrow no-break space, which the page writes as a
		// plain space so that it reads (and searches) as one.
		const text = formatValue(value, { numberResult: { decimalSeparatorLocale: tag } }).replace(/^=\s*/, "").replace(/[\u202f\u00a0]/g, " ");
		expect(text).toBe(expected);
	});
});

// ── The parts the page describes ─────────────────────────────────────────

describe("getLocale, as the page's region-tag section describes it", () => {
	test.each([
		["de", "de"], ["de-DE", "de"], ["de-AT", "de"], ["de_DE", "de"], ["DE", "de"],
		["fr-FR", "fr"], ["fr-CA", "fr"], ["en-GB", "en"], ["en-IN", "en"], ["xx", "en"], ["", "en"],
	])("%s reads as %s", (tag, pack) => {
		expect(getLocale(tag).code).toBe(pack);
	});

	test.each(PROTOTYPE_WORDS)("%s reads as English, and builds a working engine", (word) => {
		expectPrototypeUntouched(() => {
			expect(getLocale(word).code).toBe("en");
			expect(answer(word, "2 + 3")).toBe("5");
		});
	});

	test("a value that is not a string reads as English", () => {
		expect(getLocale(42 as never).code).toBe("en");
		expect(getLocale(null as never).code).toBe("en");
	});

	test("a tag far longer than any language subtag reads as English, quickly", () => {
		const started = performance.now();
		expect(getLocale("d".repeat(100_000)).code).toBe("en");
		expect(performance.now() - started).toBeLessThan(100);
	});
});

describe("the German function names the page lists", () => {
	test.each(["wurzel(16)", "runden(7/2)", "aufrunden(7/2)", "abrunden(7/2)"])("%s is refused as an unknown function, not an undefined one", (line) => {
		const engine = newTrackedEngine({ locale: "de" });
		expect(() => engine.evaluateExpression(line)).toThrow(/^Unknown function: /);
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: what the page's claims survive", () => {
	test.each(["en", "de", "fr"])("under %s, a line of each text edge is answered or refused, never a raw error", (locale) => {
		for (const text of TEXT_EDGES) expect(() => answer(locale, text)).not.toThrow();
	});

	test.each(["de", "fr"])("under %s, a pack's keyword used as a variable name is refused honestly", (locale) => {
		const engine = newTrackedEngine({ locale });
		const doc = engine.parseDocument(locale === "de" ? ":mal = 3\nmal + 1" : ":fois = 3\nfois + 1");
		for (const line of doc.lines) expect(line.error ?? "").not.toMatch(/\[object |is not a function|Cannot read/);
	});

	test("a German document and its batch and incremental passes agree on the matrix lines", async () => {
		const { evaluateDocument } = await import("@solve-js/engine/evaluateDocument");
		const text = ["2.500 * 2", "3 mal 4", "10% von 200", "5 km in miles", "1,500"].join("\n");
		const engine = newTrackedEngine({ locale: "de" });
		const show = (r: ReturnType<typeof engine.parseDocument>) => r.lines.map((l) => (l.result ? formatValue(l.result) : l.error));
		expect(show(evaluateDocument(newTrackedEngine({ locale: "de" }), text))).toEqual(show(engine.parseDocument(text)));
		expect(show(engine.parseDocument(text))).toEqual(["= 5,000", "= 12", "= 20", "= 3.11 miles", "= 1.50"]);
	});

	test("digits from other scripts are not read as numbers in any pack", () => {
		for (const locale of ["en", "de", "fr"]) {
			expect(answer(locale, "٣ + 1")).toBe("refused");
			expect(answer(locale, "５ + 1")).not.toBe("6");
		}
	});

	test("the largest safe whole number with German grouping", () => {
		expect(answer("de", "9.007.199.254.740.991")).toBe("9,007,199,254,740,991");
		expect(answer("en", "9,007,199,254,740,991")).toBe("9,007,199,254,740,991");
	});
});
