import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, expectPrototypeUntouched } from "@tools/adversarial";
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
 * Found gap: the functions and operators guide
 * (`docs/src/content/docs/packages/functions-and-operators.md`) documents a
 * plugin function that returns a promise, which is accurate, but named
 * `createQueryResolver` only in passing, so an author writing a live lookup was
 * not told when the helper is the better tool. The page now has a section,
 * "When a live lookup wants `createQueryResolver`", that says what the helper
 * adds (a cache that goes stale, one fetch shared between lines, refetching and
 * a failure cooldown, cancellation and a timeout), names the boundary (the query
 * must be quoted in the line) and links to the async data source guide's short
 * path.
 *
 * This spec reads the section and its link, and tests each claim it makes on a
 * package built the way the short path builds one.
 */

const DOCS = path.resolve(__dirname, "../../../../docs/src/content/docs");
const PAGE = path.join(DOCS, "packages/functions-and-operators.md");
const GUIDE = path.join(DOCS, "guide/async-data-sources.md");
const HEADING = "### When a live lookup wants `createQueryResolver`";

/** The new section, from its heading to the next heading. */
function section(): string {
	const page = fs.readFileSync(PAGE, "utf8");
	const start = page.indexOf(HEADING);
	if (start < 0) return "";
	const rest = page.slice(start + HEADING.length);
	const end = rest.search(/\n#{2,3} /);
	return end < 0 ? rest : rest.slice(0, end);
}

/** A heading's anchor as Starlight writes it: lower case, code marks and punctuation dropped, spaces as hyphens. */
function anchorOf(heading: string): string {
	return heading.toLowerCase().replace(/[`:()]/g, "").trim().replace(/\s+/g, "-");
}

class RainfallParselet implements PrefixParselet {
	readonly category = "Rainfall";
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");
		builder.emitPluginCall("rainfall", 1);
	}
}

/** A live lookup on the short path, with the options the section names. */
function rainfallPackage(fetchRain: (place: string, signal: AbortSignal) => Promise<number>, options: { timeoutMs?: number; failureCooldownMs?: number } = {}): IEnginePackage {
	const { resolver, pluginFunction } = createQueryResolver({
		namespace: "rainguide",
		pluginFunctionIndex: pluginFunctionIndexFor("rainguide:rainfall"),
		fetchQuery: async (place, signal) => uomValue(await fetchRain(place, signal), "mm"),
		...options,
	});
	return {
		name: "rainguide",
		engineVersion: "^2.0.0",
		callFusions: { rainfall: "RAINFALL_CALL" },
		prefixParselets: { RAINFALL_CALL: new RainfallParselet() },
		pluginFunctions: { rainfall: pluginFunction },
		asyncResolvers: [resolver],
		tokenCategories: { RAINFALL_CALL: "function" },
	};
}

describe("the page", () => {
	test("has the section, under the promise-returning handler it qualifies", () => {
		const page = fs.readFileSync(PAGE, "utf8");
		const at = page.indexOf(HEADING);
		expect(at).toBeGreaterThan(page.indexOf("A handler may return a `Promise<Value>`"));
		expect(at).toBeLessThan(page.indexOf("### Reading other lines"));
	});

	test("says when to prefer the helper: cache, share, refetch, cancel, and the boundary", () => {
		const body = section();
		for (const word of ["staleTimeMs", "maxConcurrent", "refetchIntervalMs", "failureCooldownMs", "timeoutMs", "signal", "solve-engine/resolvers"]) {
			expect(body).toContain(word);
		}
		expect(body).toMatch(/The boundary:/);
		expect(body).not.toMatch(/—/);
	});

	test("links to the short path, and the anchor is one the guide has", () => {
		const link = /\(\/guide\/async-data-sources\/#([a-z0-9-]+)\)/.exec(section());
		expect(link?.[1]).toBe("the-short-path-createqueryresolver");
		const headings = fs.readFileSync(GUIDE, "utf8").split("\n").filter((l) => l.startsWith("## ")).map((l) => anchorOf(l.slice(3)));
		expect(headings).toContain(link?.[1]);
	});
});

describe("what the section says the helper does", () => {
	test("caches: the same query asked again is answered from the cache, not fetched again", async () => {
		let calls = 0;
		const engine = createTestEngine([rainfallPackage(async () => { calls++; return 4; })]);
		await expectExpression(engine, 'rainfall("Oslo")').toResolveTo(4, "mm");
		await expectExpression(engine, 'rainfall("Oslo")').toResolveTo(4, "mm");
		expect(calls).toBe(1);
	});

	test("shares one fetch between lines", async () => {
		let calls = 0;
		const engine = createTestEngine([rainfallPackage(async () => { calls++; return 3; })]);
		const doc = await expectDocument(engine, 'rainfall("Oslo")\nrainfall("Oslo") * 2\nrainfall("Oslo") + 1 mm');
		doc.line(1).toEqual(3, "mm");
		doc.line(2).toEqual(6, "mm");
		doc.line(3).toEqual(4, "mm");
		expect(calls).toBe(1);
	});

	test("cancels: the signal fires at the timeout, and the line settles to a refusal rather than staying pending", async () => {
		let seen: AbortSignal | undefined;
		const engine = createTestEngine([rainfallPackage((_place, signal) => { seen = signal; return new Promise<number>(() => undefined); }, { timeoutMs: 20 })]);
		expectExpression(engine, 'rainfall("Oslo")').toBePending();
		(await expectExpression(engine, 'rainfall("Oslo")').settled()).toFailWith("RAINGUIDE_QUERY_FAILED");
		expect(seen?.aborted).toBe(true);
	});

	test("retries a failure once its cooldown has passed", async () => {
		let calls = 0;
		const engine = createTestEngine([rainfallPackage(async () => { calls++; if (calls === 1) throw new Error("down"); return 7; }, { failureCooldownMs: 200 })]);
		(await expectExpression(engine, 'rainfall("Oslo")').settled()).toFailWith("RAINGUIDE_QUERY_FAILED");
		// Within the cooldown the failure is kept, and the service is not asked again.
		expectExpression(engine, 'rainfall("Oslo")').toFailWith("RAINGUIDE_QUERY_FAILED");
		expect(calls).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 300));
		await expectExpression(engine, 'rainfall("Oslo")').toResolveTo(7, "mm");
		expect(calls).toBe(2);
	});

	test("the boundary: a place held in a variable is not preflighted, and the service is never asked", async () => {
		let calls = 0;
		const engine = createTestEngine([rainfallPackage(async () => { calls++; return 1; })]);
		const doc = await expectDocument(engine, ':place = "Oslo"\nrainfall(place)');
		doc.line(2).toFailWith("RAINGUIDE_NOT_PREFLIGHTED");
		expect(calls).toBe(0);
	});
});

describe("adversarial", () => {
	test("security: prototype words and markup as the query reach the fetch as text, and Object.prototype is unchanged", async () => {
		const asked: string[] = [];
		const engine = createTestEngine([rainfallPackage(async (place) => { asked.push(place); return 1; })]);
		const places = [...PROTOTYPE_WORDS, "<img src=x onerror=alert(1)>", "'; DROP TABLE rain; --", "a".repeat(300)];
		expectPrototypeUntouched(() => {
			for (const place of places) expectExpression(engine, `rainfall("${place}")`);
		});
		for (const place of places) {
			const settled = await expectExpression(engine, `rainfall("${place}")`).settled();
			expect(settled.value.type).not.toBe(ValueType.Pending);
		}
		expect([...asked].sort()).toEqual([...places].sort());
	});

	test("realistic: a fetch that answers NaN, a typo in the call word, and the same query in two engines", async () => {
		const nan = createTestEngine([rainfallPackage(async () => Number.NaN)]);
		const settled = await expectExpression(nan, 'rainfall("Oslo")').settled();
		expect(settled.value.type).not.toBe(ValueType.Pending);
		expectExpression(createTestEngine([rainfallPackage(async () => 1)]), 'rainfal("Oslo")').toBeError();
		let calls = 0;
		const fetchRain = async (): Promise<number> => { calls++; return 2; };
		await expectExpression(createTestEngine([rainfallPackage(fetchRain)]), 'rainfall("Oslo")').toResolveTo(2, "mm");
		await expectExpression(createTestEngine([rainfallPackage(fetchRain)]), 'rainfall("Oslo")').toResolveTo(2, "mm");
		expect(calls).toBe(2);
	});

	test("edge: numbers, an empty query and text edges as the argument are answered, never thrown on", async () => {
		const engine = createTestEngine([rainfallPackage(async () => 2)]);
		for (const arg of [...NUMERIC_EDGES, '""', '" "']) {
			expect(() => engine.evaluateExpression(`rainfall(${arg})`)).not.toThrow(TypeError);
		}
		for (const t of TEXT_EDGES) {
			expect(() => engine.evaluateExpression(`rainfall("${t.replace(/"/g, "")}")`)).not.toThrow(TypeError);
		}
		await engine.settle();
	});
});
