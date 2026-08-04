/**
 * Content for the stepped explainers scattered through the documentation.
 *
 * These exist for the handful of behaviours that a paragraph describes badly:
 * things that happen in a sequence, to several things at once, over time. A
 * dependency graph invalidating three lines out of seven is one sentence to
 * write and a genuinely hard thing to picture.
 *
 * Everything quoted here is either a value the engine produced (the worked
 * document below was run through it) or a restatement of what the surrounding
 * page already says. Nothing is invented for the sake of the picture.
 */

/** What is happening to one line of a document at this step. */
export type LineState =
  | "idle"
  | "edited"
  | "stale"
  | "computed"
  | "cached"
  | "pending"
  | "resolved"
  | "error";

export interface LineCell {
  text: string;
  /** The answer column. Omitted for a line that has none yet. */
  value?: string;
  state: LineState;
  /** A short label in the margin, for the state that needs naming. */
  tag?: string;
}

/** One box in a left-to-right or top-down sequence. */
export interface FlowNode {
  label: string;
  detail?: string;
  /** Marks the node this step is about. */
  active?: boolean;
  /** Struck through: this step skips it. */
  skipped?: boolean;
}

/** One labelled chip, as the pipeline walkthrough draws tokens. */
export interface Chip {
  text: string;
  label?: string;
  /** Marks a chip this step introduced or changed. */
  changed?: boolean;
  /** A CSS class to colour the chip's text, for the highlighting explainer. */
  className?: string;
}

export type Figure =
  | { kind: "lines"; lines: LineCell[] }
  | { kind: "flow"; nodes: FlowNode[]; direction?: "row" | "column" }
  | { kind: "chips"; chips: Chip[]; caption?: string };

export interface ExplainerStep {
  title: string;
  summary: string;
  figure: Figure;
  note: string;
}

export interface Explainer {
  /** Shown above the rail, in the eyebrow position. */
  eyebrow: string;
  steps: ExplainerStep[];
}

/**
 * The document every incremental-evaluation step operates on.
 *
 * Values are what the engine returned for it, not what arithmetic says they
 * should be, so the currency formatting is the engine's own.
 */
const QUOTE = [
  { text: "rate = 65 USD", value: "$65.00" },
  { text: "hours = 18.5", value: "18.50" },
  { text: "labour = rate * hours", value: "$1202.50" },
  { text: "materials = 240 USD", value: "$240.00" },
  { text: "subtotal = labour + materials", value: "$1442.50" },
  { text: "vat = 20% of subtotal", value: "$288.50" },
  { text: "total = subtotal + vat", value: "$1731.00" },
];

/** Applies per-line states to the quote, leaving the rest idle. */
function quote(
  overrides: Record<number, Partial<LineCell>>,
  base: LineState = "idle",
): LineCell[] {
  return QUOTE.map((line, index) => ({
    text: line.text,
    value: line.value,
    state: base,
    ...overrides[index],
  }));
}

