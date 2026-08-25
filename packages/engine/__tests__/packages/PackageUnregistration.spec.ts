/**
 * Package Unregistration — Registry Cleanup
 *
 * registerPackage() writes a package's contributions into the engine's
 * registries. These tests verify unregisterPackage() reverses exactly those
 * contributions (plan Task 2).
 */

import { describe, expect, test, jest } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { getTokenCategory } from "@solve-js/language/TokenCategoryMap";
import { OSRS_PACKAGE } from "@solve-js-examples/osrs/OsrsPackage";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { newTrackedEngine } from "@tools/trackedEngine";

/** A package whose only contribution is one completion item, to track cleanly. */
function makeCandidatePackage(label: string): IEnginePackage {
	return {
		name: "test-unregistration-pkg",
		completionItems: [{ label, category: "keyword" }],
	};
}

/** The labels a package has currently contributed to `engine`. */
function completionLabels(engine: ExpressionEngine): string[] {
	return engine.getPackageCompletionItems().map((item) => item.label);
}

describe("ExpressionEngine.unregisterPackage — registry cleanup", () => {
	test("a contribution is gone after unregistration", () => {
		const engine = newTrackedEngine({ packages: [] });
		const pkg = makeCandidatePackage("unregTestCandidate");

		engine.registerPackage(pkg);
		expect(completionLabels(engine)).toContain("unregTestCandidate");

		engine.unregisterPackage(pkg.name);
		expect(completionLabels(engine)).not.toContain("unregTestCandidate");
	});

	test("unregistering an unknown package returns false and changes nothing", () => {
		const engine = newTrackedEngine();
		expect(engine.unregisterPackage("never-registered")).toBe(false);
	});

	test("re-registering after unregistration works cleanly", () => {
		const engine = newTrackedEngine({ packages: [] });
		const pkg = makeCandidatePackage("reregTestCandidate");

		engine.registerPackage(pkg);
		engine.unregisterPackage(pkg.name);
		engine.registerPackage(pkg);

		expect(completionLabels(engine)).toContain("reregTestCandidate");
		expect(engine.unregisterPackage(pkg.name)).toBe(true);
		expect(completionLabels(engine)).not.toContain("reregTestCandidate");
	});

	test("unregistration clears the bytecode cache", () => {
		const engine = newTrackedEngine();
		const pkg = makeCandidatePackage("cacheTestCandidate");
		engine.registerPackage(pkg);

		engine.evaluateExpression("2 + 2");
		expect(engine.getBytecodeCache().size).toBeGreaterThan(0);

		engine.unregisterPackage(pkg.name);
		expect(engine.getBytecodeCache().size).toBe(0);
	});
});

describe("ExpressionEngine.registerPackage — duplicate-name guard", () => {
	// Regression: registerPackage() used to have no guard against being
	// called twice with the same pkg.name — the second call's contribution
	// record silently overwrote the first's in packageContributions, so the
	// FIRST registration's registry entries (completion items,
	// plugin-function indices, resolver namespaces, token categories) became
	// permanently orphaned: unregisterPackage() could then only reverse the
	// second registration, and the first's contributions were unreachable
	// for the rest of the process's lifetime.
	test("re-registering the same package name unregisters the previous registration first (no orphaned contribution)", () => {
		const engine = newTrackedEngine({ packages: [] });

		engine.registerPackage({ name: "dup-test-pkg", completionItems: [{ label: "dupFirst", category: "keyword" }] });
		expect(completionLabels(engine)).toEqual(["dupFirst"]);

		// Same name, different item — used to silently orphan the first
		// contribution instead of cleanly replacing it.
		engine.registerPackage({ name: "dup-test-pkg", completionItems: [{ label: "dupSecond", category: "keyword" }] });
		expect(completionLabels(engine)).toEqual(["dupSecond"]);

		// Unregistering once must fully clean up — if the first registration
		// had been orphaned, "dupFirst" would still be present here.
		expect(engine.unregisterPackage("dup-test-pkg")).toBe(true);
		expect(completionLabels(engine)).toEqual([]);
	});

	test("warns on the console when re-registering the same package name", () => {
		const engine = newTrackedEngine();
		const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

		engine.registerPackage({ name: "dup-warn-pkg" });
		expect(warnSpy).not.toHaveBeenCalled();

		engine.registerPackage({ name: "dup-warn-pkg" });
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dup-warn-pkg"));

		warnSpy.mockRestore();
		engine.unregisterPackage("dup-warn-pkg");
	});
});

