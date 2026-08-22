import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { ExpressionEngine } from "solve-engine";
import { formatValue, formatMatrixAligned } from "solve-engine/format";
import { LanguageService, tokenClassName } from "solve-engine/language";
import { ValueType } from "solve-engine/vm";

/**
 * A live Solve notepad: an editable column of lines on the left, the answers
 * the engine produced for them on the right.
 *
 * This is the real engine, not a recording. Every block on the landing page is
 * one of these, so a reader can edit any example in place and watch the answer
 * column follow, which is the entire pitch and something a screenshot cannot
 * make.
 *
 * ## Why the answers live outside the editor
 *
 * The obvious implementation renders each answer inside its own line, from a
 * custom Plate element. That couples answer rendering to Slate's node-level
 * memoisation, which is keyed on element identity: when only the RESULTS
 * change and the document does not, the lines legitimately do not re-render
 * and the answers go stale.
 *
 * So the answers are a sibling column instead, and alignment is guaranteed
 * structurally: every line is exactly one row of a fixed height, and lines do
 * not wrap (`white-space: pre` plus horizontal scroll). One editor row always
 * means one answer row. This is also how Soulver itself behaves. A long line
 * scrolls, it does not reflow and push the column out of step.
 *
 * ## Highlighting
 *
 * The colours come from the engine's own `LanguageService`, the same one an
 * editor integration would use, and the class names from its shipped
 * `tokenClassName` helper. Nothing here re-implements the lexer, so a
 * package that registers a new token category is highlighted on this page
 * without a single change to this file.
 */

/** What to show in the answer column for one line. */
interface Answer {
  text: string;
  /** Drives the colour. `none` renders nothing at all. */
  kind: "value" | "error" | "none";
  /** A CSS colour string, set when the result is a colour, to draw an inline swatch. */
  swatch?: string;
  /** A stacked, column-aligned grid, set when the result is a matrix. */
  matrix?: string;
}

const EMPTY: Answer = { text: "", kind: "none" };

/**
 * `formatValue` prefixes a result with `= ` because its first consumer paints
 * results into an editor gutter, where the marker is the only thing separating
 * the answer from the expression it sits beside. This column is already a
 * separate column, so the marker is noise. (Documented under Formatting
 * results: "The leading marker suits an editor gutter. Strip it when rendering
 * elsewhere.")
 */
function stripMarker(formatted: string): string {
  return formatted.replace(/^=\s*/, "");
}

interface Props {
  /** Seed content, newline-separated. Each line becomes one editable row. */
  initial: string;
  /**
   * Pad the notepad out to at least this many rows. Blank trailing rows read
   * as "there is room here for your own working", which a tightly cropped box
   * does not.
   */
  minRows?: number;
  /** Accessible name, since a notepad is a labelled region, not just a textbox. */
  label?: string;
  /**
   * Show the engine's refusal in the answer column instead of leaving the row
   * blank.
   *
   * Off by default, because in an ordinary notepad most lines are prose and
   * prose does not parse, so an error beside every heading and sentence would
   * be noise. On the security page it is the opposite: every line is there to
   * be refused, and a blank column would hide the only thing the example is
   * demonstrating.
   *
   * The column also gets wider and left aligned when this is set, because it is
   * showing sentences rather than figures.
   */
  showErrors?: boolean;
}

function toLines(text: string): string[] {
  return text.replace(/\s+$/, "").split("\n");
}

/** How much of an answer the row's `title` carries. See its use below. */
const TOOLTIP_LIMIT = 240;

function truncateForTooltip(text: string): string | undefined {
  if (!text) return undefined;
  return text.length > TOOLTIP_LIMIT ? `${text.slice(0, TOOLTIP_LIMIT)}…` : text;
}

/**
 * Render one result value.
 *
 * Some refusals come back as a value rather than as a thrown error, because the
 * engine treats "this could not be worked out" as a kind of value that survives
 * an operation instead of collapsing into a number. Those are answers as far as
 * the parser is concerned and are not answers at all as far as a reader is
 * concerned, so they are classified by type rather than painted in the brand
 * colour beside the real ones.
 */
function toValueAnswer(result: unknown): Answer {
  const text = stripMarker(formatValue(result as never));
  const v = result as { type?: number; value?: { r: number; g: number; b: number; a: number } };
  // A colour result carries its channels on the live Value, so the answer column
  // can draw the actual colour beside its text (e.g. a red square next to
  // "#ff0000"). rgba() is always valid CSS, so no conversion is needed.
  if (v.type === ValueType.Colour && v.value) {
    const c = v.value;
    return { text, kind: "value", swatch: `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})` };
  }
  // A matrix reads far better as a stacked, aligned grid than as one line, so the
  // answer column shows the aligned form (`text` keeps the compact single line
  // for the tooltip and for anything that wants one value per row).
  if (v.type === ValueType.Matrix && v.value) {
    return { text, kind: "value", matrix: formatMatrixAligned(v.value as never) };
  }
  const kind = v.type === ValueType.Error ? "error" : "value";
  return { text, kind };
}

