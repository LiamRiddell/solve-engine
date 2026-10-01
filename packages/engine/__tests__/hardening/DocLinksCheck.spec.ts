import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * `scripts/check-doc-links.mjs` and the repeated-slug half of
 * `scripts/check-sidebar.mjs` (#780): every root-relative docs link reaches a
 * page and every fragment a heading on it, and no page is listed twice in the
 * sidebar. Both scripts run over fixture checkouts through `--root`, and the
 * shared helpers in `scripts/lib/markdown-links.mjs` are called directly
 * through a child `node`, since they are ES modules the jest transform does not
 * load.
 */

const SCRIPTS = path.resolve(__dirname, "../../../../scripts");
const LINKS = path.join(SCRIPTS, "check-doc-links.mjs");
const SIDEBAR = path.join(SCRIPTS, "check-sidebar.mjs");
const LIB = path.join(SCRIPTS, "lib", "markdown-links.mjs");

const roots: string[] = [];

/** A throwaway checkout holding the pages given, keyed by their path under `docs/src/content/docs`. */
function checkout(pages: Record<string, string>, config?: string, publicFiles: string[] = []): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-links-"));
	roots.push(root);
	const content = path.join(root, "docs", "src", "content", "docs");
	for (const [name, body] of Object.entries(pages)) {
		fs.mkdirSync(path.dirname(path.join(content, name)), { recursive: true });
		fs.writeFileSync(path.join(content, name), body);
	}
	for (const file of publicFiles) {
		fs.mkdirSync(path.dirname(path.join(root, "docs", "public", file)), { recursive: true });
		fs.writeFileSync(path.join(root, "docs", "public", file), "");
	}
	if (config !== undefined) fs.writeFileSync(path.join(root, "docs", "astro.config.mjs"), config);
	return root;
}

