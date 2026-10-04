import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { ERROR_CODE_CATALOGUES, isCataloguedErrorCode } from "@solve-js/packages/ErrorCodeCatalogue";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";

/**
 * Issue #769: the error code catalogue only grows.
 *
 * A code a host can receive keeps its name (the versioning guide says so), and
 * this is what makes that a checked promise rather than a stated one. The
 * committed `ErrorCodeCatalogue.snapshot.json` beside this file lists every
 * catalogue and every code in it. A code renamed or removed fails the first
 * test here: the fix is to put it back, since a host may be branching on it. A
 * code added fails the second until it is added to the snapshot too, which is
 * the moment to check its name, because from then on it cannot change.
 *
 * Messages are not in the snapshot. They are prose for the reader and may be
 * reworded in any release.
 */

const SNAPSHOT_FILE = path.resolve(__dirname, "ErrorCodeCatalogue.snapshot.json");
const SNAPSHOT: Readonly<Record<string, readonly string[]>> = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
const SOURCE = path.resolve(__dirname, "../../src");

/** The catalogues as they are now, each code list sorted, in the snapshot's shape. */
function current(): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const [name, catalogue] of Object.entries(ERROR_CODE_CATALOGUES)) out[name] = (Object.values(catalogue) as string[]).slice().sort();
	return out;
}

/** Every TypeScript file under a directory. */
function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sourceFiles(full));
		else if (entry.name.endsWith(".ts")) out.push(full);
	}
	return out;
}

describe("no code a host can receive is renamed or removed", () => {
	test("every catalogue and code in the snapshot is still catalogued where it was", () => {
		const now = current();
		const gone: string[] = [];
		for (const [name, codes] of Object.entries(SNAPSHOT)) {
			const kept = new Set(now[name] ?? []);
			for (const code of codes) if (!kept.has(code)) gone.push(`${name}.${code}`);
		}
		expect(gone).toEqual([]);
	});

	test("and every catalogued code is in the snapshot, so a new one is added there deliberately", () => {
		const added: string[] = [];
		for (const [name, codes] of Object.entries(current())) {
			const known = new Set(SNAPSHOT[name] ?? []);
			for (const code of codes) if (!known.has(code)) added.push(`${name}.${code}`);
		}
		expect(added).toEqual([]);
	});
});

describe("the catalogues", () => {
	test("gather every catalogue the source defines", () => {
		const defined = new Set<string>();
		for (const file of sourceFiles(SOURCE)) {
			for (const match of fs.readFileSync(file, "utf8").matchAll(/export const (\w+ErrorCode(?:s|Patterns)) = \{/g)) defined.add(match[1]);
		}
		expect([...defined].sort()).toEqual(Object.keys(ERROR_CODE_CATALOGUES).sort());
	});

	test("hold no code twice within one catalogue", () => {
		const repeats = Object.entries(current()).filter(([, codes]) => new Set(codes).size !== codes.length);
		expect(repeats).toEqual([]);
	});

	test("name every code in upper case, with only the run-time patterns carrying a placeholder", () => {
		const odd: string[] = [];
		for (const [name, codes] of Object.entries(current())) {
			for (const code of codes) {
				const shape = name === "QueryResolverErrorCodePatterns" ? /^<NAMESPACE>_[A-Z][A-Z0-9_]*$/ : /^[A-Z][A-Z0-9_]*$/;
				if (!shape.test(code)) odd.push(`${name}.${code}`);
			}
		}
		expect(odd).toEqual([]);
	});

	test("include the codes the quick start teaches", () => {
		expect(ERROR_CODE_CATALOGUES.CoreErrorCodes.INCOMPATIBLE_UNITS).toBe("INCOMPATIBLE_UNITS");
		expect(ERROR_CODE_CATALOGUES.CoreErrorCodes.UNEXPECTED_END_OF_INPUT).toBe("UNEXPECTED_END_OF_INPUT");
	});
});

describe("isCataloguedErrorCode", () => {
	test("a catalogued code, from the core and from a package", () => {
		expect(isCataloguedErrorCode("INCOMPATIBLE_UNITS")).toBe(true);
		expect(isCataloguedErrorCode("NO_PREFIX_PARSELET")).toBe(true);
		expect(isCataloguedErrorCode("IRR_NONE")).toBe(true);
		expect(isCataloguedErrorCode("TEXT_PATTERN_INVALID")).toBe(true);
	});

	test("a code named at run time after a resolver's namespace", () => {
		expect(isCataloguedErrorCode("CRYPTO_QUERY_FAILED")).toBe(true);
		expect(isCataloguedErrorCode("STOCKS-CURRENT_QUERY_FAILED")).toBe(true);
		expect(isCataloguedErrorCode("WEATHER_NOT_PREFLIGHTED")).toBe(true);
	});

	test("the boundaries of a pattern: no namespace, a lower-case one, the placeholder itself", () => {
		expect(isCataloguedErrorCode("_QUERY_FAILED")).toBe(false);
		expect(isCataloguedErrorCode("crypto_QUERY_FAILED")).toBe(false);
		expect(isCataloguedErrorCode("<NAMESPACE>_QUERY_FAILED")).toBe(false);
		expect(isCataloguedErrorCode("CRYPTO_QUERY_FAILED_")).toBe(false);
	});

	test("a code no catalogue lists, the retired incremental-pass names among them", () => {
		expect(isCataloguedErrorCode("NOT_A_CODE")).toBe(false);
		expect(isCataloguedErrorCode("eval_failed")).toBe(false);
		expect(isCataloguedErrorCode("exec_failed")).toBe(false);
		expect(isCataloguedErrorCode("incompatible_units")).toBe(false);
		expect(isCataloguedErrorCode("")).toBe(false);
	});

	test("adversarial: inherited property names, look-alike characters, a huge string and a non-string", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) expect(isCataloguedErrorCode(word)).toBe(false);
			// A Cyrillic A and a zero-width space inside an otherwise real code.
			expect(isCataloguedErrorCode("INCOMPАTIBLE_UNITS")).toBe(false);
			expect(isCataloguedErrorCode("INCOMPATIBLE​_UNITS")).toBe(false);
			// A namespace of any length matches; the pattern is linear, so a long
			// one costs a pass over the string and no more.
			expect(isCataloguedErrorCode(`${"A".repeat(200_000)}_QUERY_FAILED`)).toBe(true);
			expect(isCataloguedErrorCode("A".repeat(200_000))).toBe(false);
			expect(isCataloguedErrorCode(undefined as unknown as string)).toBe(false);
			expect(isCataloguedErrorCode({ toString: () => "INCOMPATIBLE_UNITS" } as unknown as string)).toBe(false);
		});
	});
});
