/**
 * Pure reading of markdown headings and the sections they open, kept
 * engine-free so it is unit-testable on its own, the same design the tags
 * package's `TagScanner` and the tables package's `TableReader` draw.
 *
 * A section is the run of lines under a heading, up to the next heading of the
 * same or a higher level (fewer `#`). `# Travel` owns everything down to the
 * next `#` heading, including any `## Flights` and `## Hotels` inside it; a
 * `## Flights` section stops at the next `##` or `#`.
 */

/** A markdown heading: how deep it sits and the words it carries. */
export interface Heading {
  /** How many `#` open it: 1 for `# Travel`, 2 for `## Flights`. */
  readonly level: number;
  /** The heading's words, trimmed, with any closing run of `#` removed. */
  readonly name: string;
}

/** Whether a character code is an ASCII hex digit. */
function isHexDigit(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

/** Whether a character code can continue a word (a letter, a digit or `_`). */
function isWordChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/**
 * Whether the `#` at `hashPos` opens a colour literal (`#fff`, `#c0ffee`).
 *
 * The same predicate the line classifier applies before it calls a line a
 * heading: `#` followed by exactly 3, 4, 6 or 8 hex digits and then no further
 * word character. A line holding a colour is an expression, not a heading, so it
 * neither names a section nor ends one.
 */
function opensColour(text: string, hashPos: number): boolean {
  let p = hashPos + 1;
  while (p < text.length && isHexDigit(text.charCodeAt(p))) p++;
  const digits = p - hashPos - 1;
  if (digits !== 3 && digits !== 4 && digits !== 6 && digits !== 8) return false;
  return p >= text.length || !isWordChar(text.charCodeAt(p));
}

/**
 * The heading a line opens, or `null` for any other line.
 *
 * Read the way the line classifier reads one: the first non-blank character is
 * `#`, and the line is not a colour literal. The level is the number of leading
 * `#`, so `#Travel` (no space) is a level-one heading too, as it is everywhere
 * else in the engine. A closing run of `#` after a space (`## Travel ##`) is
 * decoration and is dropped from the name; a `#` glued to a word (`# C#`) is
 * part of it.
 *
 * @param text - One raw line of the document.
 * @returns The heading's level and name, or `null` when the line is not one.
 */
export function headingOf(text: string): Heading | null {
  let pos = 0;
  while (pos < text.length && (text.charCodeAt(pos) === 32 || text.charCodeAt(pos) === 9)) pos++;
  if (text.charCodeAt(pos) !== 35) return null;
  if (opensColour(text, pos)) return null;
  let level = 0;
  while (text.charCodeAt(pos + level) === 35) level++;
  const name = text
    .slice(pos + level)
    .trim()
    .replace(/(?:^|\s+)#+$/, "")
    .trim();
  return { level, name };
}

/**
 * The form a section name is compared in: trimmed, inner runs of whitespace
 * read as one space, and lower-cased.
 *
 * A reader types `section "travel"` for a `# Travel` heading and means it, the
 * same way a category tag is matched without regard to case. Nothing else is
 * forgiven: `"Travel costs"` does not find `# Travel`, since a near miss that
 * quietly totals a different block is worse than a clear "not found".
 *
 * @param name - A heading's name, or the name a query asks for.
 * @returns The comparison key.
 */
export function sectionKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The worded forms that summarise other lines, each at a word boundary: the
 * `above` aggregates, a category tag aggregate, another section aggregate and
 * the tag breakdown. Tested against a line's expression, after any label.
 */
const SUMMARY_PHRASE = new RegExp(
  [
    String.raw`(?:^|[^0-9A-Za-z_])(?:total|sum|average|avg|mean|count|min|max|median)\s+above(?![0-9A-Za-z_])`,
    String.raw`(?:^|[^0-9A-Za-z_])(?:total|sum|average|count)\s+of\s+section\s*"`,
    String.raw`(?:^|[^0-9A-Za-z_])(?:total|sum|average|count)\s+of\s+#[A-Za-z]`,
    String.raw`(?:^|[^0-9A-Za-z_])(?:total|sum)\s+by\s+tag(?![0-9A-Za-z_])`,
  ].join("|"),
  "i",
);

/**
 * An explicit span, `sum(line 1 : line 3)` and its `total`/`average` spellings.
 * Tested against the whole line: its own colon is not a label's, and no label
 * is written that way.
 */
const SUMMARY_SPAN = /(?:^|[^0-9A-Za-z_])(?:total|sum|average)\s*\(\s*line\s*\d/i;

/**
 * A label ending, `word: `: a colon glued to the word before it and followed by
 * whitespace. The engine reads `Subtotal: total above` as the label `Subtotal`
 * and the expression after it; a clock time (`10:30`) has nothing after its
 * colon, so it is not taken for one.
 */
const LABEL_END = /\S:\s/g;

/** A double-quoted run, whose colons belong to the text rather than to a label. */
const QUOTED = /"[^"]*"/g;

/**
 * Whether a line is itself a summary of other lines, which a section total
 * leaves out.
 *
 * A section often carries its own subtotal (`total above` at the foot of the
 * block), and a summary section can hold one total per other section. Counting
 * those alongside the figures they sum would count each figure twice, and the
 * answer would be confidently wrong, so a line written as one of the summarising
 * forms is not a member of the section it sits in. A line that reads a single
 * other line (`prev`, `line 3`) is a figure of its own and is counted.
 *
 * Read from the text, the way the tag scanner tells a tag query from a tag
 * member. A label is set aside first, so `Total above budget: $50` is the figure
 * `$50` and not a summary, while `Subtotal: total above` is one.
 *
 * @param text - One raw line of the document.
 * @returns `true` when the line's expression is a summarising form.
 */
export function isSummaryLine(text: string): boolean {
  // A quoted name can hold a colon or a `//` (`section "Travel: Italy"`), which
  // must not read as a label or a comment. Blanked, not removed, so positions
  // still line up with the original text.
  const unquoted = text.replace(QUOTED, (run) => `"${" ".repeat(run.length - 2)}"`);
  // A trailing `// comment` is prose about the line, not part of what it says.
  const commentAt = unquoted.indexOf("//");
  const end = commentAt === -1 ? text.length : commentAt;
  if (SUMMARY_SPAN.test(text.slice(0, end))) return true;
  let expressionStart = 0;
  LABEL_END.lastIndex = 0;
  for (let m = LABEL_END.exec(unquoted); m !== null && m.index < end; m = LABEL_END.exec(unquoted)) {
    expressionStart = m.index + m[0].length;
  }
  return SUMMARY_PHRASE.test(text.slice(expressionStart, end));
}
