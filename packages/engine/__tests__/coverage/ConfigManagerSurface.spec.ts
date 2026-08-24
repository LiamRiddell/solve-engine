/**
 * `ConfigManager`, published through the `solve-engine/constants` subpath.
 *
 * `integration/Configuration.spec.ts` covers the three ways `get()` and
 * `set()` can throw, plus the per-section merge. What it never does is call
 * `set()` successfully, or call `reset()`, `validate()` or `getConfig()` at
 * all, which left five of the class's eight functions unreached. Testing only
 * the throwing paths of a setter is a common shape, and it is how the defect
 * in the last block of this file survived: `reset()` copies one level deep,
 * and the level it does not copy is shared with a module-level constant every
 * engine in the process is built from.
 */

import { afterEach, describe, expect, test } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ConfigManager, DEFAULT_CONFIG } from "@solve-js/constants/Configuration";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { EngineError, ErrorCategory } from "@solve-js/errors/EngineError";

/*
 * Restore anything a test managed to write into the shared defaults, so a
 * failure in one case cannot change what the next one reads. The values are
 * the ones DEFAULT_CONFIG declares.
 */
const PRISTINE_CACHE_SIZE = 2000;
const PRISTINE_MAX_LINES = 100000;

afterEach(() => {
	DEFAULT_CONFIG.performance.defaultCacheSize = PRISTINE_CACHE_SIZE;
	DEFAULT_CONFIG.performance.maxDocumentLines = PRISTINE_MAX_LINES;
});

describe("get and set", () => {
	test("a set value is what comes back out", () => {
		const manager = new ConfigManager();
		manager.set("performance.defaultCacheSize", 4096);
		expect(manager.get<number>("performance.defaultCacheSize")).toBe(4096);
	});

	test("setting one property leaves the rest of its section alone", () => {
		/*
		 * A section is not replaced wholesale by a `section.property` write.
		 * If it were, setting one validation limit would silently drop the
		 * other three to undefined and every check reading them would stop
		 * checking.
		 */
		const manager = new ConfigManager();
		manager.set("validation.maxComplexity", 42);

		expect(manager.get<number>("validation.maxComplexity")).toBe(42);
		expect(manager.get<number>("validation.maxExpressionLength")).toBe(2000);
		expect(manager.get<number>("validation.maxNestingDepth")).toBe(50);
	});

	test("a path that names no section is refused rather than silently creating one", () => {
		/*
		 * Accepting `nonsense.thing` would look like it worked and change
		 * nothing, which is the worst outcome for a configuration API: the
		 * host believes it configured something.
		 */
		const manager = new ConfigManager();
		expect(() => manager.set("nonsense.thing", 1)).toThrow(EngineError);

		try {
			manager.set("nonsense.thing", 1);
		} catch (error) {
			expect((error as EngineError).category).toBe(ErrorCategory.CONFIG);
			expect((error as EngineError).code).toBe("CONFIG_SECTION_NOT_FOUND");
		}
	});

	test("a one-segment path is refused, since there is no property to write", () => {
		const manager = new ConfigManager();
		expect(() => manager.set("performance", 1)).toThrow(/section.property/);
	});

	test("two managers do not share their configuration", () => {
		/*
		 * Two engines in one process each have their own settings. If the
		 * constructor handed back a view onto the same objects, tuning one
		 * document's engine would retune every other one.
		 */
		const first = new ConfigManager();
		const second = new ConfigManager();

		first.set("performance.defaultCacheSize", 111);

		expect(second.get<number>("performance.defaultCacheSize")).toBe(PRISTINE_CACHE_SIZE);
	});

	test("a constructor override does not write into the shared defaults", () => {
		// The path the engine itself uses on every construction, so a leak
		// here would compound with every engine a host creates.
		const overridden = new ConfigManager({ performance: { defaultCacheSize: 7 } });
		expect(overridden.get<number>("performance.defaultCacheSize")).toBe(7);
		expect(DEFAULT_CONFIG.performance.defaultCacheSize).toBe(PRISTINE_CACHE_SIZE);
	});
});

describe("update", () => {
	test("merges per section rather than replacing the whole config", () => {
		const manager = new ConfigManager();
		manager.update({ vm: { maxInstructions: 123 } });

		expect(manager.get<number>("vm.maxInstructions")).toBe(123);
		// Other fields of the same section, and other sections entirely.
		expect(manager.get<number>("vm.maxStackDepth")).toBe(200);
		expect(manager.get<number>("validation.maxExpressionLength")).toBe(2000);
	});
});