/**
 * Reduce one parsed line to what the answer column shows.
 *
 * Failures render as nothing unless the caller asks for them, which is
 * deliberate and matches the engine's documented behaviour: "A line the engine
 * cannot make sense of is left alone." In a notepad most lines are prose, and
 * prose does not parse, so surfacing every parse failure would put an error
 * beside every heading and sentence. See `showErrors` for the case where that
 * trade runs the other way.
 *
 * A line with inline solves (backticked expressions inside prose) reports the
 * LAST one, because that is the line's conclusion. Showing every inline result
 * would need a column per solve.
 */
function toAnswer(
  line: {
    result: unknown;
    error: string | null;
    inlineSolves: Array<{ result?: unknown; error?: string | null }>;
  },
  showErrors: boolean,
): Answer {
  if (line.error) return showErrors ? { text: line.error, kind: "error" } : EMPTY;
  if (line.result) return toValueAnswer(line.result);

  const inline = line.inlineSolves.at(-1);
  if (inline?.result && !inline.error) return toValueAnswer(inline.result);

  return EMPTY;
}

/** A decoration range, in the shape Slate expects. */
interface Mark {
  anchor: { path: number[]; offset: number };
  focus: { path: number[]; offset: number };
  solveProse?: boolean;
  solveClass?: string;
}

/**
 * Classify one line for display.
 *
 * Two passes with different jobs. The prose pass greys out the parts the
 * engine treats as prose, and is deliberately syntactic rather than driven by
 * the evaluation results: a line that simply fails to parse is NOT greyed out,
 * because doing so would quietly tell the reader their input was a comment
 * when it was in fact a mistake. The token pass is the engine's own semantic
 * classification, and is skipped inside prose so a comment stays one flat
 * colour instead of being highlighted like code.
 */
function classifyLine(
  language: LanguageService,
  text: string,
  lineNumber: number,
  path: number[],
): Mark[] {
  if (text.length === 0) return [];

  const range = (from: number, to: number, extra: Partial<Mark>): Mark => ({
    anchor: { path, offset: from },
    focus: { path, offset: to },
    ...extra,
  });

  // A heading is prose from end to end, so there is nothing left to tokenise.
  if (text.trimStart().startsWith("#")) {
    return [range(0, text.length, { solveProse: true })];
  }

  const marks: Mark[] = [];
  const comment = text.indexOf("//");
  const codeEnd = comment === -1 ? text.length : comment;
  if (comment !== -1) marks.push(range(comment, text.length, { solveProse: true }));

  // Half-typed input is the normal state of an editor, and classification can
  // throw on it ("Unexpected end of input" while someone is mid-expression).
  // This runs during render, so an escaping throw would take the whole notepad
  // down rather than just losing a colour. Falling back to unhighlighted text
  // for one keystroke is the right trade.
  let tokens: Array<{ from: number; to: number; category: string }> = [];
  try {
    tokens = language.getSemanticTokens(text, lineNumber);
  } catch {
    return marks;
  }

  for (const token of tokens) {
    if (token.from >= codeEnd) continue;
    marks.push(
      range(token.from, Math.min(token.to, codeEnd), {
        solveClass: tokenClassName(token.category),
      }),
    );
  }

  return marks;
}

function renderLeaf({
  attributes,
  children,
  leaf,
}: {
  attributes: Record<string, unknown>;
  children: React.ReactNode;
  leaf: { solveProse?: boolean; solveClass?: string };
}) {
  const classes = [leaf.solveProse ? "notepad__prose" : null, leaf.solveClass]
    .filter(Boolean)
    .join(" ");
  return (
    <span {...attributes} className={classes || undefined}>
      {children}
    </span>
  );
}

