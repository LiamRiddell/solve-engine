import { describe, expect, test } from "@jest/globals";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { ValueType } from "@solve-js/vm/Value";
import { enLocale, deLocale, frLocale, getLocale } from "@solve-js/constants/locales";
import { withEnglishKeywords } from "@solve-js/constants/locales/en";
import { builtinIndexFor, builtinNameToIndex } from "@solve-js/packages/function/parselets/FunctionCallParselet";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { newTrackedEngine } from "@tools/trackedEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";

/**
 * Issue #833: the German and French packs replaced the English keywords rather
 * than adding to them, so a German engine read no `sqrt`, `round`, `times`,
 * `of`, `true` or `if`, a French one converted no unit, and the German pack's
 * own function names (`wurzel`, `runden`) lexed as calls and were refused as
 * unknown functions. A zone conversion failed under `de` because the pack read
 * `in` as `TO` where the zone parselet asks for `IN`.
 *
 * A pack's keyword table is now English plus the pack's own words
 * (`withEnglishKeywords`), and a pack names the built-in each of its function
 * names runs (`ILocale.functionNames`, resolved by `builtinIndexFor`).
 */

/** What an engine in `locale` answers for `line`: the formatted answer without `= `, or `refused`. */
function answer(locale: string, line: string): string {
	const engine = newTrackedEngine({ locale, config: { network: { enabled: false } } });
	try {
		const value = engine.evaluateExpression(line);
		if (value.type === ValueType.Error) return "refused";
		return formatValue(value).replace(/^=\s*/, "");
	} catch (e) {
		if (e instanceof EngineError) return "refused";
		throw e;
	}
}

/** Every English built-in callable by name, with an argument list it accepts. */
const ENGLISH_CALLS: ReadonlyArray<readonly [string, string]> = [
	["sqrt(16)", "4"], ["abs(-3)", "3"], ["sin(0)", "0"], ["cos(0)", "1"], ["tan(0)", "0"], ["log10(100)", "2"],
	["ceil(7/2)", "4"], ["floor(7/2)", "3"], ["round(7/2)", "4"], ["min(3, 5)", "3"], ["max(3, 5)", "5"],
	["cbrt(27)", "3"], ["trunc(7/2)", "3"], ["sign(-4)", "-1"], ["gcd(12, 18)", "6"], ["lcm(4, 6)", "12"],
	["isprime(7)", "true"], ["hex(255)", "0xFF"], ["int(7/2)", "3"], ["fact(5)", "120"], ["exp(0)", "1"],
	["hypot(3, 4)", "5"], ["log2(8)", "3"], ["log10(1000)", "3"], ["pow(2, 10)", "1,024"], ["root(3, 8)", "2"],
];

describe("the issue's lines", () => {
	test.each([
		["de", "wurzel(16)", "4"],
		["de", "sqrt(16)", "4"],
		["de", "3pm Tokyo in Dubai", "10:00 AM"],
		["fr", "5 km in m", "5,000.00 m"],
		["fr", "5 km en m", "5,000.00 m"],
		["fr", "convertir 5 km en m", "5,000.00 m"],
		["fr", "sqrt(16)", "4"],
		["de", "runden(7/2)", "4"],
		["de", "aufrunden(7/2)", "4"],
		["de", "abrunden(7/2)", "3"],
		["de", "3 times 4", "12"],
		["de", "10% of 200", "20"],
		["de", "true", "true"],
		["de", "if 1 > 0 then 1 else 2", "1"],
	])("under %s, %s is %s", (locale, line, expected) => {
		expect(answer(locale, line)).toBe(expected);
	});
});

