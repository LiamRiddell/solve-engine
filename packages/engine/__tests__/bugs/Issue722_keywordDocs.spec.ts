import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PROTOTYPE_WORDS } from "@tools/adversarial";

/**
 * Issues #722 and #831: about twenty working names (`atan2`, `sinh`, `pow`,
 * `vec3`, `as multiplier`) and 77 multi-word phrases (`what day is it on`,
 * `compound interest on`, `how much per month to reach`) appeared on no syntax
 * page, and nothing checked. `scripts/check-keyword-docs.mjs` (`npm run
 * lint:keywords`) now reads every word and phrase the built engine accepts and
 * fails on one no syntax page mentions.
 *
 * Each case runs the script over a fixture docs tree through `--root`, with the
 * names from a fixture file through `--vocabulary`, so the check is exercised
 * exactly as the gate runs it, without needing a built engine.
 */

const REPO = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(REPO, "scripts/check-keyword-docs.mjs");
const ALLOWLIST = path.join(REPO, "scripts/keyword-docs-allowlist.json");

const roots: string[] = [];

interface Fixture {
	/** Page file name under `syntax/` to its content. */
	readonly pages?: Readonly<Record<string, string>>;
	/** Page file name under `guide/` to its content. */
	readonly guide?: Readonly<Record<string, string>>;
	/** The names the engine reads, name to source. */
	readonly vocabulary: Readonly<Record<string, string>>;
	/** The allowlist file's text, or null for no file. */
	readonly allowlist?: string | null;
}

/** A throwaway tree holding the pages, the vocabulary file and the allowlist. */
function checkout(fixture: Fixture): { root: string; vocabulary: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "keyword-docs-"));
	roots.push(root);
	const content = path.join(root, "docs", "src", "content", "docs");
	fs.mkdirSync(path.join(content, "syntax"), { recursive: true });
	fs.mkdirSync(path.join(content, "guide"), { recursive: true });
	fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
	for (const [name, text] of Object.entries(fixture.pages ?? {})) fs.writeFileSync(path.join(content, "syntax", name), text);
	for (const [name, text] of Object.entries(fixture.guide ?? {})) fs.writeFileSync(path.join(content, "guide", name), text);
	if (fixture.allowlist != null) fs.writeFileSync(path.join(root, "scripts", "keyword-docs-allowlist.json"), fixture.allowlist);
	const vocabulary = path.join(root, "vocabulary.json");
	// Written by hand rather than by JSON.stringify, so a name spelled
	// `__proto__` reaches the file as a key rather than being dropped.
	const entries = Object.keys(fixture.vocabulary).map((name) => `${JSON.stringify(name)}: ${JSON.stringify(fixture.vocabulary[name])}`);
	fs.writeFileSync(vocabulary, `{${entries.join(",")}}`);
	return { root, vocabulary };
}

function run(fixture: Fixture): { status: number | null; out: string; ms: number } {
	const { root, vocabulary } = checkout(fixture);
	const started = Date.now();
	const result = spawnSync(process.execPath, [SCRIPT, `--root=${root}`, `--vocabulary=${vocabulary}`], { encoding: "utf8", timeout: 30_000 });
	return { status: result.status, out: `${result.stdout}${result.stderr}`, ms: Date.now() - started };
}

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

const PAGE = (body: string): string => `---\ntitle: A page\n---\n\n${body}\n`;

