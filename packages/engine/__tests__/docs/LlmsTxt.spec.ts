import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { DOCS_NOW, DOCS_ZONE, collectAll, groupExamples } from "@tools/docExampleCollector";
import { SITE_URL, buildLlmsFull, buildLlmsTxt, cheatsheetAreas, plainText } from "@tools/llmsTxt";

/**
 * `docs/public/llms.txt` and `docs/public/llms-full.txt` are current (#783).
 *
 * Both are built from what the build already proves: the cheatsheet's areas,
 * and the examples `DocExamples.spec.ts` asserts, read through the same
 * collector. This fails when the committed copy differs from what they build,
 * as `lint:units` does for the unit reference; `npm run docs:llms` rewrites
 * them (it runs this spec with `LLMS_WRITE=1`).
 */

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs/src/content/docs");
const PUBLIC = path.join(REPO_ROOT, "docs/public");
const CLOCK = `${new Date(DOCS_NOW).toISOString().replace(".000Z", "Z")} (${DOCS_ZONE})`;

const areas = cheatsheetAreas(fs.readFileSync(path.join(DOCS_ROOT, "syntax/cheatsheet.md"), "utf8"));
const { examples, docBlocks } = collectAll(DOCS_ROOT);
const built = {
	"llms.txt": buildLlmsTxt(areas),
	"llms-full.txt": buildLlmsFull(DOCS_ROOT, groupExamples(examples), docBlocks, CLOCK),
};

if (process.env.LLMS_WRITE === "1") {
	for (const [name, text] of Object.entries(built)) fs.writeFileSync(path.join(PUBLIC, name), text);
}

describe("the llms files are current", () => {
	test.each(Object.keys(built))("docs/public/%s is what the docs build (npm run docs:llms rewrites it)", (name) => {
		const committed = fs.existsSync(path.join(PUBLIC, name)) ? fs.readFileSync(path.join(PUBLIC, name), "utf8") : "";
		expect(committed === built[name as keyof typeof built]).toBe(true);
	});

	test("llms.txt has a line for every syntax page the cheatsheet links, and links only published pages", () => {
		const onDisk = new Set(
			fs
				.readdirSync(path.join(DOCS_ROOT, "syntax"))
				.filter((f) => /\.mdx?$/.test(f))
				.map((f) => `syntax/${f.replace(/\.mdx?$/, "")}`),
		);
		expect(areas.length).toBeGreaterThan(90);
		for (const area of areas) expect({ slug: area.slug, exists: onDisk.has(area.slug) }).toEqual({ slug: area.slug, exists: true });
		for (const slug of onDisk) {
			if (slug === "syntax/cheatsheet" || slug === "syntax/unit-reference") continue;
			expect({ slug, listed: areas.some((area) => area.slug === slug) }).toEqual({ slug, listed: true });
		}
	});

	test("llms-full.txt carries only proven lines: every line with an answer is an asserted example", () => {
		const asserted = new Set([
			...examples.filter((e) => e.expected !== null).map((e) => `${e.expression} // ${e.expected}`),
			...docBlocks.flatMap((b) => b.rows.filter((r) => r.expected !== null).map((r) => `${r.expression} // ${r.expected}`)),
		]);
		const full = built["llms-full.txt"];
		let inFence = false;
		let answered = 0;
		for (const line of full.split("\n")) {
			if (line === "```") {
				inFence = !inFence;
				continue;
			}
			if (!inFence || !line.includes(" // ")) continue;
			answered++;
			expect({ line, proven: asserted.has(line) }).toEqual({ line, proven: true });
		}
		expect(answered).toBeGreaterThan(1000);
	});

	test("the pages with no fixed answer contribute nothing", () => {
		for (const page of ["weather", "stocks", "crypto", "knowledge"]) {
			expect(built["llms-full.txt"]).not.toContain(`## ${page}\n`);
		}
	});
});

describe("the llms helpers", () => {
	test("plainText: links keep their text, marks go, whitespace collapses", () => {
		expect(plainText("a [link](/x/) and `code` **bold**\n  *em*")).toBe("a link and `code` bold em");
		expect(plainText("")).toBe("");
		expect(plainText("2 * 3 * 4")).toBe("2 * 3 * 4");
	});

	test("cheatsheetAreas: a caption across lines, its group, and a fenced line that looks like one ignored", () => {
		const page = [
			"## Arithmetic",
			"",
			"**[Operators](/syntax/operators/)**: add and",
			"subtract.",
			"",
			"```solve",
			"**[Fake](/syntax/fake/)**: not an area",
			"```",
			"## Working across lines",
			"**[Checks](/syntax/checks/#top)**: a `check` line.",
		].join("\n");
		expect(cheatsheetAreas(page)).toEqual([
			{ group: "Arithmetic", title: "Operators", slug: "syntax/operators", caption: "add and subtract." },
			{ group: "Working across lines", title: "Checks", slug: "syntax/checks", caption: "a `check` line." },
		]);
	});

	test("cheatsheetAreas: hostile captions stay text, and an empty page lists nothing", () => {
		const page = '**[__proto__](/syntax/constructor/)**: <script>alert(1)</script> and "quotes"\r\n';
		expect(cheatsheetAreas(page)).toEqual([{ group: "", title: "__proto__", slug: "syntax/constructor", caption: '<script>alert(1)</script> and "quotes"' }]);
		expect(cheatsheetAreas("")).toEqual([]);
		expect(Object.prototype).not.toHaveProperty("syntax/constructor");
	});

	test("buildLlmsTxt: the summary, a line per area with its site link, and the embedding guides", () => {
		const text = buildLlmsTxt([{ group: "Arithmetic", title: "Operators", slug: "syntax/operators", caption: "add." }]);
		expect(text.startsWith("# Solve\n\n> ")).toBe(true);
		expect(text).toContain(`## Arithmetic\n\n- [Operators](${SITE_URL}/syntax/operators/): add.\n`);
		expect(text).toContain("## Embedding");
		expect(buildLlmsTxt([])).toContain("## Embedding");
	});

	test("buildLlmsFull: a group with a proven line goes in whole, one with none is left out, and pages outside syntax/ are ignored", () => {
		const file = path.join(DOCS_ROOT, "syntax/variables.md");
		const groups = [
			[
				{ file, line: 1, expression: "x = 10", expected: null },
				{ file, line: 2, expression: "x * 2", expected: "20" },
			],
			[{ file, line: 4, expression: "roll d6", expected: null }],
			[{ file: path.join(DOCS_ROOT, "guide/x.md"), line: 1, expression: "1 + 1", expected: "2" }],
		];
		const text = buildLlmsFull(DOCS_ROOT, groups, [], "now");
		expect(text).toContain("## variables\n\n" + `${SITE_URL}/syntax/variables/\n\n` + "```\nx = 10\nx * 2 // 20\n```");
		expect(text).not.toContain("roll d6");
		expect(text).not.toContain("1 + 1");
		expect(text).toContain("computed at now");
	});
});
