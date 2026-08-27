import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { createEngine } from "solve-engine";
import { evaluateDocument } from "solve-engine/engine";
import { formatValue, formatMatrixAligned, sparklineFor, type SparklineData } from "solve-engine/format";
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
  /** Drives the colour. `none` renders nothing at all; `pending` is a value still resolving over the network. */
  kind: "value" | "error" | "none" | "pending";
  /** A CSS colour string, set when the result is a colour, to draw an inline swatch. */
  swatch?: string;
  /** A stacked, column-aligned grid, set when the result is a matrix. */
  matrix?: string;
  /** A downsampled numeric series, set when the result is a numeric vector or range, to draw an inline sparkline. */
  sparkline?: SparklineData;
  /** Sampled (x, y) points, set when the result is a plot, to draw a small line chart. */
  plot?: { points: Array<[number, number]>; expr: string; from: number; to: number };
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
  /**
   * Evaluate the whole block as one document through the incremental engine
   * rather than the batch `parseDocument` pass.
   *
   * The two differ in one way that matters to a reader: only the incremental
   * path can re-run an earlier line, which is what goal seek
   * (`solve line N for x = target`) is. A `#tag` total or a `line N` reference
   * resolves either way, but goal seek returns a "needs a document" error
   * through the batch path, so a page that shows it opts into this. A markdown
   * table is the opposite case and stays on the batch path, which skips its
   * rows; this path would try to evaluate them. See `evaluateDocument`.
   */
  incremental?: boolean;
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
  // A pending value is a network lookup (weather, currency) that has not
  // returned yet. Show a quiet marker rather than its internal query key, and
  // let the async watcher below fill in the real answer once it arrives.
  if (v.type === ValueType.Pending) return { text: "…", kind: "pending" };
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
  // A numeric vector or range carries a plottable series on the live Value, so
  // the answer column can draw an inline sparkline beside the plain numbers. The
  // text answer is unchanged; the sparkline is additive decoration.
  const sparkline = sparklineFor(result as never) ?? undefined;
  if (v.type === ValueType.Matrix && v.value) {
    return { text, kind: "value", matrix: formatMatrixAligned(v.value as never), sparkline };
  }
  // A plot carries its sampled points on the live Value, so the answer column
  // draws the curve beside the label.
  if (v.type === ValueType.Plot && v.value) {
    return { text, kind: "value", plot: v.value as Answer["plot"] };
  }
  const kind = v.type === ValueType.Error ? "error" : "value";
  return { text, kind, sparkline };
}