describe("a name is documented when a syntax page mentions it", () => {
	test("every name mentioned passes, and the summary counts words and phrases", () => {
		const result = run({
			pages: { "number-functions.md": PAGE("`pow(2, 10)` is a power.\n\n```solve\natan2(1, 1) // 0.79\n```"), "dates.md": PAGE("Ask what day is it on a date.") },
			vocabulary: { pow: "core function", atan2: "core function", "what day is it on": "solve-datetime phrase" },
		});
		expect(result.status).toBe(0);
		expect(result.out).toContain("Every name the engine reads is on a syntax page: 2 word(s) and 1 phrase(s), 0 set aside");
	});

	test("a name on no page fails, naming it and where it comes from, and no other", () => {
		const result = run({ pages: { "a.md": PAGE("sinh is here.") }, vocabulary: { sinh: "core function", vec3: "core keyword" } });
		expect(result.status).toBe(1);
		expect(result.out).toContain("These 1 name(s) the engine reads appear on no syntax page:\n  vec3  (core keyword)\n");
		expect(result.out).not.toContain("sinh  (");
	});

	test("the missing names are listed in order, so a run reads the same twice", () => {
		const result = run({ pages: { "a.md": PAGE("nothing") }, vocabulary: { zeta: "x", alpha: "x", mid: "x" } });
		expect(result.out.indexOf("  alpha")).toBeLessThan(result.out.indexOf("  mid"));
		expect(result.out.indexOf("  mid")).toBeLessThan(result.out.indexOf("  zeta"));
	});

	test("a mention counts in prose, in inline code and in an example block alike", () => {
		for (const body of ["cosh is hyperbolic", "`cosh(1)`", "```solve\ncosh(1) // 1.54\n```"]) {
			expect(run({ pages: { "a.md": PAGE(body) }, vocabulary: { cosh: "core function" } }).status).toBe(0);
		}
	});

	test("the match ignores case both ways", () => {
		expect(run({ pages: { "a.md": PAGE("NCR and nCr") }, vocabulary: { ncr: "core function" } }).status).toBe(0);
		expect(run({ pages: { "a.md": PAGE("compoundInterest(1000, 5%, 3)") }, vocabulary: { compoundinterest: "core function" } }).status).toBe(0);
	});

	test("a phrase counts across a wrapped line and a run of spaces", () => {
		const result = run({ pages: { "a.md": PAGE("ask how much per month\nto   reach a target") }, vocabulary: { "how much per month to reach": "solve-finance phrase" } });
		expect(result.status).toBe(0);
	});
});

describe("what does not count as a mention", () => {
	test("a name inside a longer word does not count: pow inside modpow", () => {
		const result = run({ pages: { "number-theory.md": PAGE("`modpow(3, 4, 5)` and powmod and pow_x and xpow") }, vocabulary: { pow: "core function" } });
		expect(result.status).toBe(1);
		expect(result.out).toContain("  pow  (core function)");
	});

	test("a name in the frontmatter does not count, since it is not on the page", () => {
		const result = run({ pages: { "a.md": "---\ntitle: sinh\ndescription: sinh\n---\n\nnothing\n" }, vocabulary: { sinh: "core function" } });
		expect(result.status).toBe(1);
	});

	test("the generated unit reference does not count", () => {
		const result = run({ pages: { "unit-reference.md": PAGE("kn kj mw") }, vocabulary: { kn: "solve-derived-units as converter" } });
		expect(result.status).toBe(1);
	});

	test("a page outside syntax does not count", () => {
		const result = run({ pages: { "a.md": PAGE("nothing") }, guide: { "embedding.md": PAGE("vec2 vec3 vec4") }, vocabulary: { vec2: "core keyword" } });
		expect(result.status).toBe(1);
	});

	test("with no syntax pages at all, every name is missing", () => {
		const result = run({ vocabulary: { a1: "x", b2: "x" } });
		expect(result.status).toBe(1);
		expect(result.out).toContain("These 2 name(s)");
	});
});

