import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * `scripts/check-cheatsheet.mjs` (#728): every syntax page is linked from the
 * cheatsheet, every link there reaches a page, and the pages set aside as
 * references stay a list with a reason. Run over fixture docs trees through its
 * `--root` option, so each case is a real cheatsheet read the way the script
 * reads the repository's.
 */

const SCRIPT = path.resolve(__dirname, "../../../../scripts/check-cheatsheet.mjs");

const roots: string[] = [];

/**
 * A throwaway checkout: the syntax pages named (a page's body does not matter
 * to the check), `unit-reference.md` unless left out, since the script sets it
 * aside by name, one guide page, and the cheatsheet unless it is null.
 */
function checkout(cheatsheet: string | null, pages: string[] = ["operators.md", "time-zones.md"], withUnitReference = true): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "cheatsheet-"));
	roots.push(root);
	const content = path.join(root, "docs", "src", "content", "docs");
	fs.mkdirSync(path.join(content, "syntax"), { recursive: true });
	fs.mkdirSync(path.join(content, "guide"), { recursive: true });
	fs.writeFileSync(path.join(content, "guide", "embedding.md"), "---\ntitle: Embedding\n---\n");
	for (const page of withUnitReference ? [...pages, "unit-reference.md"] : pages) {
		fs.writeFileSync(path.join(content, "syntax", page), `---\ntitle: ${page}\n---\n`);
	}
	if (cheatsheet !== null) fs.writeFileSync(path.join(content, "syntax", "cheatsheet.md"), cheatsheet);
	return root;
}

