/**
 * Builds the site's `llms.txt` and `llms-full.txt`, the plain-text files tools
 * that read documentation on someone's behalf look for at a site's root (#783).
 *
 * `llms.txt` is a short description of the engine and one line per syntax area,
 * read from the cheatsheet, which `lint:cheatsheet` keeps a whole map of the
 * reference. `llms-full.txt` adds every proven example with its answer, read
 * through the same collector `DocExamples.spec.ts` asserts, so neither file can
 * teach a form the build does not prove. Both are derived: `LlmsTxt.spec.ts`
 * fails when the committed copy under `docs/public/` differs from what these
 * build, and `npm run docs:llms` writes them.
 */

import * as path from "path";
import type { DocBlock, Example } from "./docExampleCollector";

/** Where the published site lives, the prefix every link in the files carries. */
export const SITE_URL = "https://liamriddell.github.io/solve-engine";

/** One area of the syntax reference, as the cheatsheet captions it. */
export interface SyntaxArea {
	/** The sidebar group the cheatsheet files it under. */
	group: string;
	/** The page's name as the caption links it. */
	title: string;
	/** The page's slug (`syntax/checks`). */
	slug: string;
	/** The caption, as plain text. */
	caption: string;
}

/**
 * Markdown inline text as plain text: a link keeps its text, code spans and
 * emphasis lose their marks, and runs of whitespace become one space.
 *
 * @param text - Inline markdown.
 * @returns The text.
 */
export function plainText(text: string): string {
	return text
		.replace(/!?\[((?:[^[\]\\]|\\.)*)\]\([^)\s]*\)/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, "$1$2")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The areas the cheatsheet lists: each paragraph that opens with a bold link
 * to a syntax page (`**[Checks](/syntax/checks/)**: ...`), under the `##`
 * heading before it. A paragraph ends at a blank line or a fence.
 *
 * @param markdown - The cheatsheet's source.
 * @returns The areas, in page order.
 */
