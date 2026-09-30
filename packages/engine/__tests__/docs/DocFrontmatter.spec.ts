import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/**
 * Every docs page's frontmatter parses as YAML.
 *
 * The docs site reads each page's `title` and `description` with a YAML
 * parser, and a plain (unquoted) value that carries a colon followed by a space
 * is read as a second mapping, which fails the whole site build. The recipes
 * `a-developer-scratchpad.md` and `a-lab-note.md` shipped that way, since a
 * description in the house voice leans on colons. The docs build is the only
 * other place that notices, so this check keeps it in the fast suite.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs/src/content/docs");

/** Characters a YAML plain scalar may not start with. */
const PLAIN_SCALAR_BAD_START = new Set(["[", "]", "{", "}", "#", "&", "*", "!", "|", ">", "%", "@", "`", ","]);

/**
 * Why a one-line top-level frontmatter value would not parse as YAML, or
 * undefined when it would.
 *
 * Covers the shapes a docs page writes: a plain value, and a value wrapped in
 * double or single quotes. It is a line check, not a YAML parser: a block
 * scalar (`|` or `>`) and a nested mapping are left to the site build.
 *
 * @param value - The text after `key: `.
 * @returns A short reason, or undefined.
 */
export function frontmatterValueProblem(value: string): string | undefined {
	const text = value.trim();
	if (text === "") return undefined;
	const first = text[0];
	if (first === '"') {
		// A double-quoted scalar ends at the first unescaped quote, and nothing
		// but a comment may follow it.
		let i = 1;
		for (; i < text.length; i++) {
			if (text[i] === "\\") i++;
			else if (text[i] === '"') break;
		}
		if (i >= text.length) return "an opening double quote is never closed";
		const rest = text.slice(i + 1).trim();
		return rest === "" || rest.startsWith("#") ? undefined : "text follows the closing double quote";
	}
	if (first === "'") {
		// A single quote inside a single-quoted scalar is written twice.
		let i = 1;
		for (; i < text.length; i++) {
			if (text[i] === "'") {
				if (text[i + 1] === "'") i++;
				else break;
			}
		}
		if (i >= text.length) return "an opening single quote is never closed";
		const rest = text.slice(i + 1).trim();
		return rest === "" || rest.startsWith("#") ? undefined : "text follows the closing single quote";
	}
	if (PLAIN_SCALAR_BAD_START.has(first)) return `an unquoted value cannot start with ${first}`;
	if (/:\s/.test(text) || text.endsWith(":")) return "an unquoted value carries a colon followed by a space";
	if (/\s#/.test(text)) return "an unquoted value carries a space followed by #, which starts a comment";
	return undefined;
}

/**
 * The frontmatter block of a markdown page, or undefined when it has none.
 *
 * @param text - The page.
 * @returns The lines between the opening and closing `---`.
 */
export function frontmatterLines(text: string): string[] | undefined {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	return match ? match[1].split(/\r?\n/) : undefined;
}

function markdownPages(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...markdownPages(full));
		else if (/\.mdx?$/.test(entry.name)) out.push(full);
	}
	return out;
}

describe("frontmatterValueProblem", () => {
	test.each([
		["A plain sentence, with a comma."],
		['"Quoted: with a colon."'],
		['"An escaped \\" quote inside."'],
		["'Single: quoted, it''s fine.'"],
		["ratio:1 has no space after the colon"],
		["C# is fine without a space before the hash"],
		[""],
		["   "],
		['"Quoted" # and a comment'],
	])("accepts %j", (value) => {
		expect(frontmatterValueProblem(value)).toBeUndefined();
	});

	test.each([
		["In one note: transfer times", "colon followed by a space"],
		["Ends with a colon:", "colon followed by a space"],
		["Tab after colon:\tthere", "colon followed by a space"],
		["A title # with a comment inside", "space followed by #"],
		['"Never closed', "never closed"],
		["'Never closed", "never closed"],
		['"Closed" then more', "text follows"],
		["'Closed' then more", "text follows"],
		["[a list]", "cannot start with ["],
		["{a: map}", "cannot start with {"],
		["*alias", "cannot start with *"],
		["`code`", "cannot start with `"],
	])("refuses %j", (value, reason) => {
		expect(frontmatterValueProblem(value)).toContain(reason);
	});

	test("hostile values are read as text and do not throw", () => {
		for (const value of ["constructor", "__proto__", "toString", "<script>alert(1)</script>", "‮abc", "a​b", "x".repeat(100_000) + ": y"]) {
			expect(() => frontmatterValueProblem(value)).not.toThrow();
		}
		expect(frontmatterValueProblem("__proto__")).toBeUndefined();
		expect(frontmatterValueProblem("x".repeat(100_000) + ": y")).toContain("colon");
	});
});

describe("frontmatterLines", () => {
	test("reads the block between the fences", () => {
		expect(frontmatterLines("---\ntitle: A\ndescription: B\n---\nbody")).toEqual(["title: A", "description: B"]);
	});

	test("reads a CRLF page the same way", () => {
		expect(frontmatterLines("---\r\ntitle: A\r\n---\r\nbody")).toEqual(["title: A"]);
	});

	test("a page without frontmatter has none", () => {
		expect(frontmatterLines("# Heading\n---\n")).toBeUndefined();
		expect(frontmatterLines("")).toBeUndefined();
	});
});

describe("every docs page's frontmatter parses", () => {
	const pages = markdownPages(DOCS_ROOT);

	test("the docs tree has pages to check", () => {
		expect(pages.length).toBeGreaterThan(50);
	});

	test("no top-level value would fail the YAML parser", () => {
		const problems: string[] = [];
		for (const page of pages) {
			const lines = frontmatterLines(fs.readFileSync(page, "utf8"));
			if (!lines) continue;
			for (const line of lines) {
				// A top-level `key: value` line; indented lines belong to a nested
				// mapping or a block scalar, which the site build checks.
				const match = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
				if (!match || match[2] === undefined) continue;
				if (match[2].startsWith("|") || match[2].startsWith(">")) continue;
				const problem = frontmatterValueProblem(match[2]);
				if (problem) problems.push(`${path.relative(REPO_ROOT, page)}: ${match[1]}: ${problem}`);
			}
		}
		expect(problems).toEqual([]);
	});
});
