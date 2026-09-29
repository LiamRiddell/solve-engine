import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * `scripts/check-error-codes.mjs` (#769): every code written at an
 * `errorValue` or `ErrorFactory` call is in a catalogue, every catalogued code
 * has the doc comment the reference page prints, and the page is what the
 * catalogues generate. Run over fixture sources through its `--root` option,
 * so each case is a real tree read the way the script reads the repository's.
 */

const SCRIPT = path.resolve(__dirname, "../../../../scripts/check-error-codes.mjs");
const PAGE = path.join("docs", "src", "content", "docs", "guide", "error-codes.md");

const roots: string[] = [];

/** A catalogue file with the codes given, each with a doc comment unless its doc is null. */
function catalogue(name: string, entries: [string, string | null][]): string {
	const body = entries.map(([code, doc]) => `${doc === null ? "" : `\t/** ${doc} */\n`}\t${code}: "${code}",`).join("\n");
	return `/** A fixture catalogue. */\nexport const ${name} = {\n${body}\n} as const;\n`;
}

/** A throwaway checkout holding the source files named, relative to packages/engine/src. */
function checkout(files: Record<string, string>): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "error-codes-"));
	roots.push(root);
	for (const [rel, text] of Object.entries(files)) {
		const full = path.join(root, "packages", "engine", "src", rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text);
	}
	return root;
}

