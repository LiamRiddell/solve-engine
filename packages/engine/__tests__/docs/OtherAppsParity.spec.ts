/**
 * Every example the other calculator-notepad apps document with a stated
 * result, run against this engine, in the shape of `SoulverParity.spec.ts`.
 *
 * `docs-internal/OTHER_APPS_FEATURE_AUDIT.md` was written by reading each app's
 * documentation and marking areas, and nothing re-read it: it still said the
 * engine "deliberately requires `:name = value`" after bare names had shipped
 * (#786). This spec is its executable half. Each example is in exactly one list:
 *
 * - `SUPPORTED`: asserted to produce the documented answer.
 * - `GAPS`: asserted to still not produce it, so a fix fails the run until the
 *   row is promoted.
 * - `DECLINED`: a form this engine refuses, or answers another way, by
 *   decision, with the reason; it is asserted to stay that way, so a change
 *   that starts giving the documented answer is noticed.
 *
 * An example is a document: its lines are evaluated together, through both
 * `parseDocument` and `evaluateDocument`, which must agree, and the last line's
 * answer is compared with the documented one by the same loose rule the Soulver
 * spec uses (`parityMatches`). A documented feature with no stated output stays
 * prose in the audit, not a row here.
 *
 * Sources, fetched 2026-09-30: Numi's wiki
 * (https://github.com/nikolaeu/numi/wiki, `Home.md`) and Numbr's `DOCS.md`
 * (https://github.com/antonmedv/numbr/blob/master/DOCS.md). The Notes
 * Calculator row is the one example the audit quotes from
 * docs.notescalculator.com with its result. The Calca rows, fetched
 * 2026-10-01, are the examples with a stated result in two announcement posts
 * by Calca's author on his own blog, whose source is the public repository
 * `praeclarum/praeclarum.github.io` (read through raw.githubusercontent.com):
 * `_posts/2013/2013-07-09-calca-the-text-editor-for-engineers.md` and
 * `_posts/2013/2013-10-21-calca-for-windows-you-asked-for-it.md`.
 *
 * NumPad's, Notes Calculator's and Calca's own documentation sites, and
 * web.archive.org, refuse connections from the environment the corpus was
 * collected in, and no mirror of the first two was found (GitHub code search,
 * raw.githubusercontent.com and the npm registry were tried). The audit quotes
 * many of their forms, but without a result (`$40 as a % of $50`,
 * `sum(line 1 : line 4)`, `double(double(5))`), so those stay prose there
 * rather than becoming rows with an answer nobody documented. What remains is
 * listed in {@link NOT_YET_COLLECTED}.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import { DEFAULT_FORMATTING_SETTINGS } from "@solve-js/format/FormattingSettings";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { ParsedLine } from "@solve-js/types/ParsingResult";
import {
	PARITY_QUOTING_DOCUMENTS,
	committedParityCounts,
	parityMatches,
	quotedParityCounts,
	recordParityCounts,
	writingParityStats,
} from "@tools/parity";

/** One documented example: the app, the lines of the note, and the answer its docs state for the last line. */
type Example = readonly [app: string, lines: readonly string[], documented: string];

/**
 * How a declined example is answered: refused outright, or answered with a
 * different, deliberate result (the same value shown another way).
 */
type DeclinedOutcome = "refused" | "answered differently";

/** A declined example, with the decision that rules it out and how the engine answers it instead. */
type Declined = readonly [app: string, lines: readonly string[], documented: string, reason: string, outcome: DeclinedOutcome];

/** Documented examples this engine answers as documented. */
const SUPPORTED: readonly Example[] = [
	// Numi, "Operations": a compound length reads as one quantity.
	["numi", ["1 meter 20 cm"], "120 cm"],
	// Numi, "Operations": a bracket after a number multiplies.
	["numi", ["6 (3)"], "18"],
	// Numi, "Constants", given to ten decimal places; the formatter shows two.
	["numi", ["Pi"], "3.14"],
	["numi", ["E"], "2.72"],
	// Numbr, "References": a pasted answer in brackets reads as a number.
	["numbr", ["100 + 200"], "300"],
	["numbr", ["100 + 200", "(300) + 25%"], "375"],
	// Notes Calculator, "Functions", as the audit quotes it.
	["notes-calculator", ["f(x) = 2*x + 1", "f(5)"], "11"],
	// Numi, "Variables", and the audit's claim about bare names (#786).
	["numi", ["price = 20", "price * 3"], "60"],
	// Calca, "Calca for Windows, you asked for it!" (2013-10-21): a unit
	// conversion, written `12 tbsp in cups => 0.75 cups` there.
	["calca", ["12 tbsp in cups"], "0.75 cups"],
	// Calca, "Calca - the text editor for engineers" (2013-07-09): "Numbers
	// can be written with grouping separators".
	["calca", ["100,033,234.56"], "100,033,234.56"],
];

