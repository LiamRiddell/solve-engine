import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ValueType } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Evaluates every example in the published documentation and asserts it still
 * produces the documented result.
 *
 * Documentation that drifts from behaviour is worse than no documentation,
 * because a reader has no way to tell which half is wrong. Making the examples
 * executable turns drift into a failing build rather than a bug report.
 *
 * There are two block formats, matching the two a reader meets on the page:
 *
 * A ```solve block is a column of independent lines, each proven on its own:
 *
 * ```solve
 * 50% of 200          // 100
 * 100cm + 2m          // 300.00 cm
 * ```
 *
 * A ```solve-doc block is one whole document, proven together, which is what
 * the cross-line forms need: a `line N` reference, a `#tag` total, a table
 * column, or goal seek, none of which mean anything read a line at a time:
 *
 * ```solve-doc
 * 10
 * 20
 * total above          // 30
 * ```
 *
 * In both, left of the last `//` is the expression, right is the expected
 * formatted result with the leading display marker omitted. `//` is the
 * engine's own comment marker, so every documented line is valid input a reader
 * can paste unchanged, and a whole-document block evaluates the same text a live
 * notepad renders once the expected values are stripped as comments.
 *
 * A ```solve line with no `//` is evaluated for its side effects (assigning a
 * variable before it is used); a blank line starts a fresh engine so examples
 * cannot leak into each other. A ```solve-doc block keeps its blank lines: there
 * they are document boundaries the aggregates read, not example separators.
 *
 * Anything non-deterministic (dates relative to now, random numbers, live
 * network data) must not carry an expected value, since there is no stable one.
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

/** One `solve` line: an expression, and the result documented beside it (or none). */
interface Example {
  file: string;
  line: number;
  expression: string;
  expected: string | null;
}

/** One `solve-doc` block: a whole document, and the results documented within it. */
interface DocBlock {
  file: string;
  line: number;
  /** Every line in order, blanks and table rows included, so line N maps to result N. */
  rows: Array<{ line: number; expression: string; expected: string | null }>;
}

/** Split a line on its LAST `//`, the expected-result marker. */
function splitExpectation(text: string): { expression: string; expected: string | null } {
  const idx = text.lastIndexOf("//");
  if (idx === -1) return { expression: text, expected: null };
  return { expression: text.slice(0, idx).trim(), expected: text.slice(idx + 2).trim() };
}

/** Whether a whole-document block holds a markdown table, which routes it to the batch pass. */
function blockHasTable(block: DocBlock): boolean {
  return block.rows.some((r) => /^\s*\|/.test(r.expression));
}

