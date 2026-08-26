/**
 * Turns every `solve` code block in the documentation into a live notepad.
 *
 * ## Why this runs in the browser rather than at build time
 *
 * The blocks are the documentation's contract. `DocExamples.spec.ts` reads the
 * markdown, evaluates every line and asserts the `// expected` value beside it,
 * so a page cannot drift from the engine without the build going red. Rewriting
 * the blocks in a remark plugin would take them out of Expressive Code's hands
 * and leave a reader without JavaScript, and Pagefind, looking at a bare `<pre>`
 * where a highlighted, verified example used to be.
 *
 * Upgrading them on the client instead means the rendered block IS the fallback.
 * It is the same verified text, highlighted, indexed and readable on its own.
 * The notepad replaces it only once there is a runtime to replace it with.
 *
 * ## Why the runtime is loaded lazily
 *
 * React, Plate and the engine come to roughly a megabyte before compression.
 * That is a fair price on the landing page, whose entire argument is the live
 * demo, and a poor one on a reference page a reader may have opened to check a
 * single unit name. So nothing is fetched until a block is close to the
 * viewport, and a page whose examples are never scrolled to never pays.
 */

/** Reads the plain source back out of an Expressive Code block. */
function readSource(pre: HTMLElement): string {
  const lines = pre.querySelectorAll(".ec-line");
  if (lines.length === 0) return pre.textContent ?? "";
  return Array.from(lines)
    .map((line) => (line.textContent ?? "").replace(/\s+$/, ""))
    .join("\n");
}

/**
 * Drops the documented result from each line.
 *
 * A live block shows its answers in the answer column, so repeating them as
 * comments would say the same thing twice. Splitting on the LAST marker rather
 * than the first is deliberate and matches the test: in `2 + 2 // note // 4`
 * the expression is everything up to the final marker, not the first.
 */
function stripExpectations(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const marker = line.lastIndexOf("//");
      return marker === -1 ? line : line.slice(0, marker).replace(/\s+$/, "");
    })
    .join("\n");
}

/**
 * Splits a block the way the test suite does.
 *
 * A blank line inside a block starts a fresh engine, which is how a page shows
 * two unrelated examples without the first one's variables leaking into the
 * second. One notepad per group preserves that. No block in the documentation
 * needs this today, but a block that did would otherwise quietly display
 * different answers from the ones the test verified.
 */
function toGroups(source: string): string[] {
  return source
    .split(/\n\s*\n/)
    .map((group) => group.replace(/\s+$/, ""))
    .filter((group) => group.trim().length > 0);
}

type Mounter = (
  host: HTMLElement,
  source: string,
  options?: { incremental?: boolean },
) => void;
let mounterPromise: Promise<Mounter> | null = null;

/**
 * Whether a block holds a markdown table.
 *
 * A table is the one whole-document form that stays on the batch engine: that
 * pass skips a table's own rows, where the incremental engine would try to
 * evaluate them. Everything else in a `solve-doc` block (a `#tag` total, a
 * `line N` reference, goal seek) goes through the incremental engine, which is
 * the only one that can re-run a line for goal seek. See `evaluateDocument`.
 */
function hasTable(source: string): boolean {
  return /^\s*\|/m.test(source);
}

/**
 * Installs Vite's React Fast Refresh preamble, in development only.
 *
 * Astro emits that preamble on pages that render a React island. These pages
 * render none: the notepads are mounted by hand from a plain script so the
 * runtime can stay out of the initial bundle. Without the preamble the first
 * `.tsx` module to load throws `$RefreshSig$ is not defined` and every example
 * silently stays static. Production builds carry no refresh code at all, so
 * this is guarded rather than conditional on a try.
 */
async function installDevRefreshPreamble(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as Record<string, unknown>;
  if (w.__vite_plugin_react_preamble_installed__) return;

  const specifier = "/@react-refresh";
  const runtime = (await import(/* @vite-ignore */ specifier)) as {
    injectIntoGlobalHook: (w: unknown) => void;
  };
  runtime.injectIntoGlobalHook(window);
  w.$RefreshReg$ = () => {};
  w.$RefreshSig$ = () => (type: unknown) => type;
  w.__vite_plugin_react_preamble_installed__ = true;
}

function loadMounter(): Promise<Mounter> {
  if (!mounterPromise) {
    mounterPromise = installDevRefreshPreamble()
      .then(() => import("./mountNotepad"))
      .then((m) => m.mountNotepad);
  }
  return mounterPromise;
}

async function upgrade(
  block: HTMLElement,
  pre: HTMLElement,
  whole: boolean,
): Promise<void> {
  const source = readSource(pre);
  // A `solve-doc` block is one document end to end: a blank line inside it is a
  // boundary the aggregates read, not a break between two unrelated examples, so
  // it stays whole. A plain `solve` block splits on blank lines the way the test
  // suite does, one notepad per group.
  const groups = whole
    ? [source.replace(/\s+$/, "")].filter((g) => g.trim().length > 0)
    : toGroups(source);
  if (groups.length === 0) return;

  let mount: Mounter;
  try {
    mount = await loadMounter();
  } catch (error) {
    // The static block is already on the page and already correct, so a
    // runtime that fails to load costs the reader nothing but interactivity.
    // Still worth saying out loud, because a silent failure here looks
    // identical to a page that was never meant to be interactive.
    console.error("[solve] could not load the notepad runtime", error);
    return;
  }

  const live = document.createElement("div");
  live.className = "solve-embed__live";
  for (const group of groups) {
    const host = document.createElement("div");
    host.className = "solve-embed__notepad";
    live.append(host);
    // Route a whole-document block by content: a table on the batch engine,
    // everything else on the incremental one that goal seek needs.
    const incremental = whole && !hasTable(group);
    mount(host, stripExpectations(group), { incremental });
  }

  block.append(live);
  block.dataset.solveEmbed = "live";
}

function init(): void {
  const blocks = document.querySelectorAll<HTMLElement>(
    ".sl-markdown-content .expressive-code",
  );

  const pending: Array<[HTMLElement, HTMLElement, boolean]> = [];
  for (const block of blocks) {
    // A `solve-doc` block is a whole-document example; a `solve` block is the
    // per-line kind. Both become live notepads, they differ only in how the
    // block is grouped and which engine pass runs it (see upgrade()).
    const pre = block.querySelector<HTMLElement>(
      'pre[data-language="solve"], pre[data-language="solve-doc"]',
    );
    if (!pre) continue;
    const whole = pre.dataset.language === "solve-doc";
    block.classList.add("solve-embed");
    pending.push([block, pre, whole]);
  }
  if (pending.length === 0) return;

  if (typeof IntersectionObserver !== "function") {
    for (const [block, pre, whole] of pending) void upgrade(block, pre, whole);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const found = pending.find(([block]) => block === entry.target);
        if (found) void upgrade(found[0], found[1], found[2]);
      }
    },
    { rootMargin: "300px" },
  );

  for (const [block] of pending) observer.observe(block);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