function run(script: string, root: string): { status: number | null; out: string } {
	const result = spawnSync(process.execPath, [script, `--root=${root}`], { encoding: "utf8", timeout: 30_000 });
	return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/** Calls one export of the shared helpers with JSON arguments and returns its JSON result. */
function helper(name: string, ...args: unknown[]): unknown {
	const program = `import * as lib from ${JSON.stringify(`file://${LIB}`)};
const out = lib[${JSON.stringify(name)}](...${JSON.stringify(args)});
process.stdout.write(JSON.stringify(out instanceof Set ? [...out] : out));`;
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8", timeout: 30_000 });
	if (result.status !== 0) throw new Error(result.stderr);
	return JSON.parse(result.stdout);
}

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

const page = (title: string, body = ""): string => `---\ntitle: ${title}\n---\n\n${body}`;

describe("check-doc-links: a link reaches a page", () => {
	test("a tree whose links all land passes, and says how many it checked", () => {
		const result = run(
			LINKS,
			checkout({
				"guide/a.md": page("A", "See [b](/guide/b/) and [its part](/guide/b/#the-part)."),
				"guide/b.md": page("B", "## The part\n\nText."),
			}),
		);
		expect(result.status).toBe(0);
		expect(result.out).toContain("All 2 internal link(s) across 2 page(s)");
	});

	test("a link to no page fails, naming the file and the target", () => {
		const result = run(LINKS, checkout({ "guide/a.md": page("A", "[gone](/guide/gone/)") }));
		expect(result.status).toBe(1);
		expect(result.out).toContain("guide/a.md: /guide/gone/ goes to no page");
	});

	test("the trailing slash is optional, and an index page is its directory", () => {
		const root = checkout({ "index.mdx": page("Home"), "guide/a.md": page("A", "[b](/guide/b) [home](/) [x](/x/)"), "guide/b.md": page("B"), "x/index.md": page("X") });
		expect(run(LINKS, root).status).toBe(0);
	});

	test("a link that differs from the page only in case is not taken as reaching it", () => {
		const result = run(LINKS, checkout({ "guide/a.md": page("A", "[B](/Guide/B/)"), "guide/b.md": page("B") }));
		expect(result.status).toBe(1);
		expect(result.out).toContain("goes to no page");
	});

	test("a relative link is reported, since only root-relative links get the base path", () => {
		const result = run(LINKS, checkout({ "guide/a.md": page("A", "[b](../b/)"), "guide/b.md": page("B") }));
		expect(result.status).toBe(1);
		expect(result.out).toContain("../b/ is a relative link");
	});
});

describe("check-doc-links: a fragment reaches a heading", () => {
	test("a heading renamed under its anchor fails (the time-zones case)", () => {
		const result = run(
			LINKS,
			checkout({
				"syntax/time-zones.md": page("Time zones", "[pin it](/guide/dates-on-temporal/#choosing-a-zone-without-temporal)"),
				"guide/dates-on-temporal.md": page("Dates on Temporal", "## Choosing a zone on either backend\n"),
			}),
		);
		expect(result.status).toBe(1);
		expect(result.out).toContain("/guide/dates-on-temporal/#choosing-a-zone-without-temporal names no heading on guide/dates-on-temporal");
	});

	test("the page title is #_top, not a slug of the title (the derived-units case)", () => {
		const pages = { "syntax/derived-units.md": page("Named derived units", "No headings.") };
		const bad = run(LINKS, checkout({ ...pages, "syntax/c.md": page("C", "[n](/syntax/derived-units/#named-derived-units)") }));
		expect(bad.status).toBe(1);
		expect(bad.out).toContain("names no heading on syntax/derived-units");
		expect(run(LINKS, checkout({ ...pages, "syntax/c.md": page("C", "[n](/syntax/derived-units/#_top)") })).status).toBe(0);
	});

	test("a fragment on its own is checked against its own page", () => {
		expect(run(LINKS, checkout({ "a.md": page("A", "## The boundary\n\n[up](#the-boundary)") })).status).toBe(0);
		const result = run(LINKS, checkout({ "a.md": page("A", "[up](#nowhere)") }));
		expect(result.status).toBe(1);
		expect(result.out).toContain("a.md: #nowhere names no heading on a");
	});

	test("a repeated heading takes -1, as the slugger numbers it", () => {
		const root = checkout({ "a.md": page("A", "## Example\n\n## Example\n\n[second](#example-1) [first](#example)") });
		expect(run(LINKS, root).status).toBe(0);
		expect(run(LINKS, checkout({ "a.md": page("A", "## Example\n\n[second](#example-1)") })).status).toBe(1);
	});

	test("an id written as HTML is a target too", () => {
		expect(run(LINKS, checkout({ "a.md": page("A", '<span id="here"></span>\n\n[x](#here)') })).status).toBe(0);
	});
});

describe("check-doc-links: what it deliberately does not check", () => {
	test("/playground/ and /api/ leave the content tree by name", () => {
		expect(run(LINKS, checkout({ "a.md": page("A", "[p](/playground/) [v](/api/vm/classes/value/)") })).status).toBe(0);
	});

	test("external addresses and mail links are not followed", () => {
		expect(run(LINKS, checkout({ "a.md": page("A", "[x](https://example.invalid/nothing) [m](mailto:a@example.invalid) [p](//cdn.example.invalid/x)") })).status).toBe(0);
	});

	test("a file path is checked against docs/public", () => {
		expect(run(LINKS, checkout({ "a.md": page("A", "[f](/favicon.svg)") }, undefined, ["favicon.svg"])).status).toBe(0);
		const result = run(LINKS, checkout({ "a.md": page("A", "[f](/missing.svg)") }));
		expect(result.status).toBe(1);
		expect(result.out).toContain("/missing.svg is no file in docs/public");
	});

	test("a link inside a fence, a code span or a comment is not a link", () => {
		const body = "```md\n[x](/gone/)\n```\n\n`[y](/gone/)`\n\n<!-- [z](/gone/) -->\n";
		expect(run(LINKS, checkout({ "a.md": page("A", body) })).status).toBe(0);
	});

	test("an empty tree fails rather than passing with nothing checked", () => {
		const root = checkout({});
		fs.mkdirSync(path.join(root, "docs", "src", "content", "docs"), { recursive: true });
		const result = run(LINKS, root);
		expect(result.status).toBe(1);
		expect(result.out).toContain("nothing to check");
	});
});

describe("check-doc-links: hostile pages", () => {
	test("a page named after an inherited property is a page like any other", () => {
		const root = checkout({
			"syntax/constructor.md": page("C", "## toString\n"),
			"a.md": page("A", "[c](/syntax/constructor/#tostring) [p](/syntax/constructor/#__proto__) [t](/syntax/tostring/)"),
		});
		const result = run(LINKS, root);
		expect(result.status).toBe(1);
		expect(result.out).toContain("/syntax/tostring/ goes to no page");
		expect(result.out).toContain("/syntax/constructor/#__proto__ names no heading");
		expect(result.out).not.toContain("#tostring names no heading");
	});

	test("thousands of unclosed brackets and a long run of backticks finish promptly", () => {
		const body = `${"[".repeat(20_000)}(${"`".repeat(20_000)}\n${"<a ".repeat(5_000)}\n${"#".repeat(10_000)} x`;
		const started = Date.now();
		const result = run(LINKS, checkout({ "a.md": page("A", body) }));
		expect(result.status).toBe(0);
		expect(Date.now() - started).toBeLessThan(20_000);
	});

	test("markup in a heading is read as text for its id", () => {
		expect(run(LINKS, checkout({ "a.md": page("A", "## <em>Safe</em> `code`\n\n[x](#safe-code)") })).status).toBe(0);
	});

	test("a fragment that is not valid percent-encoding fails to match rather than throwing", () => {
		const result = run(LINKS, checkout({ "a.md": page("A", "## A\n\n[x](#%E0%A4%A)") }));
		expect(result.status).toBe(1);
		expect(result.out).toContain("names no heading");
		expect(result.out).not.toMatch(/URIError|TypeError/);
	});

	test("CRLF line endings read the same as LF", () => {
		expect(run(LINKS, checkout({ "a.md": "---\r\ntitle: A\r\n---\r\n\r\n## The part\r\n\r\n[x](#the-part)\r\n" })).status).toBe(0);
	});
});

describe("the helpers", () => {
	test("slugifyHeading: ordinary headings", () => {
		expect(helper("slugifyHeading", "Choosing a zone on either backend")).toBe("choosing-a-zone-on-either-backend");
		expect(helper("slugifyHeading", "What the engine ships, and what it does not")).toBe("what-the-engine-ships-and-what-it-does-not");
		expect(helper("slugifyHeading", "`as base64`: encoding")).toBe("as-base64-encoding");
	});

	test("slugifyHeading: boundaries keep letters from other scripts, drop symbols, and keep repeated spaces as hyphens", () => {
		expect(helper("slugifyHeading", "")).toBe("");
		expect(helper("slugifyHeading", "Café Ünïcode")).toBe("café-ünïcode");
		expect(helper("slugifyHeading", "£ and € (money)")).toBe("-and--money");
		expect(helper("slugifyHeading", "snake_case-and-hyphen")).toBe("snake_case-and-hyphen");
	});

	test("slugifyHeading: zero-width and direction-override characters are dropped", () => {
		expect(helper("slugifyHeading", "a​b‮c")).toBe("abc");
	});

	test("withoutTags: ordinary tags go and their text stays", () => {
		expect(helper("withoutTags", "a <em>b</em> c")).toBe("a b c");
		expect(helper("withoutTags", "plain")).toBe("plain");
		expect(helper("withoutTags", "")).toBe("");
	});

	test("withoutTags: a tag split by another tag does not survive one pass", () => {
		// CodeQL's incomplete multi-character sanitisation: one pass over this
		// left `<script>` behind.
		expect(helper("withoutTags", "<scr<b>ipt>alert(1)")).toBe("alert(1)");
		expect(helper("withoutTags", "<<b>i<i>mg src=x>")).toBe("");
		expect(helper("withoutTags", "<<<>>>")).toBe("<<<>>>");
	});

	test("withoutTags: deep nesting and a long run end, and stay linear enough", () => {
		const nested = "<".repeat(200) + "b" + ">".repeat(200);
		expect(typeof helper("withoutTags", nested)).toBe("string");
		expect(helper("withoutTags", "<i>x</i>".repeat(2000))).toBe("x".repeat(2000));
	});

	test("headingIds: a heading written with a split tag gets no tag in its id", () => {
		const ids = helper("headingIds", "---\ntitle: T\n---\n## Safe <scr<b>ipt>here\n") as string[];
		expect(ids).toContain("safe-here");
		expect(ids.some((id) => /[<>]/.test(id))).toBe(false);
	});

	test("headingIds: _top always, repeats numbered, fenced headings skipped", () => {
		const ids = helper("headingIds", "---\ntitle: T\n---\n## A\n## A\n```\n## Not\n```\n### B `c`\n") as string[];
		expect(ids).toEqual(expect.arrayContaining(["_top", "a", "a-1", "b-c"]));
		expect(ids).not.toContain("not");
	});

	test("fragmentOf: none, empty, encoded and malformed", () => {
		expect(helper("fragmentOf", "/guide/a/")).toBeNull();
		expect(helper("fragmentOf", "/guide/a/#")).toBe("");
		expect(helper("fragmentOf", "/a/#caf%C3%A9")).toBe("café");
		expect(helper("fragmentOf", "/a/#%E0%A4%A")).toBe("%E0%A4%A");
	});

	test("slugOf: root-relative only", () => {
		expect(helper("slugOf", "/guide/a/#x")).toBe("guide/a");
		expect(helper("slugOf", "/")).toBe("");
		expect(helper("slugOf", "//cdn/x")).toBeNull();
		expect(helper("slugOf", "../a/")).toBeNull();
		expect(helper("slugOf", "#x")).toBeNull();
	});

	test("linkTargets: inline, reference and HTML links, not images", () => {
		expect(helper("linkTargets", '[a](/a/) ![i](/i.png)\n\n[r]: /r/\n\n<a href="/h/">h</a>')).toEqual(["/a/", "/r/", "/h/"]);
	});
});

