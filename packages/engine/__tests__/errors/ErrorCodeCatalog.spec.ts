import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { CoreErrorCodes } from "@solve-js/errors/ErrorCode";
import { DatetimeErrorCodes } from "@solve-js/packages/datetime/DateReading";

/**
 * Two things this test guards, both retroactively confirmed to have been
 * real bugs in this codebase before the catalog existed:
 *
 * 1. Uniqueness — `CoreErrorCodes`' keys and values must each be unique.
 *    Would have caught two unrelated files (`VariableParselet.ts`/
 *    `GlobalVariableParselet.ts`) independently defining the SAME code
 *    ("EXPECTED_IDENTIFIER") for two different failure shapes.
 * 2. Coverage — every `ErrorFactory.<method>("SOME_CODE", ...)` call site
 *    in the core parser/VM/engine/errors/config/lexer layers (the layers
 *    `CoreErrorCodes` currently catalogs — see that file's own doc
 *    comment on why the ~17 packages aren't included yet) uses a code
 *    that's actually registered in the catalog, catching typos and
 *    codes added to a call site but never added to the catalog.
 *
 * A package that has migrated exports its own scoped `XxxErrorCodes` object
 * co-located with its parselets, per `ErrorCode.ts`'s header, and is checked
 * the same way. `DatetimeErrorCodes` is the first date-reading one: its codes
 * mostly reach a reader as `errorValue(code, message)` from a plugin function
 * rather than through `ErrorFactory`, so the coverage check for it is the
 * mirror image, every catalogued code is used somewhere in the package rather
 * than every used code is catalogued.
 */

const CORE_DIR = path.resolve(__dirname, "../../src");

// The exact layers CoreErrorCodes currently catalogs — see ErrorCode.ts's
// own doc comment. Scoped deliberately, not a full-repo scan: the ~17
// packages haven't migrated their own codes into a catalog yet (Phase 5
// of this session's error-handling-refactor plan), so scanning them here
// would just report every one of their existing codes as "orphaned",
// which is expected/known, not a new bug to catch.
const CATALOGED_FILES = [
  "parser/PrecedenceParser.ts",
  "parser/BytecodeBuilder.ts",
  "parser/PhrasePattern.ts",
  "vm/VM.ts",
  "vm/OpRegistry.ts",
  "vm/VMBuiltins.ts",
  "engine/ExpressionEngine.ts",
  "engine/ExpressionEngineSafety.ts",
  "engine/AsyncResolutionBatcher.ts",
  "normalizer/TokenNormalizer.ts",
  "constants/Configuration.ts",
  "lexer/ExpressionLexer.ts",
  "errors/EngineError.ts",
  "temporal/TemporalCalendar.ts",
];

function findErrorFactoryCodes(fileContent: string): string[] {
  // Matches both call shapes: ErrorFactory.<method>("CODE", ...) and
  // ErrorFactory.<method>({ code: "CODE", ... }). A code written as an
  // ErrorCode.X reference rather than a string literal is not seen here,
  // and does not need to be: it can only name a catalogued code.
  const pattern = /ErrorFactory\.(?:validation|parsing|execution|external|internal|config)\(\s*(?:["']([A-Z][A-Z0-9_]*)["']|\{\s*code:\s*["']([A-Z][A-Z0-9_]*)["'])/g;
  const codes: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(fileContent)) !== null) {
    codes.push(m[1] ?? m[2]);
  }
  return codes;
}

const DATETIME_FILES = [
  "packages/datetime/DateReading.ts",
  "packages/datetime/normalizer/DateLiteralNormalizerRule.ts",
  "packages/datetime/normalizer/MonthNameDateNormalizerRule.ts",
  "packages/datetime/parselets/DatetimeCalendarPluginFunctions.ts",
];

describe("ErrorCode catalog", () => {
  test("CoreErrorCodes keys are unique (no two keys collide)", () => {
    const keys = Object.keys(CoreErrorCodes);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("CoreErrorCodes values are unique (no two entries share a code string)", () => {
    const values = Object.values(CoreErrorCodes);
    const dupes = values.filter((v, i) => values.indexOf(v) !== i);
    expect(dupes).toEqual([]);
  });

  test("every ErrorFactory call site in the cataloged core layers uses a registered code", () => {
    const catalog = new Set(Object.values(CoreErrorCodes) as string[]);
    const orphans: Array<{ file: string; code: string }> = [];

    for (const relPath of CATALOGED_FILES) {
      const fullPath = path.join(CORE_DIR, relPath);
      if (!fs.existsSync(fullPath)) continue; // tolerate a file having moved
      const content = fs.readFileSync(fullPath, "utf8");
      for (const code of findErrorFactoryCodes(content)) {
        if (!catalog.has(code)) orphans.push({ file: relPath, code });
      }
    }

    expect(orphans).toEqual([]);
  });
});

describe("DatetimeErrorCodes", () => {
  test("keys and values are unique", () => {
    const keys = Object.keys(DatetimeErrorCodes);
    const values = Object.values(DatetimeErrorCodes);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(values).size).toBe(values.length);
  });

  test("does not collide with a code CoreErrorCodes already owns", () => {
    const core = new Set(Object.values(CoreErrorCodes) as string[]);
    const collisions = (Object.values(DatetimeErrorCodes) as string[]).filter((code) => core.has(code));
    expect(collisions).toEqual([]);
  });

  test("every ErrorFactory call site in the datetime date-reading files uses a registered code", () => {
    const catalog = new Set([
      ...(Object.values(CoreErrorCodes) as string[]),
      ...(Object.values(DatetimeErrorCodes) as string[]),
    ]);
    const orphans: Array<{ file: string; code: string }> = [];
    for (const relPath of DATETIME_FILES) {
      const fullPath = path.join(CORE_DIR, relPath);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, "utf8");
      for (const code of findErrorFactoryCodes(content)) {
        if (!catalog.has(code)) orphans.push({ file: relPath, code });
      }
    }
    expect(orphans).toEqual([]);
  });

  test("and no catalogued code is dead: each is named by the package", () => {
    // The mirror of the orphan check above. These codes reach a reader as an
    // Error VALUE rather than a thrown EngineError, so the ErrorFactory scan
    // cannot see them; what it can see is that the constant is referenced.
    const sources = DATETIME_FILES.map((relPath) => path.join(CORE_DIR, relPath))
      .filter((fullPath) => fs.existsSync(fullPath))
      .map((fullPath) => fs.readFileSync(fullPath, "utf8"))
      .join("\n");
    const unused = Object.keys(DatetimeErrorCodes).filter((key) => !sources.includes(key));
    expect(unused).toEqual([]);
  });
});
