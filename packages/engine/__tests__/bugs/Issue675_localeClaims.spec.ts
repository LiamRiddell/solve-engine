import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";
import * as constants from "@solve-js/constants";

/**
 * Issue #675: five pages described locale behaviour the engine does not have.
 * The pages now say what it does; these pin each corrected claim, so a page that
 * drifts from the engine again has a failing test beside it.
 */

function shown(engine: ReturnType<typeof newTrackedEngine>, line: string): string {
	try {
		return formatValue(engine.evaluateExpression(line));
	} catch (error) {
		return `throws: ${(error as Error).message}`;
	}
}

describe("the locale decides numbers and keywords, not the date order (embedding.md)", () => {
	test("an ambiguous date reads the same in every language", () => {
		for (const locale of ["en", "de", "fr"] as const) {
			expect(shown(newTrackedEngine({ locale }), "03/04/2026")).toBe("= Friday, April 3, 2026");
		}
	});

	test("config.date.inputOrder decides it, whatever the locale", () => {
		const engine = newTrackedEngine({ locale: "de", config: { date: { inputOrder: "MDY" } } });
		expect(shown(engine, "03/04/2026")).toBe("= Wednesday, March 4, 2026");
	});

	test("while the locale does decide how a number is grouped", () => {
		expect(shown(newTrackedEngine({ locale: "de" }), "1.000 + 1")).toBe("= 1,001");
		expect(shown(newTrackedEngine({ locale: "en" }), "1.000 + 1")).toBe("= 2");
	});
});

describe("formatValue never sees the engine (index.mdx)", () => {
	test("a German engine's answer formats in English by default", () => {
		const value = newTrackedEngine({ locale: "de" }).evaluateExpression("1.000 + 1");
		expect(formatValue(value)).toBe("= 1,001");
	});
});

describe("a typed line and pasted text do not read numbers the same way (pasted-text.md)", () => {
	test("pasted text under de reads a decimal comma", () => {
		expect(shown(newTrackedEngine({ locale: "de" }), 'numbers in "Kaffee 3,20, Mittag 12,50"')).toBe("= [3.20, 12.50]");
	});

	test("a typed line under de does not yet", () => {
		expect(shown(newTrackedEngine({ locale: "de" }), "3,20 + 12,50")).toMatch(/^throws: /);
	});
});

describe("solve-engine/constants holds configuration and the version (subpath-exports.md, installation.md)", () => {
	test("and no locales", () => {
		expect(Object.keys(constants).sort()).toEqual(["ConfigManager", "DEFAULT_CONFIG", "ENGINE_VERSION"]);
	});
});

describe("parseDocument ignores localeCode (types/ParsingResult.ts)", () => {
	test("an English engine asked for de still reads English numbers", () => {
		const result = newTrackedEngine({ locale: "en" }).parseDocument("1.000 + 1", { inputType: "markdown", localeCode: "de" });
		expect(formatValue(result.lines[0].result!)).toBe("= 2");
	});

	test("and a German engine asked for en still reads German ones", () => {
		const result = newTrackedEngine({ locale: "de" }).parseDocument("1.000 + 1", { inputType: "markdown", localeCode: "en" });
		expect(formatValue(result.lines[0].result!)).toBe("= 1,001");
	});
});