describe("validate", () => {
	test("the shipped defaults are valid", () => {
		/*
		 * Not circular: `validate()` refuses more than 100,000 document lines
		 * and `DEFAULT_CONFIG` sets exactly 100,000, so the default sits on
		 * the boundary and a strict comparison in either place would make the
		 * engine's own defaults invalid.
		 */
		const report = new ConfigManager().validate();
		expect(report.valid).toBe(true);
		expect(report.error).toBe("");
	});

	test("refuses more than a hundred thousand document lines", () => {
		/*
		 * The ceiling is measured rather than arbitrary: `DEFAULT_CONFIG`'s
		 * own comment records that 200,000 lines aborts the process before a
		 * single expression is evaluated. Both sides of the boundary are
		 * checked so an off-by-one in the comparison is visible.
		 */
		const atLimit = new ConfigManager({ performance: { maxDocumentLines: 100000 } });
		expect(atLimit.validate().valid).toBe(true);

		const over = new ConfigManager({ performance: { maxDocumentLines: 100001 } });
		const report = over.validate();
		expect(report.valid).toBe(false);
		expect(report.error).toContain("maxDocumentLines");
	});

	test("refuses a date offset beyond a thousand years", () => {
		const atLimit = new ConfigManager({ date: { maxOffsetYears: 1000 } });
		expect(atLimit.validate().valid).toBe(true);

		const over = new ConfigManager({ date: { maxOffsetYears: 1001 } });
		expect(over.validate().valid).toBe(false);
		expect(over.validate().error).toContain("maxOffsetYears");
	});

	test("reports both problems at once rather than only the first", () => {
		// A host fixing configuration wants the whole list, not one round
		// trip per mistake.
		const both = new ConfigManager({
			performance: { maxDocumentLines: 200000 },
			date: { maxOffsetYears: 5000 },
		});
		const report = both.validate();

		expect(report.valid).toBe(false);
		expect(report.error).toContain("maxDocumentLines");
		expect(report.error).toContain("maxOffsetYears");
	});
});

describe("reset", () => {
	test("puts every value back to its default", () => {
		const manager = new ConfigManager();
		manager.set("performance.defaultCacheSize", 999);
		manager.set("vm.maxInstructions", 5);

		manager.reset();

		expect(manager.get<number>("performance.defaultCacheSize")).toBe(PRISTINE_CACHE_SIZE);
		expect(manager.get<number>("vm.maxInstructions")).toBe(50000);
	});

	/*
	 * `reset()` used to be `this.config = { ...DEFAULT_CONFIG }`, a one-level
	 * copy. The six section objects underneath were not copied, so after a
	 * reset the manager's `performance` WAS `DEFAULT_CONFIG.performance`, and
	 * the very next `set('performance.x', ...)` wrote into the module-level
	 * constant.
	 *
	 * That constant is what `mergeEngineConfig()` builds every
	 * `ExpressionEngine`'s configuration from, so the write was not confined
	 * to the manager that made it or even to the engines alive at the time:
	 * every engine constructed afterwards in that process inherited it. A host
	 * that reset one document's settings could change the cache size, the
	 * instruction ceiling or the allocation budget of every document it opened
	 * later, with nothing in either object's history to explain it.
	 *
	 * The constructor was already correct: it goes through
	 * `mergeEngineConfig()`, which builds fresh section objects, and `reset()`
	 * now does the same thing rather than a spread.
	 *
	 * Both halves are asserted: the shared constant must not move, and a
	 * manager built after the write must not have inherited it.
	 */
	test("a write after reset does not reach the shared defaults", () => {
		const manager = new ConfigManager();
		manager.reset();
		manager.set("performance.defaultCacheSize", 999);

		expect(DEFAULT_CONFIG.performance.defaultCacheSize).toBe(PRISTINE_CACHE_SIZE);
		expect(new ConfigManager().get<number>("performance.defaultCacheSize")).toBe(PRISTINE_CACHE_SIZE);
	});

	test("an engine built afterwards does not inherit the write", () => {
		/*
		 * The same defect seen where it does damage. A `ConfigManager` is not
		 * what an engine holds, but both are built from the same constant, so
		 * a manager writing through it changes the document limit of an
		 * engine constructed later that never touched a manager at all.
		 */
		const manager = new ConfigManager();
		manager.reset();
		manager.set("performance.maxDocumentLines", 42);

		const engine = new ExpressionEngine("en", undefined, undefined, undefined, BUILTIN_PACKAGES);
		try {
			expect(engine.getConfig().performance.maxDocumentLines).toBe(PRISTINE_MAX_LINES);
		} finally {
			engine.clear();
		}
	});
});

describe("getConfig", () => {
	test("returns the current values", () => {
		const manager = new ConfigManager();
		manager.set("vm.maxInstructions", 77);
		expect(manager.getConfig().vm.maxInstructions).toBe(77);
	});

	test("names every section, so a host can enumerate what is configurable", () => {
		const config = new ConfigManager().getConfig();
		expect(Object.keys(config).sort()).toEqual([
			"date",
			"diagnostic",
			"performance",
			"validation",
			"vm",
			"worker",
		]);
	});
});