describe("every English built-in under each pack", () => {
	test.each(ENGLISH_CALLS.flatMap(([line, expected]) => ["en", "de", "fr"].map((locale) => [locale, line, expected] as const)))(
		"under %s, %s is %s",
		(locale, line, expected) => {
			expect(answer(locale, line)).toBe(expected);
		},
	);

	test.each(["de", "fr"])("under %s, every English keyword reads as English reads it, save the pack's own spellings", (locale) => {
		const pack = getLocale(locale);
		const clashes = Object.keys(enLocale.keywordMap).filter((word) => pack.keywordMap[word] !== enLocale.keywordMap[word]);
		// The one word a pack spells like an English keyword with another
		// meaning; the pack's reading is kept (see withEnglishKeywords).
		expect(clashes).toEqual(locale === "fr" ? ["multiplier"] : []);
	});
});

describe("each pack's own names", () => {
	test.each(Object.entries(deLocale.functionNames ?? {}))("de %s runs %s", (german, english) => {
		const engine = newTrackedEngine({ locale: "de" });
		const arg = english === "random" ? "" : "9";
		const a = engine.evaluateExpression(`${german}(${arg})`);
		const b = engine.evaluateExpression(`${english}(${arg})`);
		if (english === "random") expect(a.type).toBe(ValueType.Number);
		else expect(formatValue(a)).toBe(formatValue(b));
	});

	test.each(Object.entries(frLocale.functionNames ?? {}))("fr %s runs %s", (french, english) => {
		const engine = newTrackedEngine({ locale: "fr" });
		expect(formatValue(engine.evaluateExpression(`${french}(9)`))).toBe(formatValue(engine.evaluateExpression(`${english}(9)`)));
	});

	test("a pack's own name is no function under another pack or in English", () => {
		expect(answer("en", "wurzel(16)")).toBe("refused");
		expect(answer("fr", "wurzel(16)")).toBe("refused");
		expect(answer("en", "racine(16)")).toBe("refused");
		expect(answer("de", "racine(16)")).toBe("refused");
	});

	test("every pack function name is a FUNC word of its pack and names a real built-in", () => {
		for (const pack of [deLocale, frLocale]) {
			for (const [own, english] of Object.entries(pack.functionNames ?? {})) {
				expect(pack.keywordMap[own]).toBe("FUNC");
				expect(Object.prototype.hasOwnProperty.call(builtinNameToIndex, english)).toBe(true);
			}
		}
	});

	test("the pack's words still read: mal, von, fois, vrai, si", () => {
		expect(answer("de", "3 mal 4")).toBe("12");
		expect(answer("de", "10% von 200")).toBe("20");
		expect(answer("fr", "3 fois 4")).toBe("12");
		expect(answer("fr", "vrai et faux")).toBe("false");
		expect(answer("fr", "si 1 > 0 alors 1 sinon 2")).toBe("1");
	});
});

describe("a conversion and a zone conversion under each pack", () => {
	test.each(["en", "de", "fr"])("under %s", (locale) => {
		expect(answer(locale, "5 km to miles")).toBe("3.11 miles");
		expect(answer(locale, "5 km in miles")).toBe("3.11 miles");
		expect(answer(locale, "5 km into miles")).toBe("3.11 miles");
		expect(answer(locale, "3pm Tokyo in Dubai")).toBe("10:00 AM");
		expect(answer(locale, "3pm Tokyo in Mumbai")).toBe("11:30 AM");
	});

	test("the German convert word and the French one", () => {
		expect(answer("de", "konvertieren 5 km in miles")).toBe("3.11 miles");
		expect(answer("fr", "convertir 5 km en miles")).toBe("3.11 miles");
		// `en` is the French pack's word, not English's.
		expect(answer("en", "5 km en miles")).toBe("refused");
	});
});

// ── Unit tests of the parts ──────────────────────────────────────────────

