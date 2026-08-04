/**
 * Renders the diagrams the remark plugin left on the page.
 *
 * ## Why this runs in the browser
 *
 * The alternative is rendering to SVG during the build, which mermaid does by
 * driving a real browser. That means a Playwright download in CI for the sake
 * of five pages, and a build that fails for reasons unrelated to the site. The
 * diagram source is already in the page as readable text, so a reader without
 * JavaScript loses the picture but keeps the content, which is the same trade
 * the live notepads make.
 *
 * ## Why it is lazy
 *
 * Mermaid is large. Only the architecture pages carry diagrams, and even there
 * nothing is fetched until a diagram is near the viewport.
 *
 * ## Theming
 *
 * Mermaid wants concrete colours, not CSS custom properties, so the palette is
 * read off the document at render time and handed over as theme variables. That
 * makes a theme switch a re-render rather than a restyle, which is why the
 * source is kept in a data attribute instead of being consumed.
 */

type MermaidModule = typeof import("mermaid");

let mermaidPromise: Promise<MermaidModule["default"]> | null = null;
let counter = 0;

/** Reads one custom property off the root element, trimmed. */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/**
 * Builds the theme variables from the site's own tokens.
 *
 * The design language here is the same one the rest of the page uses: no fills
 * to speak of, hairline borders, one accent used only where a diagram is making
 * a point. Mermaid's "base" theme is the only one that takes instruction, so
 * everything is stated rather than inherited.
 */
function themeVariables(): Record<string, string> {
  const foreground = token("--foreground", "#fcfcfe");
  const muted = token("--muted-foreground", "#9aa0a2");
  const faint = token("--faint", "#6b7173");
  const border = token("--border-strong", "#2a2f31");
  const surface = token("--muted", "rgba(252,252,254,0.03)");
  const background = token("--background", "#03080a");
  const accent = token("--primary", "#c8ff00");

  return {
    darkMode: token("--background", "#03080a") === "#03080a" ? "true" : "false",
    background,
    fontFamily: token("--sl-font", "system-ui, sans-serif"),
    fontSize: "14px",

    // Nodes. A tinted surface with a hairline, the same treatment every panel
    // on the site gets.
    primaryColor: surface,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    secondaryColor: surface,
    secondaryTextColor: foreground,
    secondaryBorderColor: border,
    tertiaryColor: surface,
    tertiaryTextColor: foreground,
    tertiaryBorderColor: border,
    mainBkg: surface,
    nodeBorder: border,
    nodeTextColor: foreground,
    textColor: foreground,

    // Edges. Dimmer than the nodes, because the shape of the flow should read
    // before any individual arrow does.
    lineColor: faint,
    edgeLabelBackground: background,

    // Subgraphs.
    clusterBkg: "transparent",
    clusterBorder: token("--border", "#1a1f21"),
    titleColor: muted,

    // Sequence diagrams.
    actorBkg: surface,
    actorBorder: border,
    actorTextColor: foreground,
    actorLineColor: faint,
    signalColor: foreground,
    signalTextColor: muted,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    labelTextColor: foreground,
    loopTextColor: muted,
    noteBkgColor: surface,
    noteBorderColor: border,
    noteTextColor: muted,
    sequenceNumberColor: background,

    // State and flowchart accents.
    activeTaskBkgColor: accent,
    altBackground: background,
  };
}

async function loadMermaid(): Promise<MermaidModule["default"]> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

/** Renders one `<pre data-mermaid>` in place, keeping its source for later. */
async function render(pre: HTMLElement): Promise<void> {
  const source = pre.dataset.source ?? pre.textContent ?? "";
  if (!source.trim()) return;
  pre.dataset.source = source;

  let mermaid: MermaidModule["default"];
  try {
    mermaid = await loadMermaid();
  } catch (error) {
    // The source stays on the page and stays readable, so this costs the
    // picture and nothing else. Still worth saying out loud.
    console.error("[solve] could not load mermaid", error);
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: themeVariables(),
    flowchart: { curve: "basis", padding: 14, useMaxWidth: true },
    sequence: { useMaxWidth: true },
  });

  try {
    const { svg } = await mermaid.render(`solve-diagram-${counter++}`, source);
    pre.innerHTML = svg;
    pre.dataset.rendered = "true";
  } catch (error) {
    // A diagram that does not parse is an authoring mistake, and the raw source
    // left in place is the most useful thing to show while it is being fixed.
    console.error("[solve] could not render a diagram", error);
  }
}

/**
 * Re-renders every diagram already on screen when the theme changes.
 *
 * Mermaid bakes its palette into the SVG it produces, so a diagram rendered in
 * dark mode stays dark after a switch. Re-rendering from the kept source is the
 * only way back.
 */
function watchTheme(): void {
  let scheduled = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(scheduled);
    scheduled = window.setTimeout(() => {
      const rendered = document.querySelectorAll<HTMLElement>(
        'pre[data-mermaid][data-rendered="true"]',
      );
      for (const pre of rendered) void render(pre);
    }, 60);
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/**
 * Renders everything, regardless of what is on screen.
 *
 * Printing is the case that needs this: the intersection observer only ever
 * fires for the diagrams a reader scrolled past, so a page sent to a printer
 * after skimming comes out with some diagrams drawn and the rest as source.
 */
function renderAll(): void {
  const pending = document.querySelectorAll<HTMLElement>(
    "pre[data-mermaid]:not([data-rendered])",
  );
  for (const pre of pending) void render(pre);
}

function init(): void {
  const diagrams = document.querySelectorAll<HTMLElement>("pre[data-mermaid]");
  if (diagrams.length === 0) return;

  watchTheme();
  window.addEventListener("beforeprint", renderAll);

  if (typeof IntersectionObserver !== "function") {
    renderAll();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        void render(entry.target as HTMLElement);
      }
    },
    { rootMargin: "400px" },
  );

  for (const pre of diagrams) observer.observe(pre);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