function run(root: string | null, ...args: string[]): { status: number | null; out: string } {
	const argv = root === null ? [SCRIPT, ...args] : [SCRIPT, `--root=${root}`, ...args];
	const result = spawnSync(process.execPath, argv, { encoding: "utf8" });
	return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/**
 * A checkout whose page has been written, so a check then tests only the
 * codes. `--write` writes the page whatever else is wrong, and still fails on
 * it, so its status is not the point here.
 */
function written(files: Record<string, string>): string {
	const root = checkout(files);
	run(root, "--write");
	expect(fs.existsSync(path.join(root, PAGE))).toBe(true);
	return root;
}

afterEach(() => {
	while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

const CORE = catalogue("CoreErrorCodes", [["INCOMPATIBLE_UNITS", "Two quantities that do not measure the same thing."]]);

describe("a catalogued code passes and an uncatalogued one fails", () => {
	test("a code written at a call and listed in a catalogue passes, and the line says how many", () => {
		const root = written({
			"errors/ErrorCode.ts": CORE,
			"vm/VM.ts": 'return errorValue("INCOMPATIBLE_UNITS", "mass and length cannot be added");\n',
		});
		const result = run(root);
		expect(result.status).toBe(0);
		expect(result.out).toContain("Every code passed to errorValue or ErrorFactory is catalogued: 1 codes in 1 catalogues, 0 run-time pattern(s).");
	});

	test("a code no catalogue lists fails, naming the file, the line and the code", () => {
		const root = written({
			"errors/ErrorCode.ts": CORE,
			"vm/VM.ts": '\n\nreturn errorValue("NOT_CATALOGUED", "a message");\n',
		});
		const result = run(root);
		expect(result.status).toBe(1);
		expect(result.out).toContain("vm/VM.ts:3: NOT_CATALOGUED is in no catalogue");
	});

	test("both call shapes of ErrorFactory are read, the code first or as an object's code", () => {
		const root = written({
			"errors/ErrorCode.ts": CORE,
			"parser/Parser.ts": 'throw ErrorFactory.parsing("FIRST_SHAPE", "m");\nthrow ErrorFactory.parsing({\n  code: "SECOND_SHAPE",\n  message: "m",\n});\n',
		});
		const result = run(root);
		expect(result.status).toBe(1);
		expect(result.out).toContain("parser/Parser.ts:1: FIRST_SHAPE is in no catalogue");
		expect(result.out).toContain("parser/Parser.ts:2: SECOND_SHAPE is in no catalogue");
	});

	test("a code named through its catalogue, or through a constant of its name, is catalogued by construction", () => {
		const root = written({
			"errors/ErrorCode.ts": CORE,
			"vm/VM.ts": "return errorValue(CoreErrorCodes.INCOMPATIBLE_UNITS, m);\nreturn errorValue(INCOMPATIBLE_UNITS, m);\n",
		});
		expect(run(root).status).toBe(0);
	});
});

describe("a code built at run time", () => {
	const PATTERNS = "/** Run-time codes. */\nexport const QueryResolverErrorCodePatterns = {\n\t/** A fetch failed. */\n\tQUERY_FAILED: \"<NAMESPACE>_QUERY_FAILED\",\n} as const;\n";

	test("matching a declared pattern passes", () => {
		const root = written({
			"errors/ErrorCode.ts": CORE,
			"resolvers/QueryResolverErrorCodes.ts": PATTERNS,
			"resolvers/QueryResolver.ts": "errorValue(`${namespace.toUpperCase()}_QUERY_FAILED`, m);\n",
		});
		const result = run(root);
		expect(result.status).toBe(0);
		expect(result.out).toContain("1 run-time pattern(s)");
	});

	test("matching none fails", () => {
		const root = written({
			"errors/ErrorCode.ts": CORE,
			"resolvers/QueryResolverErrorCodes.ts": PATTERNS,
			"resolvers/QueryResolver.ts": "errorValue(`${namespace}_SOMETHING_ELSE`, m);\n",
		});
		const result = run(root);
		expect(result.status).toBe(1);
		expect(result.out).toContain("is built at run time and matches no declared pattern");
	});
});

describe("the catalogue and the page stay in step", () => {
	test("an entry with no doc comment fails, since the page would have nothing to say", () => {
		const root = checkout({ "errors/ErrorCode.ts": catalogue("CoreErrorCodes", [["UNDOCUMENTED", null]]) });
		const result = run(root, "--write");
		expect(result.status).toBe(1);
		expect(result.out).toContain("CoreErrorCodes.UNDOCUMENTED has no doc comment");
	});

	test("a page that is missing or stale fails, and --write brings it back in step", () => {
		const root = checkout({ "errors/ErrorCode.ts": CORE });
		expect(run(root).out).toContain("is not what the catalogues generate");
		expect(run(root, "--write").status).toBe(0);
		expect(run(root).status).toBe(0);
		fs.appendFileSync(path.join(root, PAGE), "\nAn edit by hand.\n");
		expect(run(root).status).toBe(1);
	});

	test("the page gives each code its sentence and how it arrives", () => {
		const root = written({
			"errors/ErrorCode.ts": catalogue("CoreErrorCodes", [
				["THROWN_ONE", "Raised by a throw."],
				["RETURNED_ONE", "Returned as a value."],
				["BOTH_WAYS", "Raised both ways."],
			]),
			"vm/VM.ts": 'throw ErrorFactory.execution("THROWN_ONE", m);\nerrorValue("RETURNED_ONE", m);\nerrorValue("BOTH_WAYS", m);\nthrow ErrorFactory.parsing("BOTH_WAYS", m);\n',
		});
		const page = fs.readFileSync(path.join(root, PAGE), "utf8");
		expect(page).toContain("| `THROWN_ONE` | thrown | Raised by a throw. |");
		expect(page).toContain("| `RETURNED_ONE` | as a value | Returned as a value. |");
		expect(page).toContain("| `BOTH_WAYS` | either | Raised both ways. |");
	});

	test("a package's catalogue is grouped under its package", () => {
		const root = written({
			"errors/ErrorCode.ts": CORE,
			"packages/finance/FinanceErrorCodes.ts": catalogue("FinanceErrorCodes", [["IRR_NONE", "No rate makes the flows zero."]]),
		});
		const page = fs.readFileSync(path.join(root, PAGE), "utf8");
		expect(page.indexOf("## The engine")).toBeLessThan(page.indexOf("## Finance"));
		expect(page).toContain("### FinanceErrorCodes");
	});
});

describe("adversarial", () => {
	test("markup in a doc comment is read as text: a pipe cannot end the table cell", () => {
		const root = written({ "errors/ErrorCode.ts": catalogue("CoreErrorCodes", [["PIPED", "A `a | b` pipe and <b>markup</b>."]]) });
		const page = fs.readFileSync(path.join(root, PAGE), "utf8");
		expect(page).toContain("| `PIPED` | either | A `a \\| b` pipe and <b>markup</b>. |");
	});

	test("a code named after an inherited property is uncatalogued like any other", () => {
		const root = written({
			"errors/ErrorCode.ts": CORE,
			"vm/VM.ts": 'errorValue("constructor", m);\nerrorValue("__proto__", m);\nerrorValue("toString", m);\n',
		});
		const result = run(root);
		expect(result.status).toBe(1);
		for (const word of ["constructor", "__proto__", "toString"]) expect(result.out).toContain(`${word} is in no catalogue`);
	});

	test("an empty source tree has no codes and nothing to fail on but the page", () => {
		const root = checkout({});
		expect(run(root, "--write").status).toBe(0);
		expect(run(root).out).toContain("0 codes in 0 catalogues");
	});

	test("a thousand call sites in one file are read in one pass", () => {
		const calls = Array.from({ length: 1000 }, (_, i) => `errorValue("CODE_${i}", m);`).join("\n");
		const root = written({ "errors/ErrorCode.ts": CORE, "vm/Many.ts": calls });
		const started = Date.now();
		const result = run(root);
		expect(result.status).toBe(1);
		expect(result.out).toContain("1000 error code problem(s)");
		expect(Date.now() - started).toBeLessThan(10_000);
	});
});

describe("the repository", () => {
	test("its own sources and page pass", () => {
		const result = run(null);
		expect(result.out).toMatch(/Every code passed to errorValue or ErrorFactory is catalogued/);
		expect(result.status).toBe(0);
	});
});
