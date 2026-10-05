import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import type { Token } from "@solve-js/lexer/Token";
import { createQueryResolver } from "@solve-js/resolvers";
import { pluginFunctionIndexFor, uomValue, ValueType } from "@solve-js/vm";
import { createTestEngine, expectDocument, expectExpression } from "@solve-js/testing";

/**
 * Found bug: the live-values example on the testing guide
 * (`docs/src/content/docs/packages/testing-a-package.md`) built `tide("Dover")`
 * from a plugin function that returned a promise, after the package starter
 * and the async data source guide had moved to `createQueryResolver` from
 * `solve-engine/resolvers`, which starts the fetch before the line runs, keeps
 * the answer in the engine's cache and bounds and times out the fetches. The
 * page now builds the package the starter's way, and states the failure code
 * the helper gives (`TIDES_QUERY_FAILED`) and the boundary (a port held in a
 * variable is `TIDES_NOT_PREFLIGHTED`).
 *
 * `PackageGuideSnippets.spec.ts` compiles and runs the page's fence; this spec
 * builds the same package and tests what the page says about it, and what it
 * does with hostile ports.
 */

const PAGE = path.resolve(__dirname, "../../../../docs/src/content/docs/packages/testing-a-package.md");

class TideParselet implements PrefixParselet {
	readonly category = "Tides";
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");
		builder.emitPluginCall("tide", 1);
	}
}

/** The page's package, word for word in what it registers. */
function createTidesPackage(fetchHeight: (port: string, signal: AbortSignal) => Promise<number>): IEnginePackage {
	const { resolver, pluginFunction } = createQueryResolver({
		namespace: "tides",
		pluginFunctionIndex: pluginFunctionIndexFor("tides:tide"),
		fetchQuery: async (port, signal) => uomValue(await fetchHeight(port, signal), "m"),
	});
	return {
		name: "tides",
		engineVersion: "^2.0.0",
		callFusions: { tide: "TIDE_CALL" },
		prefixParselets: { TIDE_CALL: new TideParselet() },
		pluginFunctions: { tide: pluginFunction },
		asyncResolvers: [resolver],
		tokenCategories: { TIDE_CALL: "function" },
	};
}

/** The page's live-values fence. */
function tidesFence(): string {
	const page = fs.readFileSync(PAGE, "utf8");
	const start = page.indexOf("## Live values");
	const fence = /```ts\n([\s\S]*?)```/.exec(page.slice(start));
	return fence?.[1] ?? "";
}

describe("the page", () => {
	test("builds the package with createQueryResolver, not a promise-returning plugin function", () => {
		const fence = tidesFence();
		expect(fence).toContain('import { createQueryResolver } from "solve-engine/resolvers";');
		expect(fence).toContain('pluginFunctionIndexFor("tides:tide")');
		expect(fence).toContain("asyncResolvers: [resolver]");
		expect(fence).toContain("pluginFunctions: { tide: pluginFunction }");
		expect(fence).not.toMatch(/tide:\s*async/);
		expect(fence).not.toMatch(/=>\s*Promise<Value>/);
	});

	test("names the code a failure is given and the boundary of a quoted port", () => {
		const page = fs.readFileSync(PAGE, "utf8");
		expect(page).toContain("TIDES_QUERY_FAILED");
		expect(page).toContain("TIDES_NOT_PREFLIGHTED");
	});
});