/** A small line chart of a plot's sampled points, scaled to its own extent. */
function PlotChart({ plot }: { plot: NonNullable<Answer["plot"]> }) {
  const w = 150;
  const h = 46;
  const pts = plot.points;
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const points = pts
    .map(([x, y]) => `${(((x - minX) / spanX) * w).toFixed(1)},${(h - ((y - minY) / spanY) * h).toFixed(1)}`)
    .join(" ");
  // A zero line, drawn only when zero falls inside the plotted y-range.
  const zeroInRange = minY < 0 && maxY > 0;
  const zeroY = h - ((0 - minY) / spanY) * h;
  return (
    <svg
      className="notepad__plot"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {zeroInRange && (
        <line x1="0" y1={zeroY.toFixed(1)} x2={w} y2={zeroY.toFixed(1)} stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
      )}
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

/** The polyline points for a sparkline, scaled to a `w`×`h` box. */
function sparklinePoints(spark: SparklineData, w: number, h: number): string {
  const { series, min, max } = spark;
  const span = max - min || 1; // a flat series draws along the middle
  const n = series.length;
  return series
    .map((y, i) => {
      const px = n === 1 ? 0 : (i / (n - 1)) * w;
      const py = h - ((y - min) / span) * h;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
}

/** A small inline sparkline SVG drawn from a downsampled numeric series. */
function Sparkline({ spark }: { spark: SparklineData }) {
  const w = 64;
  const h = 16;
  return (
    <svg
      className="notepad__sparkline"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={sparklinePoints(spark, w, h)} fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
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
  incremental = false,
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
  // createEngine registers every built-in package; the notepad renders any
  // solve expression, so it needs the full vocabulary (the bare constructor
  // now registers none, so an engine built with it would show no results).
  const [engine] = useState(() => createEngine());
  // The language service reads the engine's dependency graph to decide whether
  // a lone bare word is a known variable, so it has to be the same engine that
  // evaluates the document, not a second one.
  const [language] = useState(() => new LanguageService(engine));

  // Bumped after every evaluation. Its only job is to change the identity of
  // the `decorate` callback below, which is what makes Slate drop its cached
  // decorations and re-classify. Without it, highlighting that depends on
  // document state (a bare word becoming a known variable) would never update.
  const [revision, setRevision] = useState(0);

  // The lines currently on screen, so the async watcher below re-evaluates the
  // document as it stands now rather than the one it first mounted with.
  const linesRef = useRef<string[]>(seed);

  const evaluate = useCallback(
    (lines: string[]) => {
      linesRef.current = lines;
      // Variables live in the scope manager across evaluations, so deleting
      // the line that defined one would otherwise leave it resolvable forever.
      // A full re-parse starts from a clean scope.
      engine.getScopeManager().clear();
      language.invalidateCache();

      try {
        const text = lines.join("\n");
        const parsed = incremental
          ? evaluateDocument(engine, text, { inputType: "markdown" })
          : engine.parseDocument(text, { inputType: "markdown" });
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
    [engine, language, showErrors, incremental],
  );

  useEffect(() => {
    evaluate(seed);
  }, [evaluate, seed]);

  // Async resolution. A weather or currency line returns a pending value first,
  // and the real one arrives over the network a moment later. The engine
  // announces each arrival on its event stream, so read that stream for the
  // life of the notepad and re-evaluate the current document whenever a line
  // resolves, which is what fills the "…" in with a temperature. This is the
  // same getEventStream() loop a host integration uses (see the async guide),
  // scoped to this notepad's own engine. A block with no network line never
  // emits, so a page of pure arithmetic pays nothing for this.
  useEffect(() => {
    let cancelled = false;
    const reader = engine.getEventStream().getReader();
    (async () => {
      try {
        while (!cancelled) {
          const { value: event, done } = await reader.read();
          if (done || cancelled) break;
          if (event?.type === "lines-updated") evaluate(linesRef.current);
        }
      } catch {
        // Cancelling the reader on unmount rejects its in-flight read; there is
        // nothing to recover, the notepad is going away.
      }
    })();
    return () => {
      cancelled = true;
      reader.cancel().catch(() => {});
    };
  }, [engine, evaluate]);

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

  // The one place the strict one-row-per-line layout has to give. A matrix
  // answer is a stacked grid taller than a row (see notepad.css), and the two
  // columns are independent flows kept in step only by every row being the same
  // height on both sides. Left to itself a tall matrix answer grows only the
  // answer column, so every answer below it slides down out of step with the
  // line that produced it.
  //
  // So after each evaluation, give each editor line the height of its own
  // answer whenever that answer outgrew a row. The heights are read from the
  // answers, which re-render on every result change, which is exactly why the
  // answers live outside the editor in the first place: driving this from a
  // custom Slate element would miss the case where only an upstream variable
  // changed and a matrix's shape with it, because Slate would not re-render the
  // unchanged line. A layout effect writes the height before the browser
  // paints, so a row never flashes at the wrong size.
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const lineEls = root.querySelectorAll<HTMLElement>(".notepad__content > *");
    const answerEls = root.querySelectorAll<HTMLElement>(".notepad__answer");
    for (let i = 0; i < lineEls.length; i++) {
      const answer = answers[i];
      const answerEl = answerEls[i];
      // A matrix answer is the one that can outgrow a row; match the line to it.
      // Everything else reverts to the CSS row height rather than keeping a
      // stale inline one from when the line last held a matrix.
      lineEls[i].style.height =
        answer?.matrix && answerEl ? `${answerEl.offsetHeight}px` : "";
    }
  }, [answers]);

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
    <div ref={rootRef} className={showErrors ? "notepad notepad--errors" : "notepad"}>
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
                <>
                  <pre className="notepad__matrix">{answer.matrix}</pre>
                  {answer.sparkline && <Sparkline spark={answer.sparkline} />}
                </>
              ) : (
                <>
                  {answer.swatch && (
                    <span className="notepad__swatch" style={{ background: answer.swatch }} aria-hidden="true" />
                  )}
                  {answer.text}
                  {answer.sparkline && <Sparkline spark={answer.sparkline} />}
                  {answer.plot && <PlotChart plot={answer.plot} />}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
