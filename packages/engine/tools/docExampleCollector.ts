/**
 * Collects the documented examples as data, for the specs that execute them.
 *
 * `__tests__/docs/DocExamples.spec.ts` proves every example in the published
 * documentation against the `Date` backend; the differential suite under
 * `__tests__/temporal/` runs the same corpus through both calendar backends
 * and asserts they agree. One collector, shared, so the two specs cannot
 * drift apart on what an example is. The parsing rules are the ones that spec
 * has always used, moved here unchanged; `tools/docExampleCorpus.mjs` at the
 * repository root is the same rule again for scripts that run outside jest,
 * and `scripts/consumer-e2e.mjs` cross-checks the counts.
 */
import * as fs from "fs";
import * as path from "path";

/** One `solve` line: an expression, and the result documented beside it (or none). */
export interface Example {
  file: string;
  line: number;
  expression: string;
  expected: string | null;
}

/** One `solve-doc` block: a whole document, and the results documented within it. */
export interface DocBlock {
  file: string;
  line: number;
  /** Every line in order, blanks and table rows included, so line N maps to result N. */
  rows: Array<{ line: number; expression: string; expected: string | null }>;
}

/** Split a line on its LAST `//`, the expected-result marker. */
export function splitExpectation(text: string): { expression: string; expected: string | null } {
  const idx = text.lastIndexOf("//");
  if (idx === -1) return { expression: text, expected: null };
  return { expression: text.slice(0, idx).trim(), expected: text.slice(idx + 2).trim() };
}

/** Whether a whole-document block holds a markdown table, which routes it to the batch pass. */
export function blockHasTable(block: DocBlock): boolean {
  return block.rows.some((r) => /^\s*\|/.test(r.expression));
}

/**
 * Every example under `dir`, and in each of `extraFiles`.
 *
 * @param dir - The documentation tree to walk.
 * @param extraFiles - Markdown files outside it that also carry `solve` blocks.
 * @returns The per-line examples, with a blank-expression separator closing each block, and the whole-document blocks.
 */
export function collectAll(
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

/**
 * Consecutive non-blank examples grouped so a multi-line example shares one
 * engine; a blank expression is the separator {@link collectAll} emits.
 *
 * @param examples - The per-line examples, separators included.
 * @returns The groups, each to be run on a fresh engine.
 */
export function groupExamples(examples: Example[]): Example[][] {
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
  return groups;
}