describe("check-sidebar: a page listed twice", () => {
	const pages = { "guide/a.md": page("A"), "guide/b.md": page("B") };

	test("each page once passes", () => {
		const result = run(SIDEBAR, checkout(pages, '{ slug: "guide/a" },\n{ slug: "guide/b" },\n'));
		expect(result.status).toBe(0);
		expect(result.out).toContain("Sidebar covers all 2 documentation page(s).");
	});

	test("a slug listed twice fails, naming it and the count (the dates-on-temporal case)", () => {
		const result = run(SIDEBAR, checkout(pages, '{ slug: "guide/a" },\n{ slug: "guide/b" },\n{ slug: "guide/a" },\n'));
		expect(result.status).toBe(1);
		expect(result.out).toContain("listed in the sidebar more than once:\n  guide/a (2 times)");
	});

	test("a repeated slug named after an inherited property is still counted", () => {
		const result = run(SIDEBAR, checkout({ "constructor.md": page("C") }, '{ slug: "constructor" },\n{ slug: "constructor" },\n'));
		expect(result.status).toBe(1);
		expect(result.out).toContain("constructor (2 times)");
	});
});

describe("the repository", () => {
	test("its docs links all land", () => {
		const result = spawnSync(process.execPath, [LINKS], { encoding: "utf8", timeout: 60_000 });
		expect(`${result.stdout}${result.stderr}`).toContain("reach a page");
		expect(result.status).toBe(0);
	});

	test("its sidebar lists each page once", () => {
		const result = spawnSync(process.execPath, [SIDEBAR], { encoding: "utf8", timeout: 60_000 });
		expect(result.status).toBe(0);
	});
});