export function cheatsheetAreas(markdown: string): SyntaxArea[] {
	const areas: SyntaxArea[] = [];
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	let group = "";
	let fence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*(```|~~~)/.test(line)) {
			fence = !fence;
			continue;
		}
		if (fence) continue;
		const heading = /^##\s+(.+?)\s*$/.exec(line);
		if (heading) {
			group = plainText(heading[1]);
			continue;
		}
		// A caption can lead with two pages that share it (`**[Stocks](...)**
		// and **[crypto](...)**: ...`); each is an area with that caption.
		const LINK = String.raw`\*\*\[([^\]]+)\]\(\/(syntax\/[a-z0-9-]+)\/?(?:#[^)]*)?\)\*\*`;
		if (!new RegExp(`^${LINK}`).test(line)) continue;
		const paragraph = [line];
		while (i + 1 < lines.length && lines[i + 1].trim() !== "" && !/^\s*(```|~~~)/.test(lines[i + 1])) paragraph.push(lines[++i]);
		const lead = new RegExp(`^((?:${LINK}(?:\\s*,\\s*|\\s+and\\s+)?)+):?\\s*(.*)$`, "s").exec(paragraph.join(" "));
		if (!lead) continue;
		const caption = plainText(lead[lead.length - 1]);
		for (const link of lead[1].matchAll(new RegExp(LINK, "g"))) areas.push({ group, title: plainText(link[1]), slug: link[2], caption });
	}
	return areas;
}

/** The short description both files open with. */
const SUMMARY = [
	"# Solve",
	"",
	"> Solve (the `solve-engine` package on npm) evaluates the lines a person writes in a note: arithmetic, percentages, units, currencies, dates and times, statistics, finance and symbolic algebra, in plain phrasing, one line or a whole document at a time.",
	"",
	"Each line of a note is worked out on its own unless it reads another: a name defined on one line (`price = 20`) is read by the lines below it, and forms such as `total above`, `line 3`, `#tag` totals, `check`, what-if (`with`) and `inputs of` work across lines. Text after `//` is a comment. Every example these files show is proven against the engine when the documentation is built.",
].join("\n");

/**
 * `llms.txt`: the summary, one linked line per syntax area under its group, and
 * the guides a host embedding the engine starts from.
 *
 * @param areas - The cheatsheet's areas.
 * @returns The file's text.
 */
export function buildLlmsTxt(areas: readonly SyntaxArea[]): string {
	const out: string[] = [SUMMARY, ""];
	let group: string | null = null;
	for (const area of areas) {
		if (area.group !== group) {
			group = area.group;
			out.push(`## ${group || "Syntax"}`, "");
		}
		out.push(`- [${area.title}](${SITE_URL}/${area.slug}/): ${area.caption}`);
		const next = areas[areas.indexOf(area) + 1];
		if (!next || next.group !== group) out.push("");
	}
	out.push(
		"## Embedding",
		"",
		`- [Quick start](${SITE_URL}/getting-started/quick-start/): installing the package, evaluating a line and formatting its value.`,
		`- [Entry points](${SITE_URL}/guide/entry-points/): which call evaluates a single line and which a whole document.`,
		`- [TypeScript usage](${SITE_URL}/guide/typescript-usage/): the value a line returns, and its failures.`,
		`- [Formatting](${SITE_URL}/guide/formatting/): turning a value into display text.`,
		`- [Cheatsheet](${SITE_URL}/syntax/cheatsheet/): one proven line for each area above.`,
		"",
		"## Optional",
		"",
		`- [Every proven example](${SITE_URL}/llms-full.txt): each example from the syntax pages with the answer the engine gives.`,
		"",
	);
	return out.join("\n");
}

/**
 * `llms-full.txt`: the summary, then each syntax page's proven examples with
 * their answers, in the notation the pages use (`expression // answer`).
 *
 * A per-line group goes in whole when any line of it is proven, since a line
 * with no answer beside it is usually one that defines a name the next reads;
 * a whole-document block goes in whole, with its answers, when any row is
 * proven. A page with nothing proven (live data, random rolls) is left out, so
 * the file never shows a form whose answer is not fixed.
 *
 * @param docsRoot - The docs content directory, for page slugs.
 * @param groups - The per-line groups, as `groupExamples` returns them.
 * @param docBlocks - The whole-document blocks.
 * @param clock - How the fixed clock the examples ran on reads, for the note on dates.
 * @returns The file's text.
 */
export function buildLlmsFull(docsRoot: string, groups: readonly Example[][], docBlocks: readonly DocBlock[], clock: string): string {
	const byPage = new Map<string, string[]>();
	const slugOf = (file: string) => path.relative(docsRoot, file).replace(/\\/g, "/").replace(/\.mdx?$/, "");
	const add = (file: string, block: string) => {
		const slug = slugOf(file);
		if (!slug.startsWith("syntax/")) return;
		if (!byPage.has(slug)) byPage.set(slug, []);
		byPage.get(slug)!.push(block);
	};
	const row = (expression: string, expected: string | null) => (expected === null ? expression : `${expression} // ${expected}`);
	for (const group of groups) {
		if (!group.some((example) => example.expected !== null)) continue;
		add(group[0].file, group.map((example) => row(example.expression, example.expected)).join("\n"));
	}
	for (const block of docBlocks) {
		if (!block.rows.some((r) => r.expected !== null)) continue;
		add(block.file, `(one document)\n${block.rows.map((r) => row(r.expression, r.expected)).join("\n")}`);
	}
	const out: string[] = [
		SUMMARY,
		"",
		`Each block below is proven: the text after the last \`//\` on a line is the answer the engine gives, with the leading \`= \` left off. A line with no answer defines a name or sets up the next line. A block marked (one document) is evaluated as one note, so its lines read each other; a blank line in it is a boundary that totals stop at. Examples that read the clock were computed at ${clock}.`,
		"",
	];
	for (const slug of [...byPage.keys()].sort()) {
		out.push(`## ${slug.replace(/^syntax\//, "")}`, "", `${SITE_URL}/${slug}/`, "");
		for (const block of byPage.get(slug)!) out.push("```", block, "```", "");
	}
	return out.join("\n");
}