describe("what the page says the package does", () => {
	test("a quoted port is Pending, then resolves to the stub's height", async () => {
		const asked: string[] = [];
		const engine = createTestEngine([createTidesPackage(async (port) => { asked.push(port); return 4.2; })]);
		expectExpression(engine, 'tide("Dover")').toBePending();
		await expectExpression(engine, 'tide("Dover")').toResolveTo(4.2, "m");
		expect(asked).toEqual(["Dover"]);
	});

	test("a failed fetch settles to TIDES_QUERY_FAILED", async () => {
		const engine = createTestEngine([createTidesPackage(async () => { throw new Error("no signal"); })]);
		expectExpression(engine, 'tide("Dover")').toBePending();
		(await expectExpression(engine, 'tide("Dover")').settled()).toFailWith("TIDES_QUERY_FAILED");
	});

	test("a port held in a variable is TIDES_NOT_PREFLIGHTED, and the service is never asked", async () => {
		let calls = 0;
		const engine = createTestEngine([createTidesPackage(async () => { calls++; return 1; })]);
		const doc = await expectDocument(engine, ':port = "Dover"\ntide(port)');
		doc.line(2).toFailWith("TIDES_NOT_PREFLIGHTED");
		expect(calls).toBe(0);
	});

	test("one port asked on two lines is fetched once, and both lines settle", async () => {
		let calls = 0;
		const engine = createTestEngine([createTidesPackage(async () => { calls++; return 3; })]);
		const doc = await expectDocument(engine, 'tide("Dover")\ntide("Dover") * 2');
		doc.line(1).toEqual(3, "m");
		doc.line(2).toEqual(6, "m");
		expect(calls).toBe(1);
	});
});

describe("adversarial", () => {
	test("security: prototype words, markup and a long text as the port reach the stub as text, and Object.prototype is unchanged", async () => {
		const asked: string[] = [];
		const engine = createTestEngine([createTidesPackage(async (port) => { asked.push(port); return 1; })]);
		const ports = [...PROTOTYPE_WORDS, "<script>alert(1)</script>", "'; DROP TABLE tides; --", "../../etc/passwd", "a".repeat(500)];
		await Promise.resolve();
		expectPrototypeUntouched(() => {
			for (const port of ports) expectExpression(engine, `tide("${port}")`);
		});
		for (const port of ports) {
			const settled = await expectExpression(engine, `tide("${port}")`).settled();
			expect(settled.value.type).not.toBe(ValueType.Pending);
		}
		expect([...asked].sort()).toEqual([...ports].sort());
		expect(Object.prototype.hasOwnProperty.call(Object.prototype, "tides")).toBe(false);
	});

	test("security: a long line of calls is bounded by the line limits, not by the stub", () => {
		const engine = createTestEngine([createTidesPackage(async () => 1)]);
		const many = Array.from({ length: 400 }, (_, i) => `tide("p${i}")`).join(" + ");
		expect(() => engine.evaluateExpression(many)).not.toThrow(TypeError);
		expect(() => engine.evaluateExpression(RESOURCE_PROBES.longText(5_000))).not.toThrow(TypeError);
	});

	test("realistic: a stub that answers something that is not a height, a stub that never answers, a typo", async () => {
		const nan = createTestEngine([createTidesPackage(async () => Number.NaN)]);
		const settled = await expectExpression(nan, 'tide("Dover")').settled();
		expect(settled.value.type).not.toBe(ValueType.Pending);
		const never = createTestEngine([createTidesPackage(() => new Promise<number>(() => undefined))]);
		await expect(expectExpression(never, 'tide("Dover")').toResolveTo(1, "m", { timeoutMs: 50 })).rejects.toThrow(/settle|Pending|pending/);
		expectExpression(createTestEngine([createTidesPackage(async () => 1)]), 'tides("Dover")').toBeError();
	});

	test("edge: a number, an empty port and text edges as the argument are answered, never thrown on", async () => {
		const engine = createTestEngine([createTidesPackage(async () => 2)]);
		for (const arg of [...NUMERIC_EDGES, '""', '" "']) {
			expect(() => engine.evaluateExpression(`tide(${arg})`)).not.toThrow(TypeError);
		}
		for (const text of TEXT_EDGES) {
			expect(() => engine.evaluateExpression(`tide("${text.replace(/"/g, "")}")`)).not.toThrow(TypeError);
		}
		await engine.settle();
	});
});