export const EXPLAINERS: Record<string, Explainer> = {
  /* ── Incremental evaluation ───────────────────────────────────────────── */

  incremental: {
    eyebrow: "One keystroke",
    steps: [
      {
        title: "First pass",
        summary: "Every line evaluated once.",
        figure: { kind: "lines", lines: quote({}, "computed") },
        note: "Nothing is cached yet, so all seven lines lex, normalise, parse, compile and run. This is the only time the document costs the full pipeline.",
      },
      {
        title: "An edit",
        summary: "hours becomes 20.",
        figure: {
          kind: "lines",
          lines: quote(
            {
              1: {
                text: "hours = 20",
                value: undefined,
                state: "edited",
                tag: "edited",
              },
            },
            "cached",
          ),
        },
        note: "One character changed on line 2. The naive answer is to run the document again. The engine asks a narrower question first: who was reading hours?",
      },
      {
        title: "Invalidation",
        summary: "The graph names the dependents.",
        figure: {
          kind: "lines",
          lines: quote(
            {
              1: { text: "hours = 20", value: undefined, state: "edited", tag: "edited" },
              2: { value: undefined, state: "stale", tag: "stale" },
              4: { value: undefined, state: "stale", tag: "stale" },
              5: { value: undefined, state: "stale", tag: "stale" },
              6: { value: undefined, state: "stale", tag: "stale" },
            },
            "cached",
          ),
        },
        note: "labour reads hours, subtotal reads labour, vat reads subtotal, total reads both. Four lines are transitively affected. rate and materials read nothing that changed, so they are not.",
      },
      {
        title: "Recompute",
        summary: "Four lines, not seven.",
        figure: {
          kind: "lines",
          lines: quote(
            {
              1: { text: "hours = 20", value: "20", state: "computed" },
              2: { value: "$1300.00", state: "computed" },
              4: { value: "$1540.00", state: "computed" },
              5: { value: "$308.00", state: "computed" },
              6: { value: "$1848.00", state: "computed" },
            },
            "cached",
          ),
        },
        note: "The three untouched lines are served from the line-result cache without executing anything. On a document of two hundred lines this is the difference between a responsive editor and a laggy one.",
      },
    ],
  },

  /* ── Caching layers ───────────────────────────────────────────────────── */

  caches: {
    eyebrow: "Three layers",
    steps: [
      {
        title: "Cold",
        summary: "A line nobody has seen.",
        figure: {
          kind: "flow",
          nodes: [
            { label: "Lex", active: true },
            { label: "Normalise", active: true },
            { label: "Parse", active: true },
            { label: "Compile", active: true },
            { label: "Execute", active: true },
          ],
        },
        note: "Every stage runs. This is the full cost, and it is paid once per distinct expression text.",
      },
      {
        title: "Bytecode cache",
        summary: "Same text, seen before.",
        figure: {
          kind: "flow",
          nodes: [
            { label: "Lex", skipped: true },
            { label: "Normalise", skipped: true },
            { label: "Parse", skipped: true },
            { label: "Compile", skipped: true },
            { label: "Execute", active: true },
          ],
        },
        note: "Compiled programs are cached by expression text, so an expression the engine has compiled before skips the entire front half. Only execution is left.",
      },
      {
        title: "Line cache",
        summary: "Same line, nothing it depends on changed.",
        figure: {
          kind: "flow",
          nodes: [
            { label: "Lex", skipped: true },
            { label: "Normalise", skipped: true },
            { label: "Parse", skipped: true },
            { label: "Compile", skipped: true },
            { label: "Execute", skipped: true },
          ],
        },
        note: "Line results are cached separately from bytecode. When the dependency graph says a line cannot have changed, its previous result is returned and nothing runs at all.",
      },
      {
        title: "Together",
        summary: "Why a keystroke is cheap.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "Dependency graph", detail: "which lines could have changed", active: true },
            { label: "Line result cache", detail: "answers for the ones that could not" },
            { label: "Bytecode cache", detail: "programs for the ones that must run again" },
          ],
        },
        note: "The graph decides what has to happen, the line cache answers everything else for free, and the bytecode cache means even the lines that do run rarely pay to be compiled.",
      },
    ],
  },

  /* ── Pending values ───────────────────────────────────────────────────── */

  pending: {
    eyebrow: "Live data",
    steps: [
      {
        title: "First evaluation",
        summary: "The rate is not known yet.",
        figure: {
          kind: "lines",
          lines: [
            { text: "budget = 2400 USD", value: "$2400.00", state: "computed" },
            { text: "in_gbp = budget to GBP", state: "pending", tag: "pending" },
            { text: "half = in_gbp / 2", state: "pending", tag: "pending" },
          ],
        },
        note: "The conversion needs a rate that has not arrived. The engine returns a value whose type is pending, carrying the key of the query it is waiting on, rather than blocking or guessing.",
      },
      {
        title: "It propagates",
        summary: "Pending is a value, so it flows.",
        figure: {
          kind: "lines",
          lines: [
            { text: "budget = 2400 USD", value: "$2400.00", state: "computed" },
            { text: "in_gbp = budget to GBP", state: "pending", tag: "pending" },
            { text: "half = in_gbp / 2", state: "pending", tag: "pending" },
          ],
        },
        note: "Line 3 divides a pending value by two and gets a pending value back. Nothing had to check for it. This is the same reason an error arrives at the top with its cause intact instead of becoming a confident zero.",
      },
      {
        title: "The fetch",
        summary: "Started in the background.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "Engine records the query", detail: "and which line depends on it", active: true },
            { label: "Your fetcher runs", detail: "the engine never holds credentials" },
            { label: "Result arrives", detail: "and the host is told" },
          ],
        },
        note: "Wiring that last notification is the host's responsibility. If it is not connected, pending values never resolve and nothing tells you why, which is the single most common integration mistake.",
      },
      {
        title: "Resolution",
        summary: "The line, and everything below it.",
        figure: {
          kind: "lines",
          lines: [
            { text: "budget = 2400 USD", value: "$2400.00", state: "cached" },
            { text: "in_gbp = budget to GBP", value: "£1896.00", state: "resolved", tag: "resolved" },
            { text: "half = in_gbp / 2", value: "£948.00", state: "computed" },
          ],
        },
        note: "Re-evaluation goes through the same dependency graph as any other change, so the arrival of one rate recomputes exactly the lines that were waiting on it. The illustrative rate here is not a real one.",
      },
    ],
  },

  /* ── Highlighting ─────────────────────────────────────────────────────── */

  highlighting: {
    eyebrow: "Editor integration",
    steps: [
      {
        title: "A line of text",
        summary: "What your editor has.",
        figure: {
          kind: "chips",
          chips: [{ text: "12 km in miles" }],
          caption: "One string. No structure yet.",
        },
        note: "Your editor knows where the caret is and what the line says. It knows nothing about what any of it means, and it should not have to.",
      },
      {
        title: "Semantic tokens",
        summary: "getSemanticTokens(line, number)",
        figure: {
          kind: "chips",
          chips: [
            { text: "12", label: "number", className: "solve-number" },
            { text: "km", label: "unit", className: "solve-unit" },
            { text: "in", label: "keyword", className: "solve-keyword" },
            { text: "miles", label: "unit", className: "solve-unit" },
          ],
        },
        note: "The language service returns a category and a span for each token. These come from the engine's own lexer, so a package that adds vocabulary is categorised without the editor learning anything new.",
      },
      {
        title: "Class names",
        summary: "tokenClassName(category)",
        figure: {
          kind: "chips",
          chips: [
            { text: "solve-number", changed: true },
            { text: "solve-unit", changed: true },
            { text: "solve-keyword", changed: true },
            { text: "solve-unit", changed: true },
          ],
          caption: "The category name is the class-name key.",
        },
        note: "A stable, editor-agnostic class per category. A package that registers a brand new category gets a predictable class for free, and the prefix is yours to change if your app already owns a namespace.",
      },
      {
        title: "Colour",
        summary: "Ordinary CSS, in your stylesheet.",
        figure: {
          kind: "chips",
          chips: [
            { text: "12", className: "solve-number" },
            { text: "km", className: "solve-unit" },
            { text: "in", className: "solve-keyword" },
            { text: "miles", className: "solve-unit" },
          ],
          caption: "This line is coloured by exactly that route.",
        },
        note: "The engine ships no colours and no editor bindings. It hands you spans and names; where those become decorations, marks or spans is your integration, and it is a dozen lines in any editor.",
      },
    ],
  },
};
