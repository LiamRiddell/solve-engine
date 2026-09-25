import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { createEngine } from "@solve-js/api/createEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { EngineError } from "@solve-js/errors/EngineError";
import { getTokenCategory } from "@solve-js/language/TokenCategoryMap";
import { numberValue } from "@solve-js/vm/Value";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";

/**
 * Issue #718: a package that failed to register was skipped with a console
 * error, and nothing a host could call said so. A strict engine now throws the
 * package's coded error, a callback is told of each failure, and the list of
 * what registered is public.
 */

const oldContract: IEnginePackage = { name: "old-contract", engineVersion: "^1.0.0", lexerVocabulary: {} };
const collider: IEnginePackage = { name: "collider", lexerVocabulary: { keywords: { sqrt: "COLLIDER_SQRT" } } };
const good: IEnginePackage = { name: "good-718", pluginFunctions: { seven718: () => numberValue(7) }, tokenCategories: { GOOD_718: "keyword" } };

/** Runs `work` with console.error and console.warn captured. */
function quietly<T>(work: () => T): { result: T; errors: string[] } {
	const errors: string[] = [];
	const [error, warn] = [console.error, console.warn];
	console.error = (message: string) => errors.push(message);
	console.warn = () => {};
	try {
		return { result: work(), errors };
	} finally {
		console.error = error;
		console.warn = warn;
	}
}

describe("strict", () => {
	test("throws the package's coded error for an engine version it does not satisfy", () => {
		expect(() => new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, oldContract], strict: true }))
			.toThrow(expect.objectContaining({ code: "PACKAGE_ENGINE_VERSION_MISMATCH" }));
	});

	test("and for a keyword a built-in already owns", () => {
		let thrown: unknown;
		try {
			createEngine({ extraPackages: [collider], strict: true });
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeInstanceOf(EngineError);
		expect((thrown as EngineError).code).toBe("PLUGIN_KEYWORD_COLLISION");
	});

	test("leaves nothing of the packages it had registered in the shared registries", () => {
		expect(getTokenCategory("GOOD_718")).toBeUndefined();
		expect(() => new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, good, oldContract], strict: true })).toThrow();
		expect(getTokenCategory("GOOD_718")).toBeUndefined();
	});

	test("changes nothing for packages that register", () => {
		const engine = createEngine({ extraPackages: [good], strict: true });
		expect(engine.getRegisteredPackages()).toContain("good-718");
		engine.unregisterPackage("good-718");
	});
});

describe("onPackageError", () => {
	test("is told of each failure once, in order, and the packages after them still register", () => {
		const seen: string[] = [];
		const { result: engine, errors } = quietly(() => new ExpressionEngine({
			packages: [...BUILTIN_PACKAGES, oldContract, collider, good],
			onPackageError: (pkg, error) => seen.push(`${pkg.name}: ${error.code}`),
		}));
		expect(seen).toEqual(["old-contract: PACKAGE_ENGINE_VERSION_MISMATCH", "collider: PLUGIN_KEYWORD_COLLISION"]);
		expect(errors).toEqual([]);
		expect(engine.getRegisteredPackages()).toContain("good-718");
		engine.unregisterPackage("good-718");
	});

	test("a callback that throws stops the build as strict does, with what it threw", () => {
		expect(() => new ExpressionEngine({
			packages: [...BUILTIN_PACKAGES, good, oldContract],
			onPackageError: () => {
				throw new Error("the host refuses");
			},
		})).toThrow("the host refuses");
		expect(getTokenCategory("GOOD_718")).toBeUndefined();
	});
});

describe("the default is unchanged", () => {
	test("a failing package is logged and left out, and the engine is built", () => {
		const { result: engine, errors } = quietly(() => new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, oldContract] }));
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatch(/Failed to register package "old-contract", so the engine is built without it/);
		expect(errors[0]).not.toMatch(/—/);
		expect(engine.getRegisteredPackages()).not.toContain("old-contract");
		expect(engine.evaluateExpression("2 + 2").toNumber()).toBe(4);
	});
});

describe("getRegisteredPackages", () => {
	test("lists every package in the order it registered", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		expect(engine.getRegisteredPackages()).toEqual(BUILTIN_PACKAGES.map((p) => p.name));
	});

	test("matches what unregisterPackage removes, and is a copy", () => {
		const engine = createEngine({ extraPackages: [good] });
		const before = engine.getRegisteredPackages();
		(before as string[]).length = 0;
		expect(engine.getRegisteredPackages()).toContain("good-718");
		expect(engine.unregisterPackage("good-718")).toBe(true);
		expect(engine.getRegisteredPackages()).not.toContain("good-718");
		expect(engine.getRegisteredPackages()).toHaveLength(BUILTIN_PACKAGES.length);
	});

	test("the same package passed twice is registered once", () => {
		const { result: engine } = quietly(() => new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, good, good] }));
		expect(engine.getRegisteredPackages().filter((n) => n === "good-718")).toHaveLength(1);
		engine.unregisterPackage("good-718");
	});
});
