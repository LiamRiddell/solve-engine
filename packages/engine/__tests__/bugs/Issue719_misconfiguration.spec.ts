import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { createEngine } from "@solve-js/api/createEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { DEFAULT_CONFIG } from "@solve-js/constants/Configuration";
import { ENGINE_OPTION_KEYS, OPTIONAL_SETTINGS, unknownOptionWarnings } from "@solve-js/engine/OptionChecks";
import * as fs from "fs";
import * as path from "path";
import { FAST_PATH_PREFIX_TOKENS, isFastPathToken } from "@solve-js/parser/BindingPower";
import { expectPackage, ExpectationError } from "@solve-js/testing";
import { OpCode } from "@solve-js/parser/OpCode";
import { numberValue } from "@solve-js/vm/Value";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { PrefixParselet } from "@solve-js/parser/Parselet";

/**
 * Issue #719: mistakes the engine could see when it was built were accepted
 * without a word: an option or config section it does not have, a package with
 * no name, a parselet on a token the parser reads itself, a keyword whose token
 * no parselet reads, a plugin call to a function nobody declares.
 */

function warningsOf(build: () => unknown): string[] {
	const warnings: string[] = [];
	const warn = console.warn;
	console.warn = (message: string) => warnings.push(message);
	try {
		build();
	} finally {
		console.warn = warn;
	}
	return warnings;
}

const doubleParselet: PrefixParselet = {
	category: "Doubler",
	parse(parser, _token, builder) {
		parser.parseExpression(60, builder);
		builder.emitPluginCall("double", 1);
	},
};
const seven: PrefixParselet = {
	category: "Hijack",
	parse(_parser, _token, builder) {
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(7);
	},
};

describe("an option, section or setting the engine does not have is named", () => {
	test("network at the top level belongs under config, and live data stays as configured", () => {
		let engine!: ExpressionEngine;
		const warnings = warningsOf(() => { engine = createEngine({ network: { enabled: false } } as never); });
		expect(warnings).toEqual(['[ExpressionEngine] "network" is not an engine option, so it is ignored: it is a config section, and belongs under `config`, as in { config: { network: { ... } } }.']);
		expect(engine.getConfig().network.enabled).toBe(true);
	});

	test("a misspelt section and a misspelt setting name the nearest real one", () => {
		expect(warningsOf(() => createEngine({ config: { validaton: { maxExpressionLength: 5 } } } as never)))
			.toEqual(['[ExpressionEngine] "config.validaton" is not a config section, so it is ignored. Did you mean "validation"?']);
		expect(warningsOf(() => createEngine({ config: { validation: { maxExpresionLength: 5 } } } as never)))
			.toEqual(['[ExpressionEngine] "config.validation.maxExpresionLength" is not a setting, so it is ignored. Did you mean "maxExpressionLength"?']);
	});

	test("seed is not an option; it belongs under random", () => {
		expect(warningsOf(() => createEngine({ seed: 42 } as never)))
			.toEqual(['[ExpressionEngine] "seed" is not an engine option, so it is ignored: it belongs under `random: { seed }`.']);
	});

	test("every real option and setting passes without a word", () => {
		const config = Object.fromEntries(Object.entries(DEFAULT_CONFIG).map(([section, settings]) => [section, { ...settings }]));
		expect(unknownOptionWarnings({ locale: "en", packages: [], config, diagnostics: false, warmup: false, random: { seed: 1 }, strict: false, onPackageError: () => {} })).toEqual([]);
		expect(warningsOf(() => createEngine({ locale: "en", config: { vm: { maxInstructions: 1000 } } }))).toEqual([]);
	});

	test("a setting the defaults leave unset is still a setting", () => {
		expect(unknownOptionWarnings({ config: { date: { holidays: ["2026-12-25"], inputLocale: "en-GB" } } })).toEqual([]);
		expect(warningsOf(() => createEngine({ config: { date: { holidays: ["2026-12-25"], inputLocale: "en-GB" } } }))).toEqual([]);
	});

	test("every optional setting in Configuration.ts is listed, so a new one cannot be reported as unknown", () => {
		// The interface each section is typed by, read from EngineConfig itself.
		const source = fs.readFileSync(path.join(__dirname, "../../src/constants/Configuration.ts"), "utf8");
		const engineConfig = /export interface EngineConfig \{([\s\S]*?)\n\}/.exec(source)![1];
		const sections = [...engineConfig.matchAll(/readonly (\w+): (\w+);/g)].map(([, section, iface]) => ({ section, iface }));
		expect(sections.length).toBeGreaterThan(5);
		const missing: string[] = [];
		const found: string[] = [];
		for (const { section, iface } of sections) {
			const body = new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? "";
			for (const [, setting] of body.matchAll(/^ {2}readonly (\w+)\?:/gm)) {
				found.push(`${section}.${setting}`);
				if (!(OPTIONAL_SETTINGS[section] ?? []).includes(setting)) missing.push(`${section}.${setting}`);
			}
		}
		// The scan reads what it should: an empty result must not pass by finding nothing.
		expect(found).toEqual(expect.arrayContaining(["date.inputLocale", "date.holidays"]));
		expect(missing).toEqual([]);
	});

	test("each option key one letter away names the real one", () => {
		for (const key of ENGINE_OPTION_KEYS.filter((k) => k.length >= 4)) {
			const typos = [key.slice(0, -1), `${key}s`, key.slice(0, 1) + key.slice(2)];
			for (const typo of typos) {
				if (ENGINE_OPTION_KEYS.includes(typo)) continue;
				const [warning] = unknownOptionWarnings({ [typo]: 1 });
				expect([typo, warning]).toEqual([typo, expect.stringContaining(`"${key}"`)]);
			}
		}
	});

	test("each setting one letter away names the real one", () => {
		for (const [section, settings] of Object.entries(DEFAULT_CONFIG)) {
			for (const setting of Object.keys(settings as object).filter((s) => s.length >= 6)) {
				const typo = setting.slice(0, -1);
				const [warning] = unknownOptionWarnings({ config: { [section]: { [typo]: 1 } } });
				expect([typo, warning]).toEqual([typo, expect.stringContaining(`"${setting}"`)]);
			}
		}
	});

	test("ENGINE_OPTION_KEYS matches the options the engine reads", () => {
		expect([...ENGINE_OPTION_KEYS].sort()).toEqual(["calendar", "config", "diagnostics", "locale", "onPackageError", "packages", "random", "strict", "warmup"]);
	});

	test("the warnings carry no em-dash", () => {
		for (const warning of unknownOptionWarnings({ network: {}, seed: 1, locle: "x", config: { validaton: {}, vm: { maxInstructons: 1 } } })) {
			expect(warning).not.toMatch(/—/);
		}
	});
});

