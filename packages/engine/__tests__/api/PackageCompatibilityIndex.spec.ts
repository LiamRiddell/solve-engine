/**
 * The incremental PackageCompatibilityIndex must return exactly what the pairwise
 * checkPackageCompatibility would, package for package. This pins that
 * equivalence so the O(n) index can never silently drift from the O(n^2)
 * reference it replaces on the engine's construction path.
 */
import { describe, expect, test } from "@jest/globals";
import { checkPackageCompatibility, PackageCompatibilityIndex } from "@solve-js/api/PackageCompatibility";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { PrefixParselet } from "@solve-js/parser/Parselet";

class NoopParselet implements PrefixParselet {
	readonly category = "Test";
	parse(): void { /* no-op */ }
}

/** Register packages one at a time through both paths and assert step-by-step parity. */
function assertParity(pkgs: IEnginePackage[]): void {
	const index = new PackageCompatibilityIndex();
	const seen: IEnginePackage[] = [];
	for (const pkg of pkgs) {
		const pairwise = checkPackageCompatibility(pkg, seen).conflicts;
		const incremental = index.check(pkg);
		expect(incremental).toEqual(pairwise);
		index.add(pkg);
		seen.push(pkg);
	}
}

describe("PackageCompatibilityIndex parity with checkPackageCompatibility", () => {
	test("the real built-in packages (the construction path) — zero conflicts, identical", () => {
		assertParity(BUILTIN_PACKAGES);
		// Also confirm the built-ins genuinely produce no conflicts, so the
		// equivalence above is meaningful and construction stays silent.
		const index = new PackageCompatibilityIndex();
		for (const pkg of BUILTIN_PACKAGES) {
			expect(index.check(pkg)).toEqual([]);
			index.add(pkg);
		}
	});

	test("crafted collisions across every category match the pairwise result", () => {
		const a: IEnginePackage = {
			name: "pkg-a",
			prefixParselets: { FOO: new NoopParselet() },
			infixParselets: { BAR: new NoopParselet() as never },
			phrases: { "total of": "TOTAL_OF" },
			asConverters: { roman: (v) => v },
			pluginFunctions: { shared: (args) => args[0] },
			normalizerRules: [{ name: "shared-rule", priority: 1, match: () => null }],
			lexerVocabulary: { keywords: { kw: "KW_A" }, operators: { "~": "OP_A" } },
			tokenCategories: { TOK: "keyword" },
		};
		const b: IEnginePackage = {
			name: "pkg-b",
			prefixParselets: { FOO: new NoopParselet() },       // collides
			infixParselets: { BAR: new NoopParselet() as never }, // collides
			phrases: { "total of": "SUM_OF" },                    // collides (different type)
			asConverters: { Roman: (v) => v },                    // collides (case-insensitive)
			pluginFunctions: { shared: (args) => args[0] },       // collides
			normalizerRules: [{ name: "shared-rule", priority: 2, match: () => null }], // collides
			lexerVocabulary: { keywords: { kw: "KW_B" }, operators: { "~": "OP_B" } },  // collide (different types)
			tokenCategories: { TOK: "operator" },                 // collides (different category)
		};
		const c: IEnginePackage = { name: "pkg-c", prefixParselets: { UNIQUE: new NoopParselet() } };

		assertParity([a, b, c]);
	});
});
