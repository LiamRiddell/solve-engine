import { describe, expect, test } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { BUILTIN_PACKAGES, createCryptoPackage, createKnowledgePackage, createStocksPackage } from "@solve-js/packages/builtins";
import { SYNCHRONOUS_PLUGIN_FUNCTIONS, emitBuiltinPluginCall, pluginCallOptions } from "@solve-js/packages/SynchronousPluginFunctions";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { boolValue, colourValue, matrixValue, numberValue, stringValue, uomValue, type Value } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: `f(s) = upper(s)` was refused with "calls an async operation
 * (weather, stocks, currency, ...)", and so was every held expression (a
 * function body, a map or reduce transform, the expression of `solve`, a plot)
 * that called a text, hash, colour or dimensions function, or any other
 * built-in that answers at once.
 *
 * The cause: those packages emitted plain plugin calls, and every plain call
 * marks its program as one that may wait for data, which a held expression
 * refuses. Each built-in call site now emits through `emitBuiltinPluginCall`,
 * which marks the call synchronous when its name is on
 * `SYNCHRONOUS_PLUGIN_FUNCTIONS` (packages/SynchronousPluginFunctions.ts). A
 * lookup that waits for the network (weather, stocks, crypto, knowledge, a past
 * exchange rate) and a call that reads other lines (`prev`, `line 1`, tags,
 * table columns, goal seek, what-if) keep the mark and the refusal.
 */

/** A line's answer through evaluateExpression, or `CODE: message` for a refusal. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** A document line's answer, or `ERROR <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "ERROR no line";
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	if (line.result.isError()) return `ERROR ${String(line.result.errorMessage)}`;
	return formatValue(line.result).replace(/^=\s*/, "");
}

/** Each line of a document through both document passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** The refusal a function body that calls a waiting or document-reading function still gets. */
const BODY_REFUSED = /body calls an async operation/;

/** Every built-in package, the configurable ones unconfigured. */
const ALL_PACKAGES: readonly IEnginePackage[] = [...BUILTIN_PACKAGES, createStocksPackage(), createCryptoPackage(), createKnowledgePackage()];

/** Each registered built-in plugin function name, with its handler. */
const HANDLERS = new Map<string, (args: Value[]) => unknown>();
for (const pkg of ALL_PACKAGES) {
	for (const [name, handler] of Object.entries(pkg.pluginFunctions ?? {})) HANDLERS.set(name, (args) => handler(args));
}

/**
 * The built-in plugin functions that keep the mark, and why: each is either a
 * lookup that waits for data, or a call that reads other lines of the document.
 */
const KEPT: Readonly<Record<string, string>> = {
	historicalCurrency: "waits for a past exchange rate",
	weather: "waits for the weather service",
	goalseek: "re-runs another line",
	whatif: "re-runs other lines",
	sweep: "re-runs other lines",
	scenariodeclare: "reads the document's scenarios",
	scenarioread: "reads the document's scenarios",
	sum: "a tag total, over the document's tagged lines",
	average: "a tag average, over the document's tagged lines",
	count: "a tag count, over the document's tagged lines",
	tagBreakdown: "reads the document's tagged lines",
};

/** Whether a plugin name belongs to a package that reads other lines or waits, by name. */
function keptByPackage(name: string): boolean {
	return /^(TABLE_|prev$|lineRef$|sumRange$|averageRange$|columnTotal$|section|.*Above$|stock|crypto|knowledge)/.test(name);
}

/** Sample arguments a handler is called with: none, numbers, text, a colour, an amount, a list, and a mix. */
const SAMPLES: readonly Value[][] = [
	[],
	[numberValue(0)],
	[numberValue(1), numberValue(2)],
	[numberValue(-1), numberValue(0.5), numberValue(3)],
	[stringValue("")],
	[stringValue("hello world")],
	[stringValue("hello"), stringValue("l")],
	[stringValue("a"), numberValue(2)],
	[stringValue("192.168.1.0/24")],
	[stringValue("constructor")],
	[boolValue(true)],
	[colourValue({ r: 255, g: 0, b: 0, a: 1, format: "hex" })],
	[colourValue({ r: 0, g: 0, b: 255, a: 1, format: "hex" }), numberValue(10)],
	[uomValue(1920, "px"), uomValue(1080, "px")],
	[uomValue(4000, "px"), numberValue(300)],
	[uomValue(100, "km"), uomValue(50, "mpg"), numberValue(1.5)],
	[matrixValue(1, 3, [1, 2, 3])],
	[matrixValue(1, 3, [1, 2, 3]), matrixValue(1, 3, [2, 4, 7])],
	[numberValue(1), numberValue(2), numberValue(3), numberValue(4), numberValue(5), numberValue(6)],
	[stringValue("x"), stringValue("y"), stringValue("z"), numberValue(1), numberValue(2)],
];

/** Whether a value is a promise or any other thenable. */
function isThenable(value: unknown): boolean {
	return value !== null && (typeof value === "object" || typeof value === "function") && typeof (value as { then?: unknown }).then === "function";
}

/** Every `.ts` file under a directory. */
function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
		else if (path.endsWith(".ts")) out.push(path);
	}
	return out;
}

