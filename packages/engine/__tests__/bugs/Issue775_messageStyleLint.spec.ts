import { afterEach, describe, expect, test } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { PROTOTYPE_WORDS, TEXT_EDGES, evaluateLine, expectHonestLine, expectPrototypeUntouched } from "@tools/adversarial";
import { REPO_ROOT, callExport, removeTempTrees, runScript, tempTree } from "@tools/scriptHarness";

/**
 * Issue #775: error messages are prose a reader sees, and the comment-style
 * lint skipped string literals on purpose, so messages drifted: em-dashes, an
 * American "recognized", a `(3 !== 2)` shown to a reader, and a host's method
 * named in a line's result. `npm run lint:messages`
 * (scripts/check-message-style.mjs) reads the message arguments of
 * `errorValue`, `lineMessage`, `ErrorFactory`, `new EngineError` and
 * `console.warn`/`console.error` with the TypeScript parser and holds them to
 * the house voice. The flagged messages outside the files other changes own
 * are reworded; the ones those changes own (#836, #736) are listed as pending,
 * and an entry that stops matching fails the lint.
 *
 * The boundary: `35 mpg uk in l/100km` answering with a cooking error is
 * #736's to fix (it reads `mpg uk` as imperial mpg), so it is not pinned here.
 */

afterEach(removeTempTrees);

const EM = String.fromCodePoint(0x2014);

/** Lint one fixture engine source file and return the outcome. */
function lint(source: string, file = "packages/engine/src/vm/Fixture.ts", extra: Record<string, string> = {}) {
	const root = tempTree({ [file]: source, ...extra });
	return runScript("check-message-style.mjs", [`--root=${root}`]);
}

type Finding = { rule: string; hit: string; line: number; text: string; whole: string };
const findings = (source: string) => callExport<Finding[]>("check-message-style.mjs", "findViolations", ["fixture.ts", source]);

describe("the real engine source", () => {
	test("is clean, with only the messages other changes own pending", () => {
		const result = runScript("check-message-style.mjs");
		expect(result.out).toMatch(/Messages follow the house voice across \d+ file\(s\)/);
		expect(result.status).toBe(0);
	});

	test("every pending entry names an issue and a file that exists", () => {
		const pending = callExport<{ file: string; includes: string; owner: string }[]>("check-message-style.mjs", "PENDING");
		expect(pending.length).toBeGreaterThan(0);
		for (const p of pending) {
			expect(p.owner).toMatch(/^#\d+$/);
			expect(fs.existsSync(path.join(REPO_ROOT, p.file))).toBe(true);
		}
	});

	test("the lint is part of verify:ci", () => {
		const scripts = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).scripts;
		expect(scripts["lint:messages"]).toBe("node scripts/check-message-style.mjs");
		expect(scripts["verify:ci"]).toContain("npm run lint:messages");
	});
});

describe("what a reader sees now", () => {
	test("a category tag outside a document says a document is missing, not which method was called", () => {
		const outcome = evaluateLine("total of #food");
		expect(outcome).toEqual({ kind: "error", code: "TAG_NO_DOCUMENT", message: "Category tag sums need a document, and a line evaluated on its own has none" });
	});

	test("a ragged matrix names the row with a colon", () => {
		expect(evaluateLine("[1, 2; 3]")).toMatchObject({ code: "RAGGED_MATRIX_LITERAL", message: "Matrix literal rows must all have the same number of columns: row 2 has 1, but a previous row has 2." });
	});

	test("a rate times an unrelated unit says so in a sentence", () => {
		expect(evaluateLine("$5/hour * 3 kg")).toMatchObject({ code: "RATE_MUL_MEASURE_MISMATCH", message: "Cannot multiply a rate per hour by a quantity in kg: they measure different things, and together they make no unit." });
	});

	test("an ingredient with no density is refused without a dash", () => {
		expect(evaluateLine("1 cup unobtainium in grams")).toMatchObject({ code: "COOKING_UNKNOWN_INGREDIENT", message: "No density data for \"unobtainium\", so it cannot be converted between mass and volume" });
	});

	test("an async call in a function body is refused without a dash", () => {
		expect(evaluateLine("f(x) = weather in London")).toMatchObject({ code: "FUNCTION_BODY_MUST_BE_SYNCHRONOUS" });
		expect(JSON.stringify(evaluateLine("f(x) = weather in London"))).not.toContain(EM);
	});

	test("a sweep of refusals carries no em-dash, apart from the messages #836 owns", () => {
		const pendingFor836 = ["cannot be empty", "inner dimensions must match", "Cross-line references require a real document", "stored as an equation"];
		const lines = ["total of #food", "[1, 2; 3]", "$5/hour * 3 kg", "$5/hour in kg", "1 cup unobtainium in grams", "f(x) = weather in London", "5 m + 3 kg", "sqrt(-1 kg)", "1/0 kg"];
		for (const line of lines) {
			const outcome = evaluateLine(line);
			const message = "message" in outcome ? outcome.message : "";
			if (pendingFor836.some((p) => message.includes(p))) continue;
			expect({ line, dash: message.includes(EM) }).toEqual({ line, dash: false });
		}
	});
});