/** Documented examples this engine does not answer as documented. */
const GAPS: readonly Example[] = [
	// Numi, "CSS": a physical length to pixels at the default 96 ppi. This
	// engine keeps CSS lengths a measure of their own (px and rem), so the
	// conversion is refused as between different kinds of quantity. Item 3 of
	// the audit's engine limitations.
	["numi", ["1 inch in px"], "96 px"],
	// Numi, "CSS": a `ppi = 326` line changes what the conversion means. A
	// variable cannot reconfigure a unit's ratio here; same limitation.
	["numi", ["ppi = 326", "1 cm in px"], "128.35 px"],
	// Calca, "Calca for Windows, you asked for it!": the water that falls on a
	// plot of land in a year. The names of several words read (#743), and the
	// first two lines answer `0.25 acre` and `36.15 inch/year`; the third is
	// refused, since a rate (a length per year) times a quantity (an area) is
	// not a product the engine forms: "Cannot multiply a rate per year by a
	// quantity in acre". The same refusal meets `10 m/s * 2 m`, so it is the
	// rate model, not this note.
	[
		"calca",
		[
			"land area = 0.25 acre",
			"avg annual precip = 36.15 inch / year",
			"daily rain accumulation = avg annual precip * land area in gallon/day",
		],
		"671.9012 gallon/day",
	],
	// Calca, "Calca - the text editor for engineers": an equation in three
	// unknowns, solved for one of them symbolically. The first line does not
	// parse (`(yearly salary` is read as a bracket holding one word), and the
	// second answers `= 0.00%`, a confident wrong answer pinned below.
	[
		"calca",
		["(yearly salary / 12) * tax percent / 100 = monthly take", "tax percent =>"],
		"1200monthly take/yearly salary",
	],
];

/** Documented forms this engine refuses on purpose. */
const DECLINED: readonly Declined[] = [
	[
		"numbr",
		["2 x 3"],
		"6",
		"a bare `x` stays a name (a coordinate, a variable, `2x`); `*` and `×` are the multiplication signs",
		"refused",
	],
	[
		// Calca, "Calca - the text editor for engineers": "You can type `33%`
		// instead of `0.33`".
		"calca",
		["33%"],
		"0.33",
		"a percentage keeps its kind and is shown as one (`= 33.00%`), so that `+ 10%` and `% of` can read it; its value in arithmetic is the documented one (`33% * 1` gives `= 0.33`)",
		"answered differently",
	],
];

/**
 * Apps whose documented examples are not in the lists above yet, each with the
 * reason. Recorded so the corpus's reach is stated rather than implied.
 */
const NOT_YET_COLLECTED: ReadonlyMap<string, string> = new Map([
	[
		"numpad",
		"docs.numpad.io and web.archive.org refused connections and no mirror was found; the audit quotes its forms without stated results, so none is a row",
	],
	[
		"notes-calculator",
		"docs.notescalculator.com and web.archive.org refused connections and no mirror was found; only the example the audit quotes with its result is a row",
	],
	[
		"calca",
		"calca.io/reference refused connections; the rows are the examples with stated results in its author's announcement posts, and the reference's own examples are not collected",
	],
	["calculo", "no public syntax reference (its only documentation-shaped page returns 403)"],
]);

/** The answer a document line shows, or `THREW: <message>` for a failed line. */
function shown(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	if (!line.result) return "THREW: no result";
	return formatValue(line.result, DEFAULT_FORMATTING_SETTINGS);
}

/**
 * Evaluates a note through both document passes and returns the last line's
 * answer from each.
 *
 * @param lines - The note's lines.
 * @returns The batch and incremental answers for the last line.
 */
function evaluate(lines: readonly string[]): { batch: string; incremental: string } {
	const source = lines.join("\n");
	const batch = newTrackedEngine({ config: { network: { enabled: false } } }).parseDocument(source);
	const incremental = evaluateDocument(newTrackedEngine({ config: { network: { enabled: false } } }), source);
	return { batch: shown(batch.lines[lines.length - 1]), incremental: shown(incremental.lines[lines.length - 1]) };
}