function collectAll(
  dir: string,
  extraFiles: string[] = [],
): { examples: Example[]; docBlocks: DocBlock[] } {
  const examples: Example[] = [];
  const docBlocks: DocBlock[] = [];

  const parseFile = (full: string): void => {
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
    // Block state: null outside any block, "line" inside ```solve, or a
    // DocBlock being accumulated inside ```solve-doc.
    let mode: "none" | "line" | "doc" = "none";
    let doc: DocBlock | null = null;

    lines.forEach((raw, i) => {
      const text = raw.trim();
      const fence = text.match(/^```(\S*)/);

      if (mode === "none") {
        if (fence && fence[1] === "solve") mode = "line";
        else if (fence && fence[1] === "solve-doc") {
          mode = "doc";
          doc = { file: full, line: i + 1, rows: [] };
        }
        return;
      }

      // A closing fence ends whichever block is open.
      if (fence && fence[1] === "") {
        if (mode === "line") {
          // Close the group. Without this, separate blocks (and separate
          // files) run against one shared engine, so a variable assigned in
          // one example silently leaks into the next. That is not a
          // theoretical concern: it made a symbolic example resolve an
          // intended-unknown `b` to a value assigned three sections earlier.
          examples.push({ file: full, line: i + 1, expression: "", expected: null });
        } else if (doc) {
          docBlocks.push(doc);
          doc = null;
        }
        mode = "none";
        return;
      }

      if (mode === "doc" && doc) {
        // Keep every line in order, blanks and table rows included, so a
        // result read back by position lines up with the source. The engine
        // treats a blank as a boundary and a table row as skippable markdown.
        const { expression, expected } = splitExpectation(text);
        doc.rows.push({ line: i + 1, expression, expected });
        return;
      }

      // mode === "line"
      // A blank line inside a block separates independent examples.
      if (text === "") {
        examples.push({ file: full, line: i + 1, expression: "", expected: null });
        return;
      }
      const { expression, expected } = splitExpectation(text);
      examples.push({ file: full, line: i + 1, expression, expected });
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
  return { examples, docBlocks };
}

const { examples, docBlocks } = collectAll(DOCS_ROOT, EXTRA_FILES);

describe("documented examples evaluate as documented", () => {
  test("the documentation directory was found", () => {
    // Guards against the suite silently passing because a path changed and it
    // collected nothing at all.
    expect(fs.existsSync(DOCS_ROOT)).toBe(true);
  });

  test("at least one example was collected", () => {
    // Without this, deleting every example would look like a green suite.
    expect(examples.length + docBlocks.length).toBeGreaterThan(0);
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

  test("every syntax page either proves its examples or says why it cannot", () => {
    // Pages whose output is not a fixed string, so an asserted example would
    // either be a lie or a flake. Each needs a reason, not just an entry.
    const unprovable = new Map([
      ["dice.md", "rolls are random, so no output is reproducible"],
      ["live-data.md", "results come from live network queries"],
      ["dates.md", "relative dates resolve against the current date"],
    ]);

    const syntaxDir = path.join(DOCS_ROOT, "syntax");
    const pages = fs.readdirSync(syntaxDir).filter((f) => f.endsWith(".md"));

    // A page listed as unprovable that has since gained real examples means the
    // list is stale. Failing on that keeps the exclusions honest, which is the
    // whole point of writing them down rather than just skipping the files.
    const covered = new Set([
      ...examples.filter((ex) => ex.expected !== null).map((ex) => path.basename(ex.file)),
      ...docBlocks
        .filter((b) => b.rows.some((r) => r.expected !== null))
        .map((b) => path.basename(b.file)),
    ]);

    const untested = pages.filter((p) => !covered.has(p) && !unprovable.has(p));
    const staleExclusions = [...unprovable.keys()].filter((p) => covered.has(p));

    expect({ untested, staleExclusions }).toEqual({ untested: [], staleExclusions: [] });
  });

  // ── Per-line ```solve blocks ────────────────────────────────────────────
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

    test(`[line ${gi}] ${label.slice(0, 100)}`, () => {
      const engine = newTrackedEngine();
      group.forEach((ex, i) => {
        const value = engine.evaluateLine(i + 1, ex.expression);
        if (ex.expected === null) return;

        // formatValue prefixes results with a display marker that belongs to
        // the editor gutter, not to the value, so it is stripped before
        // comparison.
        const actual = formatValue(value).replace(/^=\s*/, "");
        expect(`${ex.expression} // ${actual}`).toBe(`${ex.expression} // ${ex.expected}`);
      });
    });
  });

  // ── Whole-document ```solve-doc blocks ──────────────────────────────────
  // Evaluated the way a live notepad renders them: the whole block as one
  // document, with the expected values stripped as comments, then each result
  // read back by line position. A table stays on the batch pass (which skips
  // its rows); everything else goes through the incremental pass, the only one
  // that can re-run a line for goal seek.
  docBlocks.forEach((block, bi) => {
    const proven = block.rows.filter((r) => r.expected !== null);
    const label = proven
      .map((r) => `${r.expression} // ${r.expected}`)
      .join(" | ");
    const relative = path.relative(REPO_ROOT, block.file).replace(/\\/g, "/");

    test(`[doc ${bi}] ${relative}: ${label.slice(0, 80)}`, () => {
      const engine = newTrackedEngine();
      const source = block.rows.map((r) => r.expression).join("\n");
      const result = blockHasTable(block)
        ? engine.parseDocument(source, { inputType: "markdown" })
        : evaluateDocument(engine, source, { inputType: "markdown" });

      block.rows.forEach((row, i) => {
        if (row.expected === null) return;
        const parsed = result.lines[i];
        let value: string;
        if (parsed?.error) {
          value = `ERROR: ${parsed.error}`;
        } else if (parsed?.result) {
          const formatted = formatValue(parsed.result).replace(/^=\s*/, "");
          // A returned failure lands in `result` as an error-typed Value; mark
          // it so a drifted example reads as a failure, not a stray message.
          value = parsed.result.type === ValueType.Error ? `ERROR: ${formatted}` : formatted;
        } else {
          value = "(no result)";
        }
        expect(`${row.expression} // ${value}`).toBe(`${row.expression} // ${row.expected}`);
      });
    });
  });
});