describe("the lines that exposed it", () => {
	test("a function body takes a text, hash, colour or dimensions function", () => {
		expect(outcome("f(s) = upper(s)")).toBe("f(s) defined");
		expect(outcome("f(x) = sha256(x)")).toBe("f(x) defined");
		expect(both(["shout(s) = upper(s)", 'shout("hello")', 'shout("ab") + "c"'])).toEqual(["shout(s) defined", "HELLO", "ABc"]);
		expect(both(["fingerprint(t) = sha256(t)", 'fingerprint("hello")'])).toEqual([
			"fingerprint(t) defined",
			"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		]);
		expect(both(["paler(c) = lighten(c, 10%)", "paler(#336699)"])).toEqual(["paler(c) defined", "#407fbf"]);
		expect(both(["printed(p) = p at 300 dpi in mm", "printed(4000px)"])).toEqual(["printed(p) defined", "338.67 mm"]);
		expect(both(["n(t) = length(t)", 'n("hello") * 2'])).toEqual(["n(t) defined", "10"]);
		expect(both(["k(x) = not x", "k(true)"])).toEqual(["k(x) defined", "false"]);
	});

	test("a map, a reduce and an aggregate take a synchronous call over numbers", () => {
		expect(outcome("map(erf(x), 0:2)")).toBe("[0, 0.84, 1.00]");
		expect(outcome("sum(erf(x), 0:2)")).toBe("1.84");
		expect(outcome("reduce(acc + erf(x), 0:2)")).toBe("1.84");
	});

	test("a list of text is still refused, for its cells, not for the call", () => {
		expect(outcome('map(upper(x), ["a","b"])')).toBe("MATRIX_CELL_NON_NUMERIC: Text cannot be a cell of a list: each cell holds one number.");
	});

	test("a call that waits or reads other lines is still refused in a function body and a map", () => {
		for (const line of ["f(x) = x + weather in London", "f(x) = x + prev", "f(x) = x + line 1"]) {
			expect(outcome(line)).toMatch(BODY_REFUSED);
		}
		expect(outcome("map(x + prev, 1:3)")).toBe("MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS: map/reduce transform expressions must be synchronous (no weather/stocks/currency calls).");
	});

	test("through the three entry points", () => {
		expect(formatValue(newTrackedEngine().evaluateLine(1, "f(s) = upper(s)"))).toBe("= f(s) defined");
		expect(formatValue(newTrackedEngine().evaluateLine(1, "map(erf(x), 0:2)"))).toBe("= [0, 0.84, 1.00]");
		expect(both(["shout(s) = upper(s)", 'check shout("a") == "A"'])).toEqual(["shout(s) defined", "✓"]);
	});
});

describe("every registered built-in plugin function is decided", () => {
	test("each one is on the synchronous list or kept for a stated reason, never both", () => {
		const undecided = [...HANDLERS.keys()].filter((name) => !SYNCHRONOUS_PLUGIN_FUNCTIONS.has(name) && !(name in KEPT) && !keptByPackage(name));
		expect(undecided).toEqual([]);
		const twice = [...SYNCHRONOUS_PLUGIN_FUNCTIONS].filter((name) => name in KEPT || keptByPackage(name));
		expect(twice).toEqual([]);
	});

	test("each name on the synchronous list is a registered plugin function", () => {
		expect([...SYNCHRONOUS_PLUGIN_FUNCTIONS].filter((name) => !HANDLERS.has(name))).toEqual([]);
	});

	test("each synchronous handler never returns a thenable, over every sample", () => {
		const thenables: string[] = [];
		for (const name of SYNCHRONOUS_PLUGIN_FUNCTIONS) {
			const handler = HANDLERS.get(name);
			if (!handler) continue;
			for (const args of SAMPLES) {
				let result: unknown;
				try {
					result = handler(args);
				} catch {
					// A refusal thrown at once is synchronous too.
					continue;
				}
				if (isThenable(result)) thenables.push(`${name}(${args.length})`);
			}
		}
		expect(thenables).toEqual([]);
	});

	test("each built-in call site emits through emitBuiltinPluginCall, so the list decides", () => {
		const root = join(__dirname, "..", "..", "src", "packages");
		const direct = sourceFiles(root)
			.filter((file) => !file.endsWith("SynchronousPluginFunctions.ts"))
			.filter((file) => /\.emitPluginCall\(/.test(readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
		expect(direct).toEqual([]);
	});
});

describe("the parts: pluginCallOptions", () => {
	test("ordinary: a synchronous name, and a name that waits", () => {
		expect(pluginCallOptions("textUpper")).toEqual({ synchronous: true });
		expect(pluginCallOptions("hashSha256")).toEqual({ synchronous: true });
		expect(pluginCallOptions("aspectRatio")).toEqual({ synchronous: true });
		expect(pluginCallOptions("weather")).toEqual({});
		expect(pluginCallOptions("lineRef")).toEqual({});
	});

	test("boundary: the empty name, a different case, a name with spaces", () => {
		expect(pluginCallOptions("")).toEqual({});
		expect(pluginCallOptions("TEXTUPPER")).toEqual({});
		expect(pluginCallOptions(" textUpper")).toEqual({});
	});

	test("hostile: a prototype word is no synchronous name, and the options cannot be changed", () => {
		for (const word of PROTOTYPE_WORDS) expect(pluginCallOptions(word)).toEqual({});
		expect(Object.isFrozen(pluginCallOptions("textUpper"))).toBe(true);
		expect(Object.isFrozen(pluginCallOptions("weather"))).toBe(true);
	});
});

describe("the parts: emitBuiltinPluginCall", () => {
	/** A builder that knows a synchronous name, a waiting one, and one past the narrow index. */
	function builder(): BytecodeBuilder {
		return new BytecodeBuilder(new Map([["textUpper", 3], ["weather", 4], ["hashSha256", 300]]));
	}

	test("ordinary: a synchronous name leaves the program unmarked, a waiting one marks it", () => {
		const sync = builder();
		emitBuiltinPluginCall(sync, "textUpper", 1);
		const program = sync.build();
		expect(Array.from(program.opcodes)).toEqual([OpCode.CALL_PLUGIN, 3, 1]);
		expect(program.hasAsync).toBe(false);
		const wait = builder();
		emitBuiltinPluginCall(wait, "weather", 1);
		expect(wait.build().hasAsync).toBe(true);
	});

	test("boundary: a waiting call before a synchronous one still counts, and the wide form is covered", () => {
		const b = builder();
		emitBuiltinPluginCall(b, "weather", 1);
		emitBuiltinPluginCall(b, "textUpper", 1);
		expect(b.build().hasAsync).toBe(true);
		const wide = builder();
		emitBuiltinPluginCall(wide, "hashSha256", 1);
		expect(wide.build().hasAsync).toBe(false);
	});

	test("hostile: an unknown or prototype name is refused by name and marks nothing", () => {
		const b = builder();
		for (const name of ["missing", ...PROTOTYPE_WORDS]) {
			expect(() => emitBuiltinPluginCall(b, name, 1)).toThrow(/No registered plugin function/);
		}
		expect(b.build().hasAsync).toBe(false);
	});
});

describe("adversarial: security", () => {
	test("a prototype word as the text a function body works on is text, and touches no prototype", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(both(["shout(s) = upper(s)", `shout("${word}")`])).toEqual(["shout(s) defined", word.toUpperCase()]);
				expectHonestDocument(`shout(s) = upper(s)\nshout(${word})`);
			}
		});
	});

	test("a long text, a huge range and many calls stay within their budget", () => {
		expectHonestDocument(`shout(s) = upper(s)\nlength(shout(${RESOURCE_PROBES.longText(50_000)}))`, { budgetMs: 10_000 });
		expectHonestLine("map(erf(x), 0:9999999)", { budgetMs: 10_000 });
		expectHonestDocument(RESOURCE_PROBES.manyLines(300, 'length(upper("abc"))'), { budgetMs: 10_000 });
	});

	test("markup-shaped and look-alike text is read as text", () => {
		for (const edge of TEXT_EDGES) {
			const text = JSON.stringify(edge);
			expectHonestDocument(`shout(s) = upper(s)\nshout(${text})`);
		}
		expect(both(["shout(s) = upper(s)", 'shout("<script>alert(1)</script>")'])).toEqual(["shout(s) defined", "<SCRIPT>ALERT(1)</SCRIPT>"]);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a function calling another, a value from the line above, an edit", () => {
		expect(both(["shout(s) = upper(s)", "loud(s) = shout(s) + \"!\"", 'name = "ada"', "loud(name)"])).toEqual([
			"shout(s) defined",
			"loud(s) defined",
			"ada",
			"ADA!",
		]);
		expect(both(["shout(s) = lower(s)", 'shout("ABC")'])).toEqual(["shout(s) defined", "abc"]);
	});

	test("a typo in the body is refused by name, and a wrong kind of argument is refused when called", () => {
		expect(outcome("f(s) = uper(s)")).toBe("f(s) defined");
		expect(both(["f(s) = uper(s)", 'f("a")'])[1]).toMatch(/^ERROR /);
		expectHonestDocument("fingerprint(t) = sha256(t)\nfingerprint(5 kg)");
		expectHonestDocument("paler(c) = lighten(c, 10%)\npaler(\"red\")");
	});

	test("a synchronous call beside a waiting one on the same body is still refused", () => {
		expect(outcome('f(x) = upper("a") + weather in London')).toMatch(BODY_REFUSED);
	});
});

describe("adversarial: edge cases", () => {
	test("the empty text, a blank line and CRLF", () => {
		expect(both(["shout(s) = upper(s)", 'shout("")'])).toEqual(["shout(s) defined", ""]);
		expectHonestDocument('shout(s) = upper(s)\r\n\r\nshout("a")\r\n');
	});

	test("each numeric edge through a synchronous call in a body and a map", () => {
		for (const line of fill("e(X)", NUMERIC_EDGES)) expectHonestDocument(`e(x) = erf(x)\n${line}`);
		for (const line of fill("map(erf(x), [X])", NUMERIC_EDGES)) expectHonestLine(line);
	});
});
