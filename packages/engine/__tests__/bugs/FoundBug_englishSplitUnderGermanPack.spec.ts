import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { deLocale } from "@solve-js/constants/locales";

/**
 * Found bug: under a de-DE engine, `split €100 between 3` was refused, though
 * English words are meant to keep working under a locale pack. Already fixed on
 * the current engine by #833, which made a pack's keyword table English plus
 * the pack's own words. Pinned here for the split form, whose words (`split`,
 * `between`, `people`) are not in #833's own spec, under both the `de` and the
 * `de-DE` code a host may pass.
 */

function engineFor(locale: string) {
	return newTrackedEngine({ locale, config: { network: { enabled: false } } });
}

function shown(locale: string, line: string): string {
	try {
		return formatValue(engineFor(locale).evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

describe("the line that exposed it", () => {
	test.each(["de", "de-DE"])("under %s the English split form reads", (locale) => {
		expect(shown(locale, "split €100 between 3")).toBe("€33.33 each, with 1 share paying €33.34");
		expect(shown(locale, "split 100 € between 3")).toBe("€33.33 each, with 1 share paying €33.34");
		expect(shown(locale, "split 100,50 € between 3")).toBe("€33.50 each");
		expect(shown(locale, "split €100 between 3 people")).toBe("€33.33 each, with 1 share paying €33.34");
		expect(shown(locale, "split 100 between 4")).toBe("25 each");
	});

	test("the English engine answers the same", () => {
		expect(shown("en", "split €100 between 3")).toBe("€33.33 each, with 1 share paying €33.34");
	});
});

describe("the part: the German keyword table carries the split words", () => {
	test("split and between are in it, beside the pack's own words", () => {
		const keywords = deLocale.keywordMap as Record<string, string>;
		expect(Object.prototype.hasOwnProperty.call(keywords, "between")).toBe(true);
		for (const word of PROTOTYPE_WORDS) {
			expect({ word, own: Object.prototype.hasOwnProperty.call(keywords, word) }).toEqual({ word, own: false });
		}
	});
});

describe("adversarial", () => {
	test("security: prototype words as the count or the amount, under de-DE", () => {
		const engine = engineFor("de-DE");
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`split €100 between ${word}`, { engine });
				expectHonestLine(`split ${word} between 3`, { engine });
			}
		});
	});

	test("security: look-alike and markup-shaped text, under de-DE", () => {
		const engine = engineFor("de-DE");
		for (const line of fill("split €100 between X", TEXT_EDGES)) expectHonestLine(line, { engine });
	});

	test("realistic: the amount from the line above, through both passes, under de-DE", () => {
		const text = "rechnung = 100 €\nsplit rechnung between 3";
		const batch = engineFor("de-DE").parseDocument(text).lines.map((l) => (l.result ? formatValue(l.result) : String(l.error)));
		const incremental = evaluateDocument(engineFor("de-DE"), text).lines.map((l) => (l.result ? formatValue(l.result) : String(l.error)));
		expect(batch[1]).toBe("= €33.33 each, with 1 share paying €33.34");
		expect(incremental).toEqual(batch);
	});

	test("edge: numeric edges as the count, under de-DE", () => {
		const engine = engineFor("de-DE");
		for (const line of fill("split €100 between X", NUMERIC_EDGES)) expectHonestLine(line, { engine, allowNaN: true });
	});
});