describe("the lint, against fixture sources", () => {
	test("an em-dash in an errorValue message fails, naming the file and line", () => {
		const result = lint(`export const v = () => errorValue("X", "one ${EM} two");\n`);
		expect(result.status).toBe(1);
		expect(result.out).toContain("packages/engine/src/vm/Fixture.ts:1: Em-dash in a message.");
	});

	test("an em-dash in a comment's code sample does not", () => {
		const result = lint(`// errorValue("X", "one ${EM} two") is the old shape\n/** e.g. \`lineMessage("a ${EM} b")\` */\nexport const v = 1;\n`);
		expect(result.status).toBe(0);
	});

	test("an em-dash in a string that is not a message does not", () => {
		expect(lint(`export const icon = "${EM}";\nexport const f = () => format("a ${EM} b");\n`).status).toBe(0);
	});

	test("each message helper is read, in each shape", () => {
		const shapes = [
			`errorValue("X", \`a ${EM} \${n}\`)`,
			`lineMessage("a " + "b ${EM} c")`,
			`ErrorFactory.parsing("X", "a ${EM} b")`,
			`ErrorFactory.config({ code: "X", message: "a", suggestion: "b ${EM} c" })`,
			`new EngineError({ code: "X", message: "a ${EM} b" })`,
			`console.warn("a ${EM} b")`,
			`console.error(\`[x] \${y} ${EM} z\`)`,
			`errorValue("X", flag ? "a ${EM} b" : "c")`,
		];
		for (const shape of shapes) expect({ shape, rules: findings(`${shape};`).map((f) => f.rule) }).toEqual({ shape, rules: ["em-dash"] });
	});

	test("the code and context of an error are data, not prose", () => {
		expect(findings(`ErrorFactory.parsing({ code: "A${EM}B", message: "fine", context: { token: "${EM}" } });`)).toEqual([]);
		expect(findings(`errorValue("A${EM}B", "fine");`)).toEqual([]);
	});

	test("an interpolated call's own arguments are its data", () => {
		expect(findings(`errorValue("X", \`value \${quote("${EM}")}\`);`)).toEqual([]);
	});

	test("American spelling fails and names the British form; an identifier containing one does not", () => {
		const hits = findings(`errorValue("X", "not a recognized unit");`);
		expect(hits.map((h) => [h.rule, h.hit])).toEqual([["american-spelling", 'recognized (write "recognised")']]);
		expect(findings(`errorValue("X", "not a recognised unit, see serializeValue and colorize");`)).toEqual([]);
		expect(findings(`errorValue("X", "Unrecognized COLOR");`).map((h) => h.hit)).toEqual(['Unrecognized (write "unrecognised")']);
	});

	test("a JavaScript comparison in a message fails", () => {
		expect(findings(`errorValue("X", \`sizes (\${a} !== \${b})\`);`).map((h) => h.rule)).toEqual(["code-operator"]);
		expect(findings(`console.warn("a === b");`).map((h) => h.rule)).toEqual(["code-operator"]);
	});

	test("a host method in a line's result fails, and in a host's error it does not", () => {
		expect(findings(`errorValue("X", "not in evaluateExpression()'s path");`).map((h) => h.rule)).toEqual(["api-name"]);
		expect(findings(`ErrorFactory.config("X", "Regenerate it with ExpressionEngine.toJSON()");`)).toEqual([]);
		expect(findings(`errorValue("X", "sqrt() takes one argument");`)).toEqual([]);
	});

	test("the whole message is kept with each finding, so a pending entry can name any fragment", () => {
		const [hit] = findings(`errorValue("X", \`Cannot multiply \${a} ${EM} inner (\${b})\`);`);
		expect(hit.whole).toBe(`Cannot multiply ... ${EM} inner (...)`);
	});

	test("a pending entry whose message is reworded fails as stale", () => {
		const result = lint("export const v = 1;\n", "packages/engine/src/packages/uom/parselets/CookingPluginFunctions.ts");
		expect(result.status).toBe(1);
		expect(result.out).toContain('PENDING entry for packages/engine/src/packages/uom/parselets/CookingPluginFunctions.ts ("is not a recognized", #736) matches no message any more.');
	});

	test("a pending entry still matching passes", () => {
		const result = lint(`export const v = (unit: string) => errorValue("COOKING_CONVERSION_UNSUPPORTED_UNIT", \`"\${unit}" is not a recognized mass or volume unit\`);\n`, "packages/engine/src/packages/uom/parselets/CookingPluginFunctions.ts");
		expect(result.status).toBe(0);
	});

	test("--count reports without failing", () => {
		const root = tempTree({ "packages/engine/src/a.ts": `errorValue("X", "a ${EM} b");\n` });
		const result = runScript("check-message-style.mjs", [`--root=${root}`, "--count"]);
		expect(result.status).toBe(0);
		expect(result.out).toContain("1 message-style violation(s)");
	});

	test("a root with no engine source is refused", () => {
		expect(runScript("check-message-style.mjs", [`--root=${tempTree({ "x.txt": "" })}`]).status).toBe(1);
	});
});