function run(root: string): { status: number | null; out: string } {
	const result = spawnSync(process.execPath, [SCRIPT, `--root=${root}`], { encoding: "utf8" });
	return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

const FRONTMATTER = "---\ntitle: Cheatsheet\n---\n\n";
const BOTH = `${FRONTMATTER}**[Operators](/syntax/operators/)**: the operators.\n\n**[Time zones](/syntax/time-zones/)**: a time elsewhere.\n`;

describe("every syntax page is linked", () => {
	test("a cheatsheet linking every page passes, and says how many", () => {
		const result = run(checkout(BOTH));
		expect(result.status).toBe(0);
		expect(result.out).toContain("The cheatsheet links 2 syntax page(s); 1 set aside as a reference: unit-reference.");
	});

	test("a page with no link fails, naming that page and no other", () => {
		const result = run(checkout(`${FRONTMATTER}[Operators](/syntax/operators/)\n`));
		expect(result.status).toBe(1);
		expect(result.out).toContain("These syntax pages are not linked from the cheatsheet:\n  syntax/time-zones\n");
		expect(result.out).not.toContain("syntax/operators\n");
	});

	test("a new page fails until the cheatsheet links it", () => {
		const root = checkout(BOTH, ["operators.md", "time-zones.md", "age.mdx"]);
		const result = run(root);
		expect(result.status).toBe(1);
		expect(result.out).toContain("  syntax/age\n");
	});

	test("the cheatsheet does not have to link itself", () => {
		expect(run(checkout(BOTH)).out).not.toContain("syntax/cheatsheet");
	});

	test("a missing cheatsheet fails rather than passing with nothing to read", () => {
		const result = run(checkout(null));
		expect(result.status).toBe(1);
		expect(result.out).toContain("There is no cheatsheet");
	});

	test("an empty cheatsheet fails for every page", () => {
		const result = run(checkout(""));
		expect(result.status).toBe(1);
		expect(result.out).toContain("  syntax/operators\n  syntax/time-zones\n");
	});
});

describe("what counts as a link", () => {
	test("an anchor, a missing trailing slash and a query all count as linking the page", () => {
		const cheatsheet = `${FRONTMATTER}[a](/syntax/operators/#precedence) and [b](/syntax/time-zones?x=1) and [c](/syntax/time-zones)\n`;
		expect(run(checkout(cheatsheet)).status).toBe(0);
	});

	test("a link titled, angle-bracketed, or with code for its text counts", () => {
		const cheatsheet = `${FRONTMATTER}[\`2 + 2\`](/syntax/operators/ "Operators") and [zones](</syntax/time-zones/>)\n`;
		expect(run(checkout(cheatsheet)).status).toBe(0);
	});

	test("a reference-style link and an HTML anchor count", () => {
		const cheatsheet = `${FRONTMATTER}[Operators][ops] and <a href="/syntax/time-zones/">zones</a>\n\n[ops]: /syntax/operators/\n`;
		expect(run(checkout(cheatsheet)).status).toBe(0);
	});

	test("a link inside a code fence, inline code or an HTML comment does not count", () => {
		const cheatsheet = [
			FRONTMATTER,
			"[Operators](/syntax/operators/)",
			"",
			"```solve",
			"[Time zones](/syntax/time-zones/)",
			"```",
			"",
			"`[Time zones](/syntax/time-zones/)`",
			"",
			"<!-- [Time zones](/syntax/time-zones/) -->",
			"",
		].join("\n");
		const result = run(checkout(cheatsheet));
		expect(result.status).toBe(1);
		expect(result.out).toContain("  syntax/time-zones\n");
	});

	test("a tilde fence and a longer backtick fence are code too, closed only by their own kind", () => {
		const cheatsheet = [
			FRONTMATTER,
			"[Operators](/syntax/operators/)",
			"~~~",
			"[Time zones](/syntax/time-zones/)",
			"```",
			"[Time zones](/syntax/time-zones/)",
			"~~~",
			"````md",
			"```",
			"[Time zones](/syntax/time-zones/)",
			"````",
		].join("\n");
		expect(run(checkout(cheatsheet)).out).toContain("  syntax/time-zones\n");
	});

	test("an image is not a link", () => {
		const cheatsheet = `${FRONTMATTER}[Operators](/syntax/operators/) ![Time zones](/syntax/time-zones/)\n`;
		expect(run(checkout(cheatsheet)).out).toContain("  syntax/time-zones\n");
	});

	test("a relative link does not count, since the docs write internal links root-relative", () => {
		const cheatsheet = `${FRONTMATTER}[Operators](/syntax/operators/) [zones](../time-zones/) [zones](time-zones/)\n`;
		const result = run(checkout(cheatsheet));
		expect(result.status).toBe(1);
		expect(result.out).toContain("  syntax/time-zones\n");
	});

	test("a link in the frontmatter does not count", () => {
		const cheatsheet = `---\ntitle: Cheatsheet\ndescription: "[zones](/syntax/time-zones/)"\n---\n\n[Operators](/syntax/operators/)\n`;
		expect(run(checkout(cheatsheet)).out).toContain("  syntax/time-zones\n");
	});

	test("a stray backtick does not swallow the links of the next paragraph", () => {
		const cheatsheet = `${FRONTMATTER}A lone \` backtick.\n\n[Operators](/syntax/operators/) [zones](/syntax/time-zones/) and \` another.\n`;
		expect(run(checkout(cheatsheet)).status).toBe(0);
	});

	test("CRLF line endings read the same as LF", () => {
		const cheatsheet = `${BOTH}\n\`\`\`solve\n2 + 2 // 4\n\`\`\`\n`.replace(/\n/g, "\r\n");
		expect(run(checkout(cheatsheet)).status).toBe(0);
	});
});

describe("a link that reaches no page", () => {
	test("a link to a syntax page that does not exist fails, naming the link as written", () => {
		const result = run(checkout(`${BOTH}\n[Gone](/syntax/renamed-page/#part)\n`));
		expect(result.status).toBe(1);
		expect(result.out).toContain("These cheatsheet links go to no page:\n  /syntax/renamed-page/#part\n");
	});

	test("a link that differs from the page only in case goes nowhere, and does not link the page", () => {
		const cheatsheet = `${FRONTMATTER}[Operators](/syntax/operators/) [zones](/syntax/Time-Zones/)\n`;
		const result = run(checkout(cheatsheet));
		expect(result.status).toBe(1);
		expect(result.out).toContain("  /syntax/Time-Zones/\n");
		expect(result.out).toContain("  syntax/time-zones\n");
	});

	test("a link outside syntax/ is checked too; an existing one passes", () => {
		expect(run(checkout(`${BOTH}[embedding](/guide/embedding/)\n`)).status).toBe(0);
		const result = run(checkout(`${BOTH}[embedding](/guide/embeding/)\n`));
		expect(result.status).toBe(1);
		expect(result.out).toContain("  /guide/embeding/\n");
	});

	test("a link climbing out of syntax/ with .. is not read as a page", () => {
		const result = run(checkout(`${BOTH}[x](/syntax/../syntax/operators/)\n`));
		expect(result.status).toBe(1);
		expect(result.out).toContain("  /syntax/../syntax/operators/\n");
	});

	test("the generated API reference, external addresses and same-page anchors are not checked", () => {
		const cheatsheet = `${BOTH}[api](/api/classes/engine/) [site](https://example.com/syntax/nope/) [up](#arithmetic) [cdn](//cdn.example.com/x)\n`;
		expect(run(checkout(cheatsheet)).status).toBe(0);
	});
});

describe("the pages set aside as references", () => {
	test("an unlinked reference page passes", () => {
		expect(run(checkout(BOTH)).status).toBe(0);
	});

	test("a reference page the cheatsheet links anyway makes the entry stale", () => {
		const result = run(checkout(`${BOTH}[units](/syntax/unit-reference/)\n`));
		expect(result.status).toBe(1);
		expect(result.out).toContain("syntax/unit-reference (the cheatsheet links it)");
	});

	test("a reference page that no longer exists makes the entry stale", () => {
		const result = run(checkout(BOTH, ["operators.md", "time-zones.md"], false));
		expect(result.status).toBe(1);
		expect(result.out).toContain("syntax/unit-reference (no such page)");
	});
});

describe("hostile page names", () => {
	test("a page named after an inherited property is still required, not taken as set aside", () => {
		for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
			const result = run(checkout(BOTH, ["operators.md", "time-zones.md", `${name}.md`]));
			expect(result.status).toBe(1);
			expect(result.out).toContain(`  syntax/${name.toLowerCase()}\n`);
		}
	});

	test("a link naming an inherited property reaches no page", () => {
		const result = run(checkout(`${BOTH}[x](/syntax/constructor/) [y](/syntax/__proto__/)\n`));
		expect(result.status).toBe(1);
		expect(result.out).toContain("  /syntax/constructor/\n  /syntax/__proto__/\n");
	});

	test("text shaped to make the patterns backtrack is read in one short pass", () => {
		// Each of these is quadratic or worse for a naive pattern: a long run of
		// backticks against a backreference, and an unclosed bracket, tag or
		// comment scanned to the end of the page once per occurrence.
		const hostile = [
			"`".repeat(50000),
			"[".repeat(50000),
			"<a ".repeat(20000),
			Array.from({ length: 1000 }, (_, i) => "`".repeat(i + 1)).join(" x "),
			Array.from({ length: 20000 }, (_, i) => `[p${i}](/syntax/operators/#${i})`).join(" "),
			"<!--".repeat(20000),
		].join("\n");
		const started = Date.now();
		const result = run(checkout(`${BOTH}\n${hostile}\n`));
		expect(Date.now() - started).toBeLessThan(4000);
		expect(result.status).toBe(0);
	});
});

describe("the repository's own cheatsheet", () => {
	test("links every syntax page", () => {
		const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
		expect(result.stdout + result.stderr).toMatch(/The cheatsheet links \d+ syntax page\(s\)/);
		expect(result.status).toBe(0);
	});
});