/** A label for a row: the app and the note, lines joined as the reader types them. */
const label = (app: string, lines: readonly string[]) => `[${app}] ${lines.join(" | ")}`;

describe("other apps: documented examples that work", () => {
	test.each(SUPPORTED.map((row) => [label(row[0], row[1]), row] as const))("%s", (_name, [, lines, documented]) => {
		const { batch, incremental } = evaluate(lines);
		expect({ lines, documented, got: batch, matches: parityMatches(batch, documented) }).toEqual({
			lines,
			documented,
			got: batch,
			matches: true,
		});
		expect(incremental).toBe(batch);
	});
});

describe("other apps: documented examples that do not", () => {
	test("every recorded gap is still a gap, with an honest refusal and both passes agreeing", () => {
		const fixed: string[] = [];
		for (const [app, lines, documented] of GAPS) {
			const { batch, incremental } = evaluate(lines);
			expect(incremental).toBe(batch);
			expect(batch).not.toMatch(/\[object Object\]|TypeError|RangeError|NaN|undefined/);
			if (parityMatches(batch, documented)) fixed.push(label(app, lines));
		}
		expect({ message: "These now produce the documented answer. Move them into SUPPORTED.", fixed }).toEqual({
			message: "These now produce the documented answer. Move them into SUPPORTED.",
			fixed: [],
		});
	});

	test("every declined form is still declined in the way recorded, and each has its reason", () => {
		for (const [app, lines, documented, reason, outcome] of DECLINED) {
			expect(reason.length).toBeGreaterThan(20);
			const { batch, incremental } = evaluate(lines);
			expect(incremental).toBe(batch);
			const seen: DeclinedOutcome | "answered as documented" = parityMatches(batch, documented)
				? "answered as documented"
				: batch.startsWith("THREW:")
					? "refused"
					: "answered differently";
			expect({ row: label(app, lines), outcome: seen }).toEqual({ row: label(app, lines), outcome });
		}
	});

	// Found while collecting the Calca corpus: an unknown name before
	// `percent` under `=>` answers a confident zero rather than refusing.
	// `foo percent` alone says `Undefined variable: foo`. Reported for filing;
	// this turns red when it is fixed, and then becomes an ordinary test.
	test.failing("an unknown name before `percent` under `=>` is refused rather than answered as 0.00%", () => {
		expect(evaluate(["foo percent =>"]).batch).toMatch(/^THREW:/);
	});

	test("the apps not yet collected each say why", () => {
		for (const [app, reason] of NOT_YET_COLLECTED) {
			expect({ app, hasReason: reason.length > 20 }).toEqual({ app, hasReason: true });
		}
	});
});

describe("other apps: the corpus is well formed", () => {
	test("no example is in two lists", () => {
		const keys = [...SUPPORTED, ...GAPS, ...DECLINED].map((row) => label(row[0], row[1]));
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("every row names an app the audit covers", () => {
		const apps = new Set(["numi", "numbr", "notes-calculator", "numpad", "calca"]);
		for (const row of [...SUPPORTED, ...GAPS, ...DECLINED]) expect(apps.has(row[0])).toBe(true);
	});

	test("the matcher refuses a thrown line and a bare number against a unit", () => {
		expect(parityMatches("THREW: 18", "18")).toBe(false);
		expect(parityMatches("= 120", "120 cm")).toBe(false);
		expect(parityMatches("= 120.00 cm", "120 cm")).toBe(true);
		expect(parityMatches("= $345.00", "$45")).toBe(false);
		expect(parityMatches("", "")).toBe(true);
		expect(parityMatches("constructor", "__proto__")).toBe(false);
	});
});

describe("other apps: the counts the audit quotes are the counts measured", () => {
	const measured = {
		supported: SUPPORTED.length,
		gaps: GAPS.length,
		declined: DECLINED.length,
		total: SUPPORTED.length + GAPS.length + DECLINED.length,
	};
	recordParityCounts("otherApps", measured);

	test("docs-internal/parity-stats.json holds them (npm run stats:parity rewrites it)", () => {
		expect(committedParityCounts("otherApps")).toEqual(measured);
	});

	test.each(PARITY_QUOTING_DOCUMENTS)("every figure %s quotes for this corpus is the measured one", (file) => {
		if (writingParityStats()) return;
		const text = fs.readFileSync(file, "utf8");
		for (const { name, quoted } of quotedParityCounts(text, "otherApps")) {
			expect({ name, quoted }).toEqual({ name, quoted: (measured as Record<string, number>)[name] });
		}
	});
});
