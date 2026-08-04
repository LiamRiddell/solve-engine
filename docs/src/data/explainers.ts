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

/** One cell on the virtual machine's stack. */
export interface StackCell {
  /** What is in the cell, as the machine would print it. */
  value: string;
  /** The value's type, which is the point: the stack does not hold numbers. */
  type?: string;
  /** Marks a cell this step pushed or changed. */
  changed?: boolean;
}

export type Figure =
  | { kind: "lines"; lines: LineCell[] }
  | { kind: "stack"; cells: StackCell[]; instruction?: string }
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

  /* -- Values ------------------------------------------------------------ */

  values: {
    eyebrow: "Every result",
    steps: [
      {
        title: "A value",
        summary: "Type, payload, sometimes a unit.",
        figure: {
          kind: "stack",
          instruction: "12 km",
          cells: [{ value: "12 km", type: "Uom", changed: true }],
        },
        note: "Not a number with a label stuck to it. The type is part of the value and the unit travels with it, which is what lets the next operation reconcile the two sides rather than guess.",
      },
      {
        title: "Arithmetic keeps it",
        summary: "5 km + 3 km",
        figure: {
          kind: "stack",
          instruction: "ADD",
          cells: [{ value: "8 km", type: "Uom", changed: true }],
        },
        note: "Both operands carried a unit, so addition asked the unit system to reconcile them before adding. Had they been incompatible, the answer would have been an error rather than a number that looked fine.",
      },
      {
        title: "Errors are values",
        summary: "They propagate, they do not throw.",
        figure: {
          kind: "stack",
          instruction: "ADD",
          cells: [{ value: "no such symbol", type: "Error", changed: true }],
        },
        note: "Adding fifty to an error gives the error back, with its cause intact. Nothing along the way had to check for it, and nothing coerced it to zero on the way past.",
      },
      {
        title: "So is pending",
        summary: "Waiting is not the same as nothing.",
        figure: {
          kind: "stack",
          instruction: "MUL",
          cells: [{ value: "waiting on a rate", type: "Pending", changed: true }],
        },
        note: "A value whose data has not arrived is its own type, carrying the key of the query it is waiting on. Returning zero, or the last known number, is the failure mode this design exists to avoid.",
      },
    ],
  },

  /* -- Packages ---------------------------------------------------------- */

  packages: {
    eyebrow: "Every feature",
    steps: [
      {
        title: "A package declares",
        summary: "A plain object, every field optional.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "Vocabulary", detail: "keywords, operators and units the lexer should know", active: true },
            { label: "Parselets", detail: "how its token types parse, and how tightly they bind" },
            { label: "Functions", detail: "what the virtual machine can call" },
            { label: "Rules and categories", detail: "token rewrites, conversion targets, highlight categories" },
          ],
        },
        note: "You declare only the part of the language you are adding. Arithmetic itself is a package with exactly this shape, which is the strongest evidence that these are the real extension points rather than a reduced set offered to outsiders.",
      },
      {
        title: "Registration",
        summary: "Into shared registries, in order.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "Arithmetic first", detail: "so later packages build on a working operator set", active: true },
            { label: "Then the other built-ins" },
            { label: "Then yours" },
          ],
        },
        note: "Order matters and is not a preference. A package that adds an operator needs the operators it composes with to exist already.",
      },
      {
        title: "The pipeline reads them",
        summary: "It knows nothing about your feature.",
        figure: {
          kind: "flow",
          nodes: [
            { label: "Lexer", detail: "reads vocabulary", active: true },
            { label: "Normaliser", detail: "reads rewrite rules", active: true },
            { label: "Parser", detail: "reads parselets", active: true },
            { label: "Compiler", skipped: true },
            { label: "VM", detail: "reads functions", active: true },
          ],
        },
        note: "Four of the five stages consult a registry rather than a hardcoded table. The compiler is the exception: it emits opcodes for whatever the parselets produced, so it needs no knowledge of who produced them.",
      },
      {
        title: "Nothing is special",
        summary: "Percentages are a package. So are dates.",
        figure: {
          kind: "flow",
          nodes: [
            { label: "Arithmetic" },
            { label: "Percentage" },
            { label: "Datetime" },
            { label: "Units" },
            { label: "Currency" },
            { label: "Yours", active: true },
          ],
        },
        note: "There is no privileged core with plugins bolted around it. Your package is registered by the same call, into the same registries, with the same capabilities as the ones that shipped with the engine.",
      },
    ],
  },

  /* -- Why bytecode ------------------------------------------------------ */

  whyBytecode: {
    eyebrow: "The trade",
    steps: [
      {
        title: "Tree walking",
        summary: "Re-descend on every evaluation.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "Keystroke", detail: "the document is evaluated again", active: true },
            { label: "Walk the tree", detail: "a virtual call and a branch at every node" },
            { label: "Walk it again", detail: "next keystroke, same work" },
          ],
        },
        note: "The structure is convenient to build and expensive to run. Every evaluation pays the cost of navigating the shape as well as the cost of doing the arithmetic.",
      },
      {
        title: "Compile once",
        summary: "The parse emits bytecode directly.",
        figure: {
          kind: "flow",
          nodes: [
            { label: "Parse" },
            { label: "Bytecode", detail: "a flat byte array plus constant pools", active: true },
          ],
        },
        note: "No syntax tree is built at all. The parselets emit instructions as they go, which also means there is no tree to allocate and none to collect afterwards.",
      },
      {
        title: "Run many times",
        summary: "A loop over a byte array.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "Keystroke", active: true },
            { label: "Cached program", detail: "keyed by expression text" },
            { label: "Execute", detail: "a switch over bytes, no pointer chasing" },
          ],
        },
        note: "Sequential memory, a switch rather than dynamic dispatch, and compilation skipped entirely when the text has not changed. Compiling once and executing many times is the whole argument.",
      },
      {
        title: "And it can be bounded",
        summary: "The reason that matters most.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "Instruction budget", detail: "counted, per execution", active: true },
            { label: "Stack depth", detail: "checked, per instruction", active: true },
            { label: "A named error", detail: "rather than a hang" },
          ],
        },
        note: "Bounding a tree walk means threading a budget through a recursive descent. Bounding a loop over an array is a counter. The input is untrusted and arrives one character at a time, so this is not a nicety.",
      },
    ],
  },

  /* -- Dispatch ---------------------------------------------------------- */

  dispatch: {
    eyebrow: "One instruction",
    steps: [
      {
        title: "Fetch",
        summary: "Read the next opcode.",
        figure: {
          kind: "flow",
          nodes: [
            { label: "Fetch", active: true },
            { label: "Budget" },
            { label: "Depth" },
            { label: "Switch" },
            { label: "Advance" },
          ],
        },
        note: "The program counter indexes into a byte array. There is no node to visit and no pointer to follow.",
      },
      {
        title: "Check the budget",
        summary: "Before any work happens.",
        figure: {
          kind: "flow",
          nodes: [
            { label: "Fetch", skipped: true },
            { label: "Budget", active: true },
            { label: "Depth" },
            { label: "Switch" },
            { label: "Advance" },
          ],
        },
        note: "Every instruction increments a counter and compares it against a configurable limit. Exceeding it produces a named error, which is what turns a pathological expression into a message rather than a frozen tab.",
      },
      {
        title: "Check the depth",
        summary: "Same idea, other resource.",
        figure: {
          kind: "flow",
          nodes: [
            { label: "Fetch", skipped: true },
            { label: "Budget", skipped: true },
            { label: "Depth", active: true },
            { label: "Switch" },
            { label: "Advance" },
          ],
        },
        note: "Stack depth is bounded too, and separately configurable. Both limits are checked before the instruction runs rather than after, so nothing has been half done by the time a limit is reached.",
      },
      {
        title: "Dispatch",
        summary: "A switch, with a fast path.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "Both operands plain numbers?", active: true },
            { label: "Yes: inlined arithmetic", detail: "no function call, no allocation" },
            { label: "No: the general path", detail: "units, errors, pending, matrices" },
          ],
        },
        note: "The common case in a real document is two ordinary numbers, so the frequent arithmetic opcodes test for it and handle it inline. Everything else falls through to the path that knows about the other value types.",
      },
    ],
  },

  /* -- Values on the stack ----------------------------------------------- */

  stackValues: {
    eyebrow: "The stack",
    steps: [
      {
        title: "Push",
        summary: "PUSH_NUMBER 0",
        figure: {
          kind: "stack",
          instruction: "PUSH_NUMBER 0",
          cells: [{ value: "5", type: "Number", changed: true }],
        },
        note: "A constant from the number pool. So far this looks exactly like a stack of numbers, which is where most stack machines stop.",
      },
      {
        title: "Attach a unit",
        summary: "UOM_CONVERT",
        figure: {
          kind: "stack",
          instruction: "UOM_CONVERT",
          cells: [{ value: "5 km", type: "Uom", changed: true }],
        },
        note: "The number and the unit name are popped and one value is pushed in their place. The cell now holds something with a type, not a number that somebody downstream has to remember is kilometres.",
      },
      {
        title: "Two of them",
        summary: "The second operand, built the same way.",
        figure: {
          kind: "stack",
          instruction: "PUSH_NUMBER 1, PUSH_STRING 0, UOM_CONVERT",
          cells: [
            { value: "5 km", type: "Uom" },
            { value: "3 km", type: "Uom", changed: true },
          ],
        },
        note: "Both operands are unit values sitting on the stack. Addition has not happened yet, and when it does it will not need to know what a kilometre is.",
      },
      {
        title: "Operate",
        summary: "ADD",
        figure: {
          kind: "stack",
          instruction: "ADD",
          cells: [{ value: "8 km", type: "Uom", changed: true }],
        },
        note: "Both popped, the units reconciled, one value pushed. Had either been an error or a pending value, that is what would be sitting here instead, with its cause intact rather than flattened into a number.",
      },
    ],
  },

  /* -- Registration checks ----------------------------------------------- */

  registration: {
    eyebrow: "Refusals",
    steps: [
      {
        title: "Version range",
        summary: "Checked before anything is registered.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "The package declares a range", detail: "the engine version it was built against", active: true },
            { label: "In range: carry on" },
            { label: "Out of range: refused", detail: "with a message naming both versions" },
          ],
        },
        note: "Refusing at registration is the point. An incompatible package that registers successfully fails later, somewhere unrelated, in a way that looks like a bug in the package rather than a mismatch.",
      },
      {
        title: "Duplicate names",
        summary: "Refused, never overwritten.",
        figure: {
          kind: "chips",
          chips: [
            { text: "currency", label: "registered" },
            { text: "currency", label: "refused", changed: true },
          ],
          caption: "The second registration does not win. It does not happen.",
        },
        note: "A silent overwrite would orphan everything the first registration contributed, and the symptom would surface in whichever feature happened to stop working. Refusing keeps the failure next to its cause.",
      },
      {
        title: "Token collisions",
        summary: "Warned, because they cannot be refused.",
        figure: {
          kind: "chips",
          chips: [
            { text: "GAME_ITEM", label: "package A" },
            { text: "GAME_ITEM", label: "package B", changed: true },
          ],
          caption: "Both are named in the warning.",
        },
        note: "Two packages claiming the same token type would shadow each other silently, and the resulting misparse is extremely hard to trace back. The registry names both, which turns a mystery into a five-minute fix.",
      },
      {
        title: "Configuration",
        summary: "A factory, not a constant.",
        figure: {
          kind: "flow",
          direction: "column",
          nodes: [
            { label: "You supply the fetcher", detail: "so the engine never holds credentials", active: true },
            { label: "The factory returns a package" },
            { label: "Registered like any other" },
          ],
        },
        note: "This is how the stocks and knowledge packages take a data source. The engine gains a feature without gaining a network dependency or a secret to look after, which is also why those two are opt-in rather than built in.",
      },
    ],
  },

  /* -- Case sensitivity -------------------------------------------------- */

  caseSensitivity: {
    eyebrow: "Refusing to guess",
    steps: [
      {
        title: "One letter apart",
        summary: "Both of these are valid.",
        figure: {
          kind: "lines",
          lines: [
            { text: "5m", value: "5.00 m", state: "computed" },
            { text: "5M", value: "5,000,000", state: "computed" },
          ],
        },
        note: "Lower case m is metres. Upper case M is the millions suffix. These are the values the engine returns, and they differ by six orders of magnitude and a dimension.",
      },
      {
        title: "It is not an edge case",
        summary: "The same holds for k.",
        figure: {
          kind: "lines",
          lines: [
            { text: "2k", value: "2,000", state: "computed" },
            { text: "2K", value: "2.00 K", state: "computed" },
          ],
        },
        note: "Lower case k is the thousands suffix. Upper case K is kelvin. Anyone writing about temperature and anyone writing about money are both served, and neither has to escape anything.",
      },
      {
        title: "The alternative",
        summary: "Accept both cases, pick one.",
        figure: {
          kind: "lines",
          lines: [
            { text: "5M", value: "5.00 m", state: "error", tag: "wrong" },
            { text: "2K", value: "2,000", state: "error", tag: "wrong" },
          ],
        },
        note: "A case-insensitive engine has to choose, and whichever it chooses is silently wrong for the other reader. The answer still looks like an answer. Nothing about it invites a second look.",
      },
      {
        title: "So it keeps the case",
        summary: "Which is not the same as one spelling.",
        figure: {
          kind: "lines",
          lines: [
            { text: "5 m in cm", value: "500.00 cm", state: "computed" },
            { text: "5M + 1", value: "5,000,001", state: "computed" },
          ],
        },
        note: "Case carries meaning, so it is kept. That is not a rule about spelling: lb, lbs and pounds are all accepted, because those are the unit's own names rather than guesses about what you meant. What is refused is remapping one unit onto another.",
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
