import { describe, expect, test } from "@jest/globals";
import { fencesIn, instrumentFence, pageProgram, parsesCleanly, statedResult, statedThrow, type TsFence } from "@tools/tsFences";

/**
 * Unit tests of `tools/tsFences.ts`, the helpers `GuideExamples.spec.ts` runs
 * the guides' TypeScript examples with (#779): ordinary, boundary and hostile
 * arguments for each.
 */

/** Runs a page program with no package imports, returning what each assertion recorded. */
async function runProgram(page: readonly TsFence[], target: number): Promise<unknown[]> {
	const { js } = pageProgram(page, target);
	const seen: unknown[] = [];
	const module = { exports: {} as { __run?: () => Promise<void> } };
	const refuse = (specifier: string) => {
		throw new Error(`no import of ${specifier} here`);
	};
	new Function("require", "module", "exports", "__check", "__default", js)(
		refuse,
		module,
		module.exports,
		(index: number, value: unknown) => (seen[index] = value),
		(loaded: unknown) => loaded,
	);
	await module.exports.__run?.();
	return seen;
}

describe("fencesIn", () => {
	test("ts and typescript fences only, with their opening line, and a quoted fence skipped whole", () => {
		const page = ["# A", "```ts", "a();", "```", "````md", "```ts", "not a fence", "```", "````", '```typescript title="x"', "b();", "```", "~~~ts", "c();", "~~~"].join("\n");
		expect(fencesIn("p.md", page).map((fence) => [fence.line, fence.source])).toEqual([
			[2, "a();"],
			[10, "b();"],
			[13, "c();"],
		]);
	});

	test("CRLF, an unclosed fence and an empty page", () => {
		expect(fencesIn("p.md", "```ts\r\na();\r\n```\r\n").map((fence) => fence.source)).toEqual(["a();"]);
		expect(fencesIn("p.md", "```ts\na();")).toEqual([]);
		expect(fencesIn("p.md", "")).toEqual([]);
	});
});

describe("statedResult and statedThrow", () => {
	test("a comment that opens with a quoted string, unescaped, and nothing else", () => {
		expect(statedResult('formatValue(v); // "= 3,000.00 m"')).toBe("= 3,000.00 m");
		expect(statedResult('f(); // "= 2,006", a subtraction')).toBe("= 2,006");
		expect(statedResult('f(); // "a \\"quoted\\" word"')).toBe('a "quoted" word');
		expect(statedResult("f(); // every built-in package")).toBeNull();
		expect(statedResult('const s = "// \\"not a comment\\"";')).toBeNull();
		expect(statedResult("")).toBeNull();
	});

	test("the message after throws:, only in a comment", () => {
		expect(statedThrow('f(); // throws: Expected a value, but found "$"')).toBe('Expected a value, but found "$"');
		expect(statedThrow("f(); // throws")).toBeNull();
		expect(statedThrow('const s = "// throws: no";')).toBeNull();
		expect(statedThrow("")).toBeNull();
	});
});

describe("instrumentFence", () => {
	test("a stated statement records its value, across lines, and nothing else moves", () => {
		const { code, assertions } = instrumentFence('const a = 1;\nf({\n  x: 1,\n}); // "= 1"\ng(); // a remark');
		expect(code).toBe('const a = 1;\n__check(0, (f({\n  x: 1,\n}))); // "= 1"\ng(); // a remark');
		expect(assertions).toEqual([{ line: 4, expected: "= 1" }]);
		expect(instrumentFence("").assertions).toEqual([]);
	});

	test("a stated throw is caught and recorded", () => {
		const { code, assertions } = instrumentFence("f(); // throws: bad");
		expect(code).toContain("catch (__error) { __check(0, __error); }");
		expect(assertions).toEqual([{ line: 1, expected: "bad", throws: true }]);
	});
});

describe("parsesCleanly", () => {
	test("a program passes; a fragment and a stray return are left out", () => {
		expect(parsesCleanly("const a = 1;")).toBe(true);
		expect(parsesCleanly("function f() { return 1; }")).toBe(true);
		expect(parsesCleanly("{ locale: 'en', config: }")).toBe(false);
		expect(parsesCleanly("switch (x) { case 1: return 2; }")).toBe(false);
		expect(parsesCleanly("")).toBe(true);
	});
});

describe("pageProgram", () => {
	test("an earlier fence's names reach a later one, a second const replaces the first, and a broken earlier fence is stepped over", async () => {
		const page: TsFence[] = [
			{ file: "p.md", line: 1, source: "const n = 2;" },
			{ file: "p.md", line: 5, source: "not valid (" },
			{ file: "p.md", line: 9, source: "const n = 3;\nboom();" },
			{ file: "p.md", line: 13, source: 'n * 2; // "6"' },
		];
		expect(pageProgram(page, 3).assertions).toEqual([{ line: 1, expected: "6" }]);
		expect(await runProgram(page, 3)).toEqual([6]);
	});

	test("the target fence's own failure is not swallowed", async () => {
		const page: TsFence[] = [{ file: "p.md", line: 1, source: 'boom(); // "x"' }];
		await expect(runProgram(page, 0)).rejects.toThrow("boom is not defined");
	});

	test("a stated throw that does not throw records nothing thrown", async () => {
		const page: TsFence[] = [{ file: "p.md", line: 1, source: "Math.abs(1); // throws: no" }];
		expect(await runProgram(page, 0)).toEqual([undefined]);
	});

	test("hostile fences: prototype words as names, markup in strings, and a long page stay inert", async () => {
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		const page: TsFence[] = [
			{ file: "p.md", line: 1, source: 'const constructor = "<script>alert(1)</script>";\nconst toString = 1;' },
			{ file: "p.md", line: 5, source: Array.from({ length: 2000 }, (_, i) => `const v${i} = ${i};`).join("\n") },
			{ file: "p.md", line: 9, source: 'constructor; // "<script>alert(1)</script>"' },
		];
		expect(await runProgram(page, 2)).toEqual(["<script>alert(1)</script>"]);
		expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
	});

	test("an import becomes a require the caller answers", async () => {
		const page: TsFence[] = [{ file: "p.md", line: 1, source: 'import { a } from "solve-engine";\na; // "x"' }];
		await expect(runProgram(page, 0)).rejects.toThrow("no import of solve-engine here");
	});
});