describe("adversarial: security", () => {
	test("prototype words as callees, owners and property names are ordinary text", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				expect(findings(`${word}("X", "a ${EM} b"); x.${word}("a ${EM} b"); ErrorFactory.config({ ${JSON.stringify(word)}: "a ${EM} b", message: "ok" });`)).toEqual([]);
			}
		});
	});

	test("markup- and injection-shaped message text is read as text", () => {
		for (const text of ["<script>alert(1)</script>", "'; DROP TABLE notes; --", "${5}", "%s%s%s%n"]) {
			expect(findings(`errorValue("X", ${JSON.stringify(text)});`)).toEqual([]);
		}
	});

	test("an em-dash written as an escape is still an em-dash", () => {
		expect(findings(`errorValue("X", "a \\u2014 b");`).map((h) => h.rule)).toEqual(["em-dash"]);
	});

	test("a look-alike dash is not an em-dash, and an en-dash is left alone", () => {
		expect(findings(`errorValue("X", "a – b ‒ c − d");`)).toEqual([]);
	});

	test("thousands of messages in one file are read within budget", () => {
		const source = Array.from({ length: 5_000 }, (_, i) => `errorValue("X${i}", "message ${i} is fine");`).join("\n");
		const started = Date.now();
		expect(findings(source)).toEqual([]);
		expect(Date.now() - started).toBeLessThan(20_000);
	});
});

describe("adversarial: realistic breakage", () => {
	test("a file that does not parse is read as far as it goes rather than crashing the lint", () => {
		const result = lint(`export const v = () => errorValue("X", "a ${EM} b"\n`);
		expect(result.out).not.toMatch(/TypeError|RangeError/);
		expect(result.status).toBe(1);
	});

	test("the reworded lines are answered honestly", () => {
		for (const line of ["total of #food", "$5/hour * 3 kg", "1 cup unobtainium in grams"]) expectHonestLine(line);
	});
});

describe("adversarial: edge cases", () => {
	test("an empty file, a CRLF file and a trailing newline", () => {
		expect(findings("")).toEqual([]);
		expect(findings(`errorValue("X", "a ${EM} b");\r\nerrorValue("Y", "fine");\r\n`).map((h) => h.line)).toEqual([1]);
	});

	test("an empty message and a message of only whitespace or edge text", () => {
		for (const text of TEXT_EDGES) expect(findings(`errorValue("X", ${JSON.stringify(text)});`)).toEqual([]);
	});

	test("errorValue with no message argument is skipped", () => {
		expect(findings(`errorValue("X");\nErrorFactory.parsing();\nconsole.warn();`)).toEqual([]);
	});
});