describe("a package needs a name", () => {
	test.each([
		["an empty one", { name: "" }],
		["spaces", { name: "   " }],
		["none", {}],
		["a number", { name: 5 }],
	])("%s is refused at registration", (_how, pkg) => {
		expect(() => createEngine().registerPackage(pkg as never)).toThrow(expect.objectContaining({ code: "PACKAGE_NAME_MISSING" }));
	});

	test("two nameless packages no longer unregister each other: both are refused", () => {
		const seen: string[] = [];
		const engine = new ExpressionEngine({
			packages: [...BUILTIN_PACKAGES, { pluginFunctions: { a719: () => numberValue(1) } } as never, { pluginFunctions: { b719: () => numberValue(2) } } as never],
			onPackageError: (_pkg, error) => seen.push(error.code),
		});
		expect(seen).toEqual(["PACKAGE_NAME_MISSING", "PACKAGE_NAME_MISSING"]);
		expect(engine.getRegisteredPackages()).toHaveLength(BUILTIN_PACKAGES.length);
	});
});

describe("a parselet on a token the parser reads itself", () => {
	test("the warnings say the new parselet is the one that never runs", () => {
		let engine!: ExpressionEngine;
		const warnings = warningsOf(() => { engine = createEngine({ extraPackages: [{ name: "hijack", prefixParselets: { NUMBER: seven } }] }); });
		expect(engine.evaluateExpression("2 + 3").toNumber()).toBe(5);
		expect(warnings).toContainEqual(expect.stringContaining('"hijack"\'s parselet never runs'));
		expect(warnings).toContainEqual(expect.stringContaining('(category: "Hijack") will never run'));
		for (const warning of warnings) expect(warning).not.toMatch(/silently wins|—/);
		engine.unregisterPackage("hijack");
	});

	test("each fast-path prefix token really is read before the registry", () => {
		const samples: Record<string, string> = { NUMBER: "5", BIGINT: "5n", STRING: '"ab"', IDENT: "pi", LPAREN: "(4)", MINUS: "-4", PLUS: "+4" };
		for (const type of FAST_PATH_PREFIX_TOKENS) {
			const plain = createEngine();
			const hijacked = createEngine();
			warningsOf(() => hijacked.registerPackage({ name: `hijack-${type}`, prefixParselets: { [type]: seven } }));
			const sample = samples[type];
			expect([type, String(hijacked.evaluateExpression(sample).value)]).toEqual([type, String(plain.evaluateExpression(sample).value)]);
			hijacked.unregisterPackage(`hijack-${type}`);
		}
	});

	test("an overwrite off the fast path still says the new parselet replaces the old", () => {
		const warnings = warningsOf(() => createEngine({ extraPackages: [{ name: "replacer", prefixParselets: { SQRT_SIGN: seven }, tokenCategories: {} }] }).unregisterPackage("replacer"));
		expect(warnings.some((w) => w.includes("replaces it, so the previous one is now unreachable"))).toBe(true);
		expect(isFastPathToken("SQRT_SIGN", "prefix")).toBe(false);
	});
});

