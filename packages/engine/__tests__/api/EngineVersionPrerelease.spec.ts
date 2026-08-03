import { describe, expect, test } from "@jest/globals";
import { checkEngineVersionCompatibility } from "@solve-js/api/EngineVersionCompatibility";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";

/**
 * A prerelease engine must still accept packages written for the release it is
 * a prerelease of.
 *
 * Semver sorts `1.0.0-beta.0` below `1.0.0`, so a naive `satisfies` call puts
 * it outside `^1.0.0`. Shipping that would mean the 1.0.0 beta rejecting every
 * package declaring compatibility with 1.0.0, which is the entire audience the
 * beta exists for.
 */
describe("engine version gate against a prerelease engine", () => {
	const pkg = (range: string): IEnginePackage =>
		({ name: `range-${range}`, engineVersion: range }) as IEnginePackage;

	test("a ^1.0.0 package registers against a 1.0.0-beta engine", () => {
		expect(checkEngineVersionCompatibility(pkg("^1.0.0"), "1.0.0-beta.0").compatible).toBe(true);
		expect(checkEngineVersionCompatibility(pkg("^1.0.0"), "1.0.0-beta.7").compatible).toBe(true);
	});

	test("an outdated ^0.1.0 package is still rejected", () => {
		const result = checkEngineVersionCompatibility(pkg("^0.1.0"), "1.0.0-beta.0");
		expect(result.compatible).toBe(false);
		expect(result.reason).toBe("range-not-satisfied");
	});

	test("ordinary release comparisons are unchanged", () => {
		expect(checkEngineVersionCompatibility(pkg("^1.0.0"), "1.2.3").compatible).toBe(true);
		expect(checkEngineVersionCompatibility(pkg("^1.0.0"), "2.0.0").compatible).toBe(false);
		expect(checkEngineVersionCompatibility(pkg("^0.1.0"), "0.1.5").compatible).toBe(true);
	});

	test("a malformed range is still reported as invalid, not as a mismatch", () => {
		const result = checkEngineVersionCompatibility(pkg("not-a-range"), "1.0.0-beta.0");
		expect(result.compatible).toBe(false);
		expect(result.reason).toBe("invalid-range");
	});
});
