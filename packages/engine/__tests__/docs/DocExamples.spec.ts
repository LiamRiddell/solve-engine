import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { formatValue } from "@solve-js/format/FormatEngine";

/**
 * Evaluates every example in the published documentation and asserts it still
 * produces the documented result.
 *
 * Documentation that drifts from behaviour is worse than no documentation,
 * because a reader has no way to tell which half is wrong. Making the examples
 * executable turns drift into a failing build rather than a bug report.
 *
 * The format a page opts into looks like this:
 *
 * ```solve
 * 50% of 200          // 100
 * 100cm + 2m          // 300.00 cm
 * ```
 *
 * Left of `//` is the expression, right is the expected formatted result with
 * the leading display marker omitted. `//` is deliberately the engine's own
 * comment marker, which means every documented line is valid input that a
 * reader can paste unchanged. It also avoids colliding with `=>`, which the
 * language already uses for symbolic evaluation.
 *
 * Lines with no `//` are evaluated for their side effects, which is how a
 * multi-line example assigns a variable before using it. A blank line starts a
 * fresh engine, so examples cannot leak state into each other.
 *
 * Anything non-deterministic (dates relative to now, random numbers, live
 * network data) must not use `=>`, since there is no stable expected value.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs/src/content/docs");

/**
 * Markdown outside the documentation tree that also carries `solve` blocks.
 *
 * The root README is the first thing anyone reads and the most expensive place
 * to be wrong, so it is held to the same standard as the reference pages.
 */
const EXTRA_FILES = [path.join(REPO_ROOT, "README.md")];

interface Example {
  file: string;
  line: number;
  expression: string;
  expected: string | null;
}

function collectExamples(dir: string, extraFiles: string[] = []): Example[] {
  const out: Example[] = [];

  const parseFile = (full: string): void => {
      const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
      let inBlock = false;
      lines.forEach((raw, i) => {
        const text = raw.trim();
        if (text.startsWith("```solve")) { inBlock = true; return; }
        if (inBlock && text.startsWith("```")) {
          inBlock = false;
          // Close the group. Without this, separate blocks (and separate
          // files) run against one shared engine, so a variable assigned in
          // one example silently leaks into the next. That is not a
          // theoretical concern: it made a symbolic example resolve an
          // intended-unknown `b` to a value assigned three sections earlier.
          out.push({ file: full, line: i + 1, expression: "", expected: null });
          return;
        }
        if (!inBlock) return;

        // A blank line inside a block separates independent examples.
        if (text === "") {
          out.push({ file: full, line: i + 1, expression: "", expected: null });
          return;
        }
        // Split on the LAST marker, not the first. A line may legitimately
        // contain a comment of its own, as in `2 + 2 // note // 4`, where the
        // expression is everything up to the final marker.
        const idx = text.lastIndexOf("//");
        if (idx === -1) {
          out.push({ file: full, line: i + 1, expression: text, expected: null });
        } else {
          out.push({
            file: full,
            line: i + 1,
            expression: text.slice(0, idx).trim(),
            expected: text.slice(idx + 2).trim(),
          });
        }
      });
  };

  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.mdx?$/.test(entry.name)) continue;
      parseFile(full);
    }
  };

  if (fs.existsSync(dir)) walk(dir);
  for (const file of extraFiles) {
    if (fs.existsSync(file)) parseFile(file);
  }
  return out;
}

const examples = collectExamples(DOCS_ROOT, EXTRA_FILES);

describe("documented examples evaluate as documented", () => {
  test("the documentation directory was found", () => {
    // Guards against the suite silently passing because a path changed and it
    // collected nothing at all.
    expect(fs.existsSync(DOCS_ROOT)).toBe(true);
  });

  test("at least one example was collected", () => {
    // Without this, deleting every example would look like a green suite.
    expect(examples.length).toBeGreaterThan(0);
  });

  test("the root README contributed examples", () => {
    // The README claims in prose that every example in it is executed here.
    // If a rename or a move quietly stopped it being collected, that claim
    // would become false while the suite stayed green.
    const fromReadme = examples.filter(
      (ex) => ex.file.endsWith("README.md") && ex.expected !== null,
    );
    expect(fromReadme.length).toBeGreaterThan(0);
  });

  // Group consecutive non-blank lines so a multi-line example shares one engine.
  const groups: Example[][] = [];
  let current: Example[] = [];
  for (const ex of examples) {
    if (ex.expression === "") {
      if (current.length) groups.push(current);
      current = [];
    } else {
      current.push(ex);
    }
  }
  if (current.length) groups.push(current);

  groups.forEach((group, gi) => {
    const label = group
      .map((g) => (g.expected === null ? g.expression : `${g.expression} // ${g.expected}`))
      .join(" | ");

    test(`[${gi}] ${label.slice(0, 110)}`, () => {
      const engine = new ExpressionEngine("en");
      group.forEach((ex, i) => {
        const [value] = engine.evaluateLine(i + 1, ex.expression);
        if (ex.expected === null) return;

        // formatValue prefixes results with a display marker that belongs to
        // the editor gutter, not to the value, so it is stripped before
        // comparison.
        const actual = formatValue(value).replace(/^=\s*/, "");
        expect(`${ex.expression} // ${actual}`).toBe(`${ex.expression} // ${ex.expected}`);
      });
    });
  });
});