describe("expectPackage(...).toBeWellFormed()", () => {
	function problemsOf(pkg: IEnginePackage): string {
		try {
			expectPackage(pkg).toBeWellFormed();
			return "";
		} catch (e) {
			expect(e).toBeInstanceOf(ExpectationError);
			return (e as Error).message;
		}
	}

	test("a well-formed package passes", () => {
		expect(problemsOf({
			name: "doubler-ok",
			lexerVocabulary: { keywords: { twiceok: "TWICEOK_KW" } },
			prefixParselets: { TWICEOK_KW: doubleParselet },
			pluginFunctions: { double: (args) => numberValue(args[0].toNumber() * 2) },
			tokenCategories: { TWICEOK_KW: "function" },
		})).toBe("");
	});

	test("a keyword's token keyed under another name beside its parselet", () => {
		const message = problemsOf({
			name: "doubler-a",
			lexerVocabulary: { keywords: { twicea: "DOUBLE_KW" } },
			prefixParselets: { DOUBLE: doubleParselet },
			pluginFunctions: { double: (args) => numberValue(args[0].toNumber() * 2) },
			tokenCategories: { DOUBLE_KW: "function", DOUBLE: "function" },
		});
		expect(message).toContain('the keyword "twicea" makes the token "DOUBLE_KW", which no parselet reads, while the parselet for "DOUBLE" reads a token nothing in the package makes');
	});

	test("a plugin call to a function the package does not declare", () => {
		const message = problemsOf({
			name: "doubler-b",
			lexerVocabulary: { keywords: { twiceb: "TWICEB_KW" } },
			prefixParselets: { TWICEB_KW: doubleParselet },
			pluginFunctions: { dubble: (args) => numberValue(args[0].toNumber() * 2) },
			tokenCategories: { TWICEB_KW: "function" },
		});
		expect(message).toContain('calls the plugin function "double", which pluginFunctions does not declare');
	});

	test("a token of its own with no category", () => {
		const message = problemsOf({
			name: "doubler-c",
			lexerVocabulary: { keywords: { twicec: "TWICEC_KW" } },
			prefixParselets: { TWICEC_KW: doubleParselet },
			pluginFunctions: { double: (args) => numberValue(args[0].toNumber() * 2) },
		});
		expect(message).toContain('its token "TWICEC_KW" has no tokenCategories entry');
	});

	test("each fast-path token claimed in turn", () => {
		for (const type of FAST_PATH_PREFIX_TOKENS) {
			expect(problemsOf({ name: `fast-${type}`, prefixParselets: { [type]: seven } })).toContain(`its prefix parselet for "${type}" never runs`);
		}
		for (const type of ["PLUS", "STAR", "CARET", "PERCENT"]) {
			expect(problemsOf({ name: `fast-infix-${type}`, infixParselets: { [type]: { category: "X", bindingPower: 10, parse() {} } } })).toContain(`its infix parselet for "${type}" never runs`);
		}
	});

	test("no name, and a package that does not register, reported with everything else", () => {
		expect(problemsOf({ name: "" } as IEnginePackage)).toContain("it has no name");
		expect(problemsOf({ name: "old-719", engineVersion: "^1.0.0" })).toContain("it does not register");
	});

	test("every built-in package is well formed but for the fast-path parselets it keeps for introspection", () => {
		for (const pkg of BUILTIN_PACKAGES) {
			const rest = problemsOf(pkg).split("\n").slice(1).filter((line) => !line.includes("never runs: the parser reads that token itself"));
			expect([pkg.name, rest]).toEqual([pkg.name, []]);
		}
	});
});