describe("withEnglishKeywords", () => {
	test("adds a pack's words to English and changes neither argument", () => {
		const own = { mal: "STAR" };
		const merged = withEnglishKeywords(own);
		expect(merged.mal).toBe("STAR");
		expect(merged.times).toBe("STAR");
		expect(own).toEqual({ mal: "STAR" });
		expect(Object.prototype.hasOwnProperty.call(enLocale.keywordMap, "mal")).toBe(false);
	});

	test("the pack's meaning wins where it spells an English word", () => {
		expect(withEnglishKeywords({ in: "TO" }).in).toBe("TO");
		expect(withEnglishKeywords({}).in).toBe("IN");
	});

	test("an empty pack is English, and a prototype word is an own key or nothing", () => {
		expect(withEnglishKeywords({})).toEqual(enLocale.keywordMap);
		expectPrototypeUntouched(() => {
			const merged = withEnglishKeywords({ ["__proto__"]: "STAR", constructor: "PLUS" } as Record<string, string>);
			expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
			expect(merged.constructor).toBe("PLUS");
		});
	});
});

describe("builtinIndexFor", () => {
	test("an English name in any case, under any locale", () => {
		for (const locale of ["en", "de", "fr", "de-AT", "xx"]) {
			expect(builtinIndexFor("sqrt", locale)).toBe(0);
			expect(builtinIndexFor("SQRT", locale)).toBe(0);
		}
	});

	test("a pack's own name only under its pack", () => {
		expect(builtinIndexFor("wurzel", "de")).toBe(0);
		expect(builtinIndexFor("Wurzel", "de-CH")).toBe(0);
		expect(builtinIndexFor("aufrunden", "de")).toBe(builtinNameToIndex.ceil);
		expect(builtinIndexFor("wurzel", "fr")).toBeUndefined();
		expect(builtinIndexFor("wurzel", "en")).toBeUndefined();
		expect(builtinIndexFor("racine", "fr")).toBe(0);
	});

	test("an empty name, an unknown name and a prototype word reach nothing", () => {
		for (const locale of ["en", "de", "fr"]) {
			expect(builtinIndexFor("", locale)).toBeUndefined();
			expect(builtinIndexFor("nosuchfn", locale)).toBeUndefined();
			for (const word of PROTOTYPE_WORDS) expect(builtinIndexFor(word, locale)).toBeUndefined();
		}
	});

	test("a hostile locale tag reads as English", () => {
		expect(builtinIndexFor("wurzel", "__proto__")).toBeUndefined();
		expect(builtinIndexFor("sqrt", "x".repeat(100_000))).toBe(0);
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial: security", () => {
	test.each(["de", "fr"])("under %s, a prototype word as a call, a conversion target and a name is honest", (locale) => {
		const engine = newTrackedEngine({ locale });
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expectHonestLine(`${word}(16)`, { engine });
				expectHonestLine(`5 km in ${word}`, { engine });
				expectHonestLine(`5 km en ${word}`, { engine });
				expectHonestLine(word, { engine });
			}
		});
	});

	test.each(["de", "fr"])("under %s, the text edges beside a pack's call are read as text", (locale) => {
		const engine = newTrackedEngine({ locale });
		const call = locale === "de" ? "wurzel" : "racine";
		for (const text of TEXT_EDGES) {
			expectHonestLine(`${call}(16) ${text}`, { engine });
			expectHonestLine(`${text}${call}(16)`, { engine });
		}
	});

	test("a pack's name written with a zero-width space or in full width is not the function", () => {
		expect(answer("de", "wur​zel(16)")).toBe("refused");
		expect(answer("de", "ｗｕｒｚｅｌ(16)")).toBe("refused");
	});

	test("a deep nest of a pack's call is refused by name within its budget", () => {
		const engine = newTrackedEngine({ locale: "de" });
		const line = `${"wurzel(".repeat(2_000)}16${")".repeat(2_000)}`;
		const outcome = expectHonestLine(line, { engine, budgetMs: 5_000 });
		expect(outcome.kind === "thrown" || outcome.kind === "error").toBe(true);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo in a pack's name is refused, not read as a neighbour", () => {
		expect(answer("de", "wurzl(16)")).toBe("refused");
		expect(answer("fr", "racin(16)")).toBe("refused");
	});

	test("a pack's function over a value from the line above, through both passes", () => {
		const text = ["x = 81", "wurzel(x)", "runden(x / 2)", "sqrt(x) times 2", "5 km in miles"].join("\n");
		const show = (lines: ReturnType<typeof evaluateDocument>["lines"]) => lines.map((l) => (l.result ? formatValue(l.result) : l.error));
		const batch = show(newTrackedEngine({ locale: "de" }).parseDocument(text).lines);
		const incremental = show(evaluateDocument(newTrackedEngine({ locale: "de" }), text).lines);
		expect(batch).toEqual(["= 81", "= 9", "= 41", "= 18", "= 3.11 miles"]);
		expect(incremental).toEqual(batch);
	});

	test("a pack's function in a check, a what-if and an explanation", () => {
		const engine = newTrackedEngine({ locale: "de" });
		const check = engine.evaluateExpression("check wurzel(16) == 4");
		expect(formatValue(check)).toBe("= ✓");
		const scenario = engine.whatIf("x = 9\nwurzel(x)", { x: 16 });
		expect(formatValue(scenario.lines[1].result!)).toBe("= 4");
		const explained = engine.explainLine("wurzel(16)");
		expect(explained.result.toNumber()).toBe(4);
		expect(explained.steps.length).toBeGreaterThan(0);
	});

	test("the wrong number of arguments to a pack's name is refused by name", () => {
		expect(() => newTrackedEngine({ locale: "de" }).evaluateExpression("wurzel()")).toThrow(/takes 1 argument/);
		expect(() => newTrackedEngine({ locale: "de" }).evaluateExpression("wurzel(1; 2)")).toThrow(/takes 1 argument/);
	});

	test("a keyword a pack now reads is refused as a variable name, honestly", () => {
		for (const [locale, text] of [["de", ":times = 3\ntimes + 1"], ["fr", ":en = 3\nen + 1"], ["de", ":wurzel = 3\nwurzel"]] as const) {
			const lines = newTrackedEngine({ locale }).parseDocument(text).lines;
			for (const line of lines) expect(line.error ?? "").not.toMatch(/\[object |is not a function|Cannot read/);
		}
	});

	test("a snapshot of a German engine restores and answers the pack's calls", () => {
		const engine = newTrackedEngine({ locale: "de" });
		engine.parseDocument("x = wurzel(16)\nx * 2");
		const restored = ExpressionEngine.fromJSON(engine.toJSON(), { locale: "de", packages: BUILTIN_PACKAGES });
		try {
			expect(restored.evaluateExpression("wurzel(x)").toNumber()).toBe(2);
		} finally {
			restored.clear();
		}
	});
});

