/**
 * The shape of the `test.failing` cases in this directory.
 *
 * A `test.failing` passes when its body throws. Jest stops the body at the
 * first assertion that fails, so every assertion after that one never runs,
 * and every assertion BEFORE it can quietly change from failing to passing
 * without the run reporting anything: the test still fails, for a different
 * reason, and a different reason is invisible from outside.
 *
 * That is not a theoretical hazard, it is how the 1.0.0 conversion regression
 * survived a green suite. `UnitsCurrencyAndRates.spec.ts` covered
 * `60 km/h in m/s` with a `test.failing` that asserted the result type and
 * then its number. When the engine went from reporting a visible error to
 * answering `0.00 /s` (a conversion that had failed, read as the number zero
 * by the conversion after it, and dressed in the unit the reader asked for),
 * the type assertion started passing and the number assertion went on failing.
 * Nothing was reported. A differential run against the previous published
 * build is what eventually found it, and the case that should have found it
 * first was the case that hid it.
 *
 * So: one assertion per `test.failing`. Several cases sharing one cause become
 * several tests, generated in a loop where that is tidier. Any assertion that
 * holds today belongs in an ordinary `test` as the premise it is, where it is
 * checked rather than merely present.
 *
 * This is enforced here rather than left to review, because the convention is
 * only worth anything if the next person to add a case follows it, and the
 * failure mode of not following it is a silent one.
 */

import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

const HARDENING_DIR = __dirname;

/** Opens a test case, capturing which kind. */
const TEST_START = /\b(?:test|it)(\.failing)?\s*(?:\.each\([^)]*\))?\s*[(.]/;

/** An assertion. `expect.hasAssertions()` and friends are not ones. */
const ASSERTION = /\bexpect\s*\(/g;

/** Any `describe` also ends the case above it. */
const BLOCK_START = /\b(?:describe|beforeEach|afterEach|beforeAll|afterAll)\s*\(/;

/**
 * How many assertions each `test.failing` in `source` makes.
 *
 * Counted between one test's opening line and the next test or block boundary
 * rather than by parsing the body, which is enough because tests are written
 * one after another: anything between two of them is setup, and setup does not
 * assert. Over-counting is the safe direction anyway, since it reports a case
 * for a human to look at rather than passing one that should not.
 */
function failingCaseAssertionCounts(source: string): Array<{ line: number; count: number; title: string }> {
	const lines = source.split("\n");
	const found: Array<{ line: number; count: number; title: string }> = [];
	let open: { line: number; count: number; title: string } | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const start = TEST_START.exec(line);
		if (start || BLOCK_START.test(line)) {
			if (open) found.push(open);
			open = start && start[1] === ".failing"
				? { line: i + 1, count: 0, title: line.trim().slice(0, 90) }
				: null;
		}
		if (open) open.count += (line.match(ASSERTION) ?? []).length;
	}
	if (open) found.push(open);
	return found;
}

describe("every test.failing in the hardening suite", () => {
	const files = fs.readdirSync(HARDENING_DIR).filter((name) => name.endsWith(".spec.ts"));

	test("there are hardening specs to check, so an empty pass is not possible", () => {
		expect(files.length).toBeGreaterThan(10);
	});

	test("asserts exactly one thing, so no assertion can hide behind another", () => {
		const offenders: string[] = [];
		for (const name of files) {
			const source = fs.readFileSync(path.join(HARDENING_DIR, name), "utf8");
			for (const found of failingCaseAssertionCounts(source)) {
				if (found.count > 1) offenders.push(`${name}:${found.line} makes ${found.count} assertions: ${found.title}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
