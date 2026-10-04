import { describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { newTrackedEngine } from "@tools/trackedEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Issue #729: nine syntax pages written before the two-reader rule showed code
 * before saying what it does, in 20 places: a heading, or the Package callout,
 * followed directly by a code block or a table. Each now has a plain sentence
 * or two first. This spec keeps it so: it reads every syntax page the way the
 * survey's script did and fails on a heading or a callout whose next non-blank
 * line opens a fence or a table.
 *
 * It also holds two claims the pass added: that `reduce` starts its
 * accumulator at the first element, and that the symbolic arrow is built in.
 */

const SYNTAX = path.resolve(__dirname, "../../../../docs/src/content/docs/syntax");

/**
 * Places that may show before they explain, each with the reason. A `Map`, so
 * a key cannot be found through an inherited property.
 */
const EXEMPT = new Map([
]);

interface Offence {
	readonly page: string;
	readonly line: number;
	readonly what: string;
}

/**
 * Every heading or callout in `markdown` whose next non-blank line opens a
 * code fence or a table. Lines inside a fence are skipped, so a `#` comment in
 * an example is not read as a heading.
 */
function showsBeforeExplaining(page: string, markdown: string): Offence[] {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	let start = 0;
	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		if (end !== -1) start = end + 1;
	}
	const found: Offence[] = [];
	let fence: string | null = null;
	let pending: { line: number; what: string } | null = null;
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
		if (fence !== null) {
			if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = null;
			continue;
		}
		if (line.trim() === "") continue;
		if (pending !== null && (marker || /^\s*\|/.test(line))) found.push({ page, line: pending.line, what: pending.what });
		pending = null;
		if (marker) {
			fence = marker[1];
			continue;
		}
		if (/^#{1,6} /.test(line)) pending = { line: i + 1, what: line.trim() };
		else if (/^> \*\*(Package|Packages|Built in)/.test(line)) pending = { line: i + 1, what: "the callout" };
	}
	return found;
}

/**
 * Every line that closes a fence and carries text after it (```` ``` A monthly````),
 * which does not close the fence in markdown and swallows the prose after it
 * into the block.
 */
function textAfterClosingFence(markdown: string): number[] {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const bad: number[] = [];
	let open = false;
	lines.forEach((line, i) => {
		const marker = /^ {0,3}```(.*)$/.exec(line);
		if (!marker) return;
		if (!open) {
			open = true;
			return;
		}
		if (marker[1].trim() === "") open = false;
		else bad.push(i + 1);
	});
	return bad;
}

function show(line: string): string {
	return formatValue(newTrackedEngine().evaluateExpression(line)).replace(/^=\s*/, "");
}

const pages = fs.readdirSync(SYNTAX).filter((file) => file.endsWith(".md")).sort();

describe("the helpers, on ordinary, boundary and hostile pages", () => {
	test("a heading straight over a fence or a table is found; one with a sentence between is not", () => {
		expect(showsBeforeExplaining("p", "## A\n\n```solve\n1\n```\n")).toEqual([{ page: "p", line: 1, what: "## A" }]);
		expect(showsBeforeExplaining("p", "## A\n| a | b |\n")).toEqual([{ page: "p", line: 1, what: "## A" }]);
		expect(showsBeforeExplaining("p", "## A\n\nWhat it is.\n\n```solve\n1\n```\n")).toEqual([]);
	});

	test("the callout counts as a heading, and a heading inside a fence does not", () => {
		expect(showsBeforeExplaining("p", "> **Package:** `X`.\n\n```solve\n1\n```\n")).toHaveLength(1);
		expect(showsBeforeExplaining("p", "```text\n## not a heading\n```\n\n```solve\n1\n```\n")).toEqual([]);
	});

	test("the frontmatter, CRLF, an empty page and a page of only headings", () => {
		expect(showsBeforeExplaining("p", "---\ntitle: x\n---\n## A\r\n\r\n```solve\r\n1\r\n```\r\n")).toHaveLength(1);
		expect(showsBeforeExplaining("p", "")).toEqual([]);
		expect(showsBeforeExplaining("p", "## A\n## B\n### C\n")).toEqual([]);
	});

	test("an unclosed fence, a tilde fence and a longer closing run", () => {
		expect(showsBeforeExplaining("p", "```solve\n## A\n```solve\n")).toEqual([]);
		expect(showsBeforeExplaining("p", "## A\n~~~\nx\n~~~\n")).toHaveLength(1);
		expect(showsBeforeExplaining("p", "````\n```\n## inside\n````\n")).toEqual([]);
	});

	test("hostile shapes: markup, a heading named like an inherited property, a huge page", () => {
		expect(showsBeforeExplaining("p", "## <script>\n\n| a |\n")).toHaveLength(1);
		expect(showsBeforeExplaining("constructor", "## __proto__\n\n```\n```\n")).toEqual([{ page: "constructor", line: 1, what: "## __proto__" }]);
		const huge = "## A\n\ntext\n\n".repeat(50_000);
		const started = performance.now();
		expect(showsBeforeExplaining("p", huge)).toEqual([]);
		expect(performance.now() - started).toBeLessThan(2_000);
	});

	test("text after a closing fence is found, and an info string on an opening one is not", () => {
		expect(textAfterClosingFence("```solve\n1\n``` A monthly\n")).toEqual([3]);
		expect(textAfterClosingFence("```solve\n1\n```\n```solve-doc\n2\n```\n")).toEqual([]);
		expect(textAfterClosingFence("")).toEqual([]);
	});
});

describe("every syntax page explains before it shows", () => {
	test.each(pages)("%s", (page) => {
		const text = fs.readFileSync(path.join(SYNTAX, page), "utf8");
		const offences = EXEMPT.has(page) ? [] : showsBeforeExplaining(page, text).filter((o) => !EXEMPT.has(`${page}: ${o.what}`));
		expect(offences).toEqual([]);
	});

	test("every exemption still names a place that shows before it explains", () => {
		for (const key of EXEMPT.keys()) {
			const [page, heading] = key.split(": ");
			const text = fs.readFileSync(path.join(SYNTAX, page), "utf8");
			const offences = showsBeforeExplaining(page, text);
			expect({ key, stillNeeded: heading === undefined ? offences.length > 0 : offences.some((o) => o.what === heading) }).toEqual({ key, stillNeeded: true });
		}
	});

	test.each(pages)("%s closes every fence on a line of its own", (page) => {
		expect(textAfterClosingFence(fs.readFileSync(path.join(SYNTAX, page), "utf8"))).toEqual([]);
	});
});

describe("the claims the pass added", () => {
	test("reduce starts its accumulator at the first element and folds the rest", () => {
		expect(show("reduce(acc - x, [10, 1, 2])")).toBe("7");
		expect(show("reduce(acc*x, [2,3,4])")).toBe("24");
		expect(show("reduce(acc + x, [7])")).toBe("7");
		expect(show("reduce(max(acc, x), [3, 9, 4])")).toBe("9");
	});

	test("symbolic.md and map-reduce-and-aggregates.md now open with prose", () => {
		const symbolic = fs.readFileSync(path.join(SYNTAX, "symbolic.md"), "utf8");
		expect(symbolic).toContain("> **Built in.** The arrow belongs to the engine");
		const mapReduce = fs.readFileSync(path.join(SYNTAX, "map-reduce-and-aggregates.md"), "utf8");
		expect(mapReduce).toContain("`acc` starts as the first element");
	});
});