export default function SolveNotepad({
  initial,
  minRows = 0,
  label,
  showErrors = false,
}: Props) {
  const seed = useMemo(() => toLines(initial), [initial]);

  const editor = usePlateEditor({
    value: seed.map((text) => ({ type: "p", children: [{ text }] })),
  });

  const [answers, setAnswers] = useState<Answer[]>(() => seed.map(() => EMPTY));

  // Each notepad owns an engine, because variables are per-document and two
  // notepads sharing one would see each other's definitions. That is
  // affordable: constructing an engine (lexer, package registry, parselet
  // table) measures at well under a millisecond, so a page of them costs less
  // than a single evaluation.
  //
  // Built during the first render rather than in an effect, because the very
  // first `decorate` pass happens before effects run. Lazily creating the
  // language service would leave that pass with nothing to classify, and
  // Slate caches decorations, so the whole notepad would render unhighlighted
  // and stay that way.
  const [engine] = useState(() => new ExpressionEngine("en"));
  // The language service reads the engine's dependency graph to decide whether
  // a lone bare word is a known variable, so it has to be the same engine that
  // evaluates the document, not a second one.
  const [language] = useState(() => new LanguageService(engine));

  // Bumped after every evaluation. Its only job is to change the identity of
  // the `decorate` callback below, which is what makes Slate drop its cached
  // decorations and re-classify. Without it, highlighting that depends on
  // document state (a bare word becoming a known variable) would never update.
  const [revision, setRevision] = useState(0);

  const evaluate = useCallback(
    (lines: string[]) => {
      // Variables live in the scope manager across evaluations, so deleting
      // the line that defined one would otherwise leave it resolvable forever.
      // A full re-parse starts from a clean scope.
      engine.getScopeManager().clear();
      language.invalidateCache();

      try {
        const parsed = engine.parseDocument(lines.join("\n"), {
          inputType: "markdown",
        });
        // Pinned to the editor's line count, not the parser's. A document that
        // ends in a newline comes back one line short, which would leave the
        // final editor row with no answer row opposite it and quietly break
        // the one invariant this layout depends on.
        const parsedAnswers = parsed.lines.map((line) => toAnswer(line, showErrors));
        setAnswers(
          lines.map((_, i) => parsedAnswers[i] ?? EMPTY),
        );
      } catch {
        // A throw here means the engine failed on the document as a whole
        // rather than on a line. Blanking the column is honest; showing the
        // previous answers next to different text would not be.
        setAnswers(lines.map(() => EMPTY));
      }
      setRevision((n) => n + 1);
    },
    [engine, language, showErrors],
  );

  useEffect(() => {
    evaluate(seed);
  }, [evaluate, seed]);

  const decorate = useCallback(
    ({ entry }: { entry: [{ text?: string }, number[]] }) => {
      const [node, path] = entry;
      if (typeof node.text !== "string") return [];
      // Slate paths into a flat paragraph list are [block, leaf], so the block
      // index is the zero-based line number.
      return classifyLine(language, node.text, (path[0] ?? 0) + 1, path);
    },
    // `revision` is unused in the body on purpose. See its declaration.
    [language, revision],
  );

  // Typing is the common case and evaluation is synchronous, so a short
  // debounce keeps a fast typist off the engine on every keystroke without the
  // answers ever feeling like they lag behind.
  const pending = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
    },
    [],
  );

  const handleChange = useCallback(
    ({ value }: { value: Array<{ children?: Array<{ text?: string }> }> }) => {
      const lines = value.map((block) =>
        (block.children ?? []).map((child) => child.text ?? "").join(""),
      );
      if (pending.current !== null) window.clearTimeout(pending.current);
      pending.current = window.setTimeout(() => evaluate(lines), 90);
    },
    [evaluate],
  );

  const rows = Math.max(answers.length, minRows);

  return (
    <div className={showErrors ? "notepad notepad--errors" : "notepad"}>
      <div className="notepad__lines">
        <Plate
          editor={editor}
          onValueChange={handleChange}
          renderLeaf={renderLeaf as never}
        >
          <PlateContent
            className="notepad__content"
            decorate={decorate as never}
            spellCheck={false}
            aria-label={label ?? "Solve notepad"}
          />
        </Plate>
      </div>
      <div className="notepad__answers" aria-live="polite" aria-atomic="false">
        {Array.from({ length: rows }, (_, i) => {
          const answer = answers[i] ?? EMPTY;
          return (
            <div
              key={i}
              className="notepad__answer"
              data-kind={answer.kind}
              data-matrix={answer.matrix ? "true" : undefined}
              /* A fully spelled out datetime is longer than any sane column
                 width, so the ellipsised ones stay readable on hover. Truncated
                 because some answers are much longer than that: a vector of
                 1,501 elements prints to 8,000 characters, and a tooltip is a
                 hint, not a document. */
              title={truncateForTooltip(answer.text)}
            >
              {answer.matrix ? (
                /* A matrix is a block, so it is the one answer that breaks the
                   one-row-per-line rule: the row grows to fit the grid. */
                <pre className="notepad__matrix">{answer.matrix}</pre>
              ) : (
                <>
                  {answer.swatch && (
                    <span className="notepad__swatch" style={{ background: answer.swatch }} aria-hidden="true" />
                  )}
                  {answer.text}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
