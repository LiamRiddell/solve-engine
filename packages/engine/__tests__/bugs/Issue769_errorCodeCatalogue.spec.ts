import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { newTrackedEngine } from "@tools/trackedEngine";
import { DOCUMENT_EDGES, NUMERIC_EDGES, PROTOTYPE_WORDS, TEXT_EDGES, evaluateLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ERROR_CODE_CATALOGUES, isCataloguedErrorCode } from "@solve-js/packages/ErrorCodeCatalogue";
import { ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Issue #769: error codes had no catalogue. `INCOMPATIBLE_UNITS`, which the
 * quick start teaches a host to read, was in no exported list, and 221 of the
 * 251 codes the source raised were in none. Every code the engine and its
 * built-in packages raise is now in a catalogue a host can read
 * (`ERROR_CODE_CATALOGUES`, with `isCataloguedErrorCode`), the error code
 * reference is generated from those catalogues, `npm run lint:error-codes`
 * fails on a code raised that no catalogue lists, and a snapshot fails on a
 * code renamed or removed.
 *
 * This file is the document-level half: whatever a reader types, the code that
 * reaches the host is one the catalogue lists. The parts are tested beside
 * them: `errors/ErrorCodeCatalogueSnapshot.spec.ts` (the snapshot and
 * `isCataloguedErrorCode`), `errors/ErrorCodeReachability.spec.ts` (an example
 * or a reason for every code) and `hardening/ErrorCodesCheck.spec.ts` (the
 * lint, over fixtures).
 */

/** Every code on a document's lines and inline solves. */
function documentCodes(result: ParsingResult): string[] {
	const codes: string[] = [];
	for (const line of result.lines) {
		if (line.errorCode) codes.push(line.errorCode);
		if (line.result?.type === ValueType.Error) codes.push(String(line.result.value));
		for (const solve of line.inlineSolves) {
			if (solve.errorCode) codes.push(solve.errorCode);
			if (solve.result?.type === ValueType.Error) codes.push(String(solve.result.value));
		}
	}
	return codes;
}

/** The code a line reaches a host with, if it fails. */
function lineCode(line: string): string | null {
	const outcome = evaluateLine(line);
	return outcome.kind === "thrown" || outcome.kind === "error" ? outcome.code : null;
}

/** Forms from across the packages, each with a hole the corpora fill. */
const FORMS = [
	"X + 1", "sqrt(X)", "X kg in m", "X as %", "X% of 200", "round(X, 2)", "factor(X)", "X!", "total of X, 2",
	"X as roman", "hosts in X", "X as iso8601", "sin(X)", "[X, 2] * 3", "npv of X, 300 at 10%", "X to 5", "check X < 3",
	"map(x * 2, X)", "X from base64", "5 in X", "time in X", "stock(X)",
];

describe("the codes a host can receive are all catalogued", () => {
	test("the code the quick start teaches is catalogued, and a line produces it", () => {
		expect(lineCode("5 kg to m")).toBe("INCOMPATIBLE_UNITS");
		expect(ERROR_CODE_CATALOGUES.CoreErrorCodes.INCOMPATIBLE_UNITS).toBe("INCOMPATIBLE_UNITS");
		expect(lineCode("10 +")).toBe("UNEXPECTED_END_OF_INPUT");
		expect(isCataloguedErrorCode("UNEXPECTED_END_OF_INPUT")).toBe(true);
	});

	test("the issue's table: every code it named is in a catalogue now", () => {
		for (const code of ["INCOMPATIBLE_UNITS", "UNIT_AFTER_UNIT", "NO_PREFIX_PARSELET", "UNEXPECTED_TOKEN_TYPE", "GOAL_SEEK_LINE_NOT_READY", "WHAT_IF_WRITES_GLOBAL", "PACKAGE_ENGINE_VERSION_MISMATCH"]) {
			expect({ code, catalogued: isCataloguedErrorCode(code) }).toEqual({ code, catalogued: true });
		}
		// The incremental pass's own name for a failed line is retired rather than catalogued (#709).
		expect(isCataloguedErrorCode("eval_failed")).toBe(false);
	});

	test("adversarial: every form filled with the numeric, text and prototype edges fails, if it fails, with a catalogued code", () => {
		const uncatalogued = new Set<string>();
		expectPrototypeUntouched(() => {
			for (const form of FORMS) {
				for (const line of [...fill(form, NUMERIC_EDGES), ...fill(form, TEXT_EDGES), ...fill(form, PROTOTYPE_WORDS)]) {
					const code = lineCode(line);
					if (code !== null && !isCataloguedErrorCode(code)) uncatalogued.add(`${code} <- ${JSON.stringify(line)}`);
				}
			}
		});
		expect([...uncatalogued]).toEqual([]);
	});

	test("adversarial: the document edges, through both passes, fail only with catalogued codes", () => {
		const uncatalogued: string[] = [];
		for (const text of [...DOCUMENT_EDGES, ...DOCUMENT_EDGES.map((doc) => `${doc}\n3 + * 4\nline 99\nsolve line 1 for x = 3`)]) {
			for (const result of [newTrackedEngine().parseDocument(text), evaluateDocument(newTrackedEngine(), text)]) {
				for (const code of documentCodes(result)) if (!isCataloguedErrorCode(code)) uncatalogued.push(`${code} <- ${JSON.stringify(text)}`);
			}
		}
		expect(uncatalogued).toEqual([]);
	});
});

describe("the error code reference", () => {
	const PAGE = path.resolve(__dirname, "../../../../docs/src/content/docs/guide/error-codes.md");

	test("lists every catalogued code, each once per catalogue it is in", () => {
		const page = fs.readFileSync(PAGE, "utf8");
		const missing: string[] = [];
		for (const catalogue of Object.values(ERROR_CODE_CATALOGUES)) {
			for (const code of Object.values(catalogue) as string[]) if (!page.includes(`| \`${code}\` |`)) missing.push(code);
		}
		expect(missing).toEqual([]);
	});

	test("gives every code a sentence", () => {
		const page = fs.readFileSync(PAGE, "utf8");
		const rows = page.split("\n").filter((line) => /^\| `[^`]+` \|/.test(line));
		expect(rows.filter((row) => row.split(" | ")[2]?.trim().replace(/\|$/, "").trim().length < 10)).toEqual([]);
	});
});