describe("adversarial: edge cases", () => {
	test.each(fill("wurzel(X)", NUMERIC_EDGES))("de %s is honest", (line) => {
		expectHonestLine(line, { engine: newTrackedEngine({ locale: "de" }), allowNaN: line.includes("0/0") });
	});

	test.each(fill("racine(X)", NUMERIC_EDGES))("fr %s is honest", (line) => {
		expectHonestLine(line, { engine: newTrackedEngine({ locale: "fr" }), allowNaN: line.includes("0/0") });
	});

	test("negative zero, a negative and a decimal comma through the pack's names", () => {
		expect(answer("de", "wurzel(-0)")).toBe("0");
		expect(answer("de", "wurzel(-4)")).toBe("2i");
		expect(answer("de", "runden(2,5)")).toBe("3");
		expect(answer("de", "abrunden(-2,5)")).toBe("-3");
		expect(answer("fr", "plafond(2,5)")).toBe("3");
		expect(answer("fr", "plancher(-0,5)")).toBe("-1");
	});

	test("a region tag reads its language's pack", () => {
		expect(answer("de-AT", "wurzel(16)")).toBe("4");
		expect(answer("fr-CA", "5 km en m")).toBe("5,000.00 m");
		expect(answer("DE_de", "3 times 4")).toBe("12");
	});
});
