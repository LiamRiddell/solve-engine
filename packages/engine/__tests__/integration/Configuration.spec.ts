import { describe, expect, test } from "@jest/globals";
import { ConfigManager, DEFAULT_CONFIG, mergeEngineConfig } from "@solve-js/constants/Configuration";
import { EngineError, ErrorCategory } from "@solve-js/errors/UnifiedErrorFramework";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

describe("ConfigManager", () => {
  test("get throws EngineError with CONFIG category for missing path", () => {
    const mgr = new ConfigManager();
    try {
      mgr.get("nonexistent.property");
      expect(true).toBe(false); // should not reach here
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      const err = e as EngineError;
      expect(err.category).toBe(ErrorCategory.CONFIG);
      expect(err.code).toBe("CONFIG_PATH_NOT_FOUND");
    }
  });

  test("set throws EngineError with CONFIG category for invalid path format", () => {
    const mgr = new ConfigManager();
    try {
      mgr.set("justOnePart", 42);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      const err = e as EngineError;
      expect(err.category).toBe(ErrorCategory.CONFIG);
      expect(err.code).toBe("INVALID_CONFIG_PATH");
    }
  });

  test("set throws EngineError with CONFIG category for missing section", () => {
    const mgr = new ConfigManager();
    try {
      mgr.set("noSuchSection.property", 42);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      const err = e as EngineError;
      expect(err.category).toBe(ErrorCategory.CONFIG);
      expect(err.code).toBe("CONFIG_SECTION_NOT_FOUND");
    }
  });

  test("get returns value for valid path", () => {
    const mgr = new ConfigManager();
    const maxDepth = mgr.get<number>("validation.maxNestingDepth");
    expect(maxDepth).toBe(50);
  });
});

describe("mergeEngineConfig — per-section merge (not a shallow top-level spread)", () => {
  test("overriding one field of a section preserves every other field in that section", () => {
    const merged = mergeEngineConfig(DEFAULT_CONFIG, { performance: { defaultCacheSize: 500 } as any });
    expect(merged.performance.defaultCacheSize).toBe(500);
    // A shallow `{ ...base, ...override }` would have replaced the whole
    // `performance` section with `{ defaultCacheSize: 500 }`, dropping these.
    expect(merged.performance.maxDocumentLines).toBe(DEFAULT_CONFIG.performance.maxDocumentLines);
  });

  test("sections not mentioned in the override are untouched", () => {
    // Was written against `dice`, a section whose four fields were declared and
    // read nowhere and which the release-hardening pass removed. Any section
    // the surrounding assertions do not name works here; `worker` is the one
    // nothing else in this file touches.
    const merged = mergeEngineConfig(DEFAULT_CONFIG, { worker: { maxRetries: 12 } as any });
    expect(merged.worker.maxRetries).toBe(12);
    expect(merged.worker.idleTimeoutMs).toBe(DEFAULT_CONFIG.worker.idleTimeoutMs);
    expect(merged.vm).toEqual(DEFAULT_CONFIG.vm);
    expect(merged.date).toEqual(DEFAULT_CONFIG.date);
  });

  test("ConfigManager.update() preserves other fields when overriding one", () => {
    const mgr = new ConfigManager();
    mgr.update({ validation: { maxComplexity: 999 } as any });
    expect(mgr.get<number>("validation.maxComplexity")).toBe(999);
    expect(mgr.get<number>("validation.maxNestingDepth")).toBe(DEFAULT_CONFIG.validation.maxNestingDepth);
  });
});

describe("ExpressionEngine constructor — per-section config merge", () => {
  test("overriding one performance field doesn't drop the rest of that section", () => {
    const engine = newTrackedEngine({ config: { performance: { defaultCacheSize: 42 } as any } });
    const effective = engine.getConfig();
    expect(effective.performance.defaultCacheSize).toBe(42);
    expect(effective.performance.maxDocumentLines).toBe(DEFAULT_CONFIG.performance.maxDocumentLines);
  });

  test("overriding one validation field doesn't drop the rest of that section", () => {
    const engine = newTrackedEngine({ config: { validation: { maxExpressionLength: 100 } as any } });
    const effective = engine.getConfig();
    expect(effective.validation.maxExpressionLength).toBe(100);
    expect(effective.validation.maxNestingDepth).toBe(DEFAULT_CONFIG.validation.maxNestingDepth);
    expect(effective.validation.autoBalanceParens).toBe(DEFAULT_CONFIG.validation.autoBalanceParens);
  });

  test("no config override falls back entirely to defaults", () => {
    const engine = newTrackedEngine();
    expect(engine.getConfig()).toEqual(DEFAULT_CONFIG);
  });
});