describe("the allowlist sets a name aside, with a reason, and cannot go stale", () => {
	test("an allowlisted name passes, and the summary says how many are set aside", () => {
		const result = run({ pages: { "a.md": PAGE("nothing") }, vocabulary: { mul: "core keyword" }, allowlist: JSON.stringify({ $comment: "why", mul: "pending #829" }) });
		expect(result.status).toBe(0);
		expect(result.out).toContain("1 set aside in scripts/keyword-docs-allowlist.json");
	});

	test("an entry whose name a page now mentions is stale", () => {
		const result = run({ pages: { "a.md": PAGE("6 mul 7") }, vocabulary: { mul: "core keyword" }, allowlist: JSON.stringify({ mul: "pending" }) });
		expect(result.status).toBe(1);
		expect(result.out).toContain("  mul (a syntax page mentions it)");
	});

	test("an entry whose name the engine no longer reads is stale", () => {
		const result = run({ pages: { "a.md": PAGE("x") }, vocabulary: {}, allowlist: JSON.stringify({ retired: "gone" }) });
		expect(result.status).toBe(1);
		expect(result.out).toContain("  retired (the engine no longer reads it)");
	});

	test("an entry matches whatever its case", () => {
		const result = run({ pages: { "a.md": PAGE("x") }, vocabulary: { ncr: "core function" }, allowlist: JSON.stringify({ NCR: "alias" }) });
		expect(result.status).toBe(0);
	});

	test("with no allowlist file, nothing is set aside", () => {
		const result = run({ pages: { "a.md": PAGE("sinh") }, vocabulary: { sinh: "x" }, allowlist: null });
		expect(result.status).toBe(0);
		expect(result.out).toContain("0 set aside");
	});

	test("the repository's allowlist gives every entry a reason", () => {
		const parsed = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")) as Record<string, unknown>;
		for (const [name, reason] of Object.entries(parsed)) {
			expect({ name, reason: typeof reason === "string" && reason.trim().length > 20 }).toEqual({ name, reason: true });
		}
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a name spelled %s is a name like any other, missing or found", (word) => {
		const missing = run({ pages: { "a.md": PAGE("nothing") }, vocabulary: { [word]: "hostile" } });
		expect(missing.status).toBe(1);
		expect(missing.out).toContain(`  ${word.toLowerCase()}  (hostile)`);
		const found = run({ pages: { "a.md": PAGE(`the word ${word} here`) }, vocabulary: { [word]: "hostile" } });
		expect(found.status).toBe(0);
	});

	test("an allowlist entry spelled __proto__ is an entry, not a lookup", () => {
		const result = run({ pages: { "a.md": PAGE("x") }, vocabulary: { ["__proto__"]: "hostile" }, allowlist: '{"__proto__": "a reason long enough to count"}' });
		expect(result.status).toBe(0);
	});

	test("a name holding pattern syntax is matched as the text it is", () => {
		for (const name of ["≈", "c++", "a.b", "(x)", "[a-z]", "a|b", "\\d"]) {
			expect(run({ pages: { "a.md": PAGE(`see ${name} here`) }, vocabulary: { [name]: "x" } }).status).toBe(0);
		}
		// `a.b` must not match `axb`, which a pattern built from the name would.
		expect(run({ pages: { "a.md": PAGE("axb") }, vocabulary: { "a.b": "x" } }).status).toBe(1);
	});

	test("a page of a million repeated characters is read within the budget", () => {
		const result = run({ pages: { "a.md": PAGE("x".repeat(1_000_000)) }, vocabulary: { x: "x", xx: "x", y: "x" } });
		expect(result.status).toBe(1);
		expect(result.out).toContain("  y  (x)");
		expect(result.ms).toBeLessThan(15_000);
	});

	test("markup around a name does not hide it, and markup-shaped names are text", () => {
		expect(run({ pages: { "a.md": PAGE("<b>sinh</b> and **cosh**") }, vocabulary: { sinh: "x", cosh: "x" } }).status).toBe(0);
		expect(run({ pages: { "a.md": PAGE("<script>") }, vocabulary: { "<script>": "x" } }).status).toBe(0);
	});

	test("a zero-width character inside a word stops it counting as the name", () => {
		// sinh with a zero-width space inside it looks like sinh, and is not the
		// word a reader would search for.
		expect(run({ pages: { "a.md": PAGE("si​nh") }, vocabulary: { sinh: "x" } }).status).toBe(1);
	});
});

describe("adversarial: realistic breakage and edges", () => {
	test("CRLF pages and a trailing newline read the same as LF", () => {
		const result = run({ pages: { "a.md": "---\r\ntitle: A\r\n---\r\n\r\nweek number\r\nof a date\r\n" }, vocabulary: { "week number of": "phrase" } });
		expect(result.status).toBe(0);
	});

	test("a name at the very start or end of a page counts", () => {
		expect(run({ pages: { "a.md": "sinh" }, vocabulary: { sinh: "x" } }).status).toBe(0);
		expect(run({ pages: { "a.md": PAGE("the last word is tanh") }, vocabulary: { tanh: "x" } }).status).toBe(0);
	});

	test("a name that is a digit, or has digits in it, keeps its word boundary", () => {
		expect(run({ pages: { "a.md": PAGE("log10(100)") }, vocabulary: { log1: "x" } }).status).toBe(1);
		expect(run({ pages: { "a.md": PAGE("vec3(1, 2, 3)") }, vocabulary: { vec3: "x" } }).status).toBe(0);
	});

	test("the check reads the engine's names, not a fixture, when no vocabulary is given, and says how to build it", () => {
		// With a root that has no built engine beside it, the real run reads this
		// repository's dist. Only the message is asserted when it is missing.
		const root = checkout({ vocabulary: {} }).root;
		const result = spawnSync(process.execPath, [SCRIPT, `--root=${root}`], { encoding: "utf8", timeout: 60_000 });
		const out = `${result.stdout}${result.stderr}`;
		if (!fs.existsSync(path.join(REPO, "packages/engine/dist/index.js"))) {
			expect(out).toContain("Run `npm run build` first.");
		} else {
			// Every name is missing from an empty tree, which proves the names came from the engine.
			expect(out).toMatch(/These \d{3,} name\(s\) the engine reads appear on no syntax page/);
			expect(out).toContain("  atan2  (core function)");
			expect(out).toContain("  what day is it on  (solve-datetime phrase)");
		}
	});
});