describe("ExpressionEngine.unregisterPackage — token highlight category cleanup", () => {
	/** Token type in a range no builtin package uses. */
	const TEST_TOKEN_TYPE = "TEST_UNREGISTRATION_TOKEN";

	function makeHighlightPackage(): IEnginePackage {
		return {
			name: "test-highlight-unregistration-pkg",
			tokenCategories: { [TEST_TOKEN_TYPE]: "keyword" },
		};
	}

	afterEach(() => {
		// Safety net: never leak the test category into other suites.
		const engine = newTrackedEngine();
		engine.unregisterPackage("test-highlight-unregistration-pkg");
	});

	test("registerPackage makes the category resolvable via getTokenCategory", () => {
		const engine = newTrackedEngine();
		expect(getTokenCategory(TEST_TOKEN_TYPE)).toBeUndefined();

		engine.registerPackage(makeHighlightPackage());
		expect(getTokenCategory(TEST_TOKEN_TYPE)).toBe("keyword");
	});

	test("unregisterPackage removes the category again", () => {
		const engine = newTrackedEngine();
		engine.registerPackage(makeHighlightPackage());
		expect(getTokenCategory(TEST_TOKEN_TYPE)).toBe("keyword");

		expect(engine.unregisterPackage("test-highlight-unregistration-pkg")).toBe(true);
		expect(getTokenCategory(TEST_TOKEN_TYPE)).toBeUndefined();
	});

	test("re-registering after unregistration works cleanly", () => {
		const engine = newTrackedEngine();
		const pkg = makeHighlightPackage();

		engine.registerPackage(pkg);
		engine.unregisterPackage(pkg.name);
		engine.registerPackage(pkg);

		expect(getTokenCategory(TEST_TOKEN_TYPE)).toBe("keyword");
		expect(engine.unregisterPackage(pkg.name)).toBe(true);
		expect(getTokenCategory(TEST_TOKEN_TYPE)).toBeUndefined();
	});
});

describe("ExpressionEngine.unregisterPackage — lexer plugin cleanup (OSRS)", () => {
	test("OSRS-contributed keyword/item categories are registered while active, gone after unregister", () => {
		// OSRS is a builtin-adjacent but opt-in package (not in
		// BUILTIN_PACKAGES) — register it explicitly rather than assuming
		// default construction includes it.
		const engine = newTrackedEngine({ packages: [] });
		engine.registerPackage(OSRS_PACKAGE);

		expect(getTokenCategory("OSRS_KEYWORD")).toBe("keyword");
		expect(getTokenCategory("GAME_ITEM")).toBe("osrs-item");

		engine.unregisterPackage(OSRS_PACKAGE.name);
		expect(getTokenCategory("OSRS_KEYWORD")).toBeUndefined();
		expect(getTokenCategory("GAME_ITEM")).toBeUndefined();
	});
});

describe("ExpressionEngine.unregisterPackage — completionItems cleanup", () => {
	function makeCompletionPackage(): IEnginePackage {
		return {
			name: "test-completion-unregistration-pkg",
			completionItems: [{ label: "TestCandidate", category: "keyword" }],
		};
	}

	test("registerPackage makes the item queryable via getPackageCompletionItems, gone after unregister", () => {
		const engine = newTrackedEngine({ packages: [] });
		expect(engine.getPackageCompletionItems()).toEqual([]);

		engine.registerPackage(makeCompletionPackage());
		expect(engine.getPackageCompletionItems()).toEqual([{ label: "TestCandidate", category: "keyword" }]);

		expect(engine.unregisterPackage("test-completion-unregistration-pkg")).toBe(true);
		expect(engine.getPackageCompletionItems()).toEqual([]);
	});

	test("OSRS's real completionItems (item names) are queryable while active, gone after unregister", () => {
		const engine = newTrackedEngine({ packages: [] });
		engine.registerPackage(OSRS_PACKAGE);
		expect(engine.getPackageCompletionItems().some(i => i.label === "Iron Axe" && i.category === "osrs-item")).toBe(true);

		engine.unregisterPackage(OSRS_PACKAGE.name);
		expect(engine.getPackageCompletionItems()).toEqual([]);
	});
});
