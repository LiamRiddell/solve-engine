import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";
import { solveGrammar, solveDocGrammar } from "./src/solve-grammar.js";
import { remarkMermaid } from "./src/plugins/remark-mermaid.mjs";
import { rehypeBaseLinks } from "./src/plugins/rehype-base-links.mjs";

// The API reference is generated from the engine's own TypeScript. TypeDoc reads
// the doc block on every public export, which `scripts/check-doc-coverage.mjs`
// already requires to exist, and renders it as markdown into `content/docs/api`.
// That output is generated at build time and gitignored, so the reference cannot
// drift from the shipped types the way a hand-written one would.
//
// Entry points are ordered the way someone learning the library meets them: the
// engine and the language service first, the formatting and error surfaces next,
// and the lower-level lexer, parser and VM after, rather than the alphabetical
// order the exports map happens to use.
const [starlightTypeDoc, typeDocSidebarGroup] = createStarlightTypeDocPlugin();

const engine = "../packages/engine";
const apiEntryPoints = [
	"api",
	"engine",
	"language",
	"format",
	"errors",
	"services",
	"constants",
	"variables",
	"resolvers",
	"normalizer",
	"lexer",
	"parser",
	"vm",
	"packages",
	"testing",
	"utilities",
	"uom",
].map((name) => `${engine}/src/${name}/index.ts`);

// GitHub Pages serves a project site from a subdirectory named after the
// repository, so every absolute URL the site emits has to be prefixed. Getting
// this wrong produces a site that loads its HTML and none of its CSS.
//
// Read from the environment so the deploy workflow can pass the real repository
// name rather than this file guessing it. The fallback matches local `astro dev`
// and `astro preview`, where there is no prefix.
const base = process.env.SITE_BASE ?? "/";
const site = process.env.SITE_URL ?? "https://liamriddell.github.io";

export default defineConfig({
  site,
  base,
  // Emit `page/index.html` rather than `page.html`, which keeps links working
  // with and without a trailing slash on a static host.
  build: { format: "directory" },
  vite: {
    optimizeDeps: {
      // Mermaid loads one renderer per diagram type through its own dynamic
      // imports. Vite's dev pre-bundler has to be told to follow them, or the
      // first sequence diagram on a page requests a chunk that was never
      // produced and falls back to showing its source. Excluding mermaid
      // instead is not an option: it depends on dayjs, which is CommonJS and
      // needs the interop the pre-bundler provides.
      include: ["mermaid"],
    },
  },
  markdown: {
    // Runs before Expressive Code, which is the point: a ```mermaid block has
    // to be taken out of the code-block pipeline before it gets drawn as
    // source.
    remarkPlugins: [remarkMermaid],
    // A link typed into a page is emitted as written, so a cross-reference to
    // `/syntax/cheatsheet/` 404s once the site is served from a repository
    // subdirectory. This puts the base back on, everywhere, once.
    rehypePlugins: [[rehypeBaseLinks, { base }]],
  },
  integrations: [
    starlight({
      plugins: [
        starlightTypeDoc({
          entryPoints: apiEntryPoints,
          // The engine's tsconfig, for its `@solve-js/*` path aliases. Without
          // it TypeDoc cannot resolve the cross-module imports and documents an
          // empty surface.
          tsconfig: `${engine}/tsconfig.json`,
          output: "api",
          sidebar: { label: "API reference", collapsed: true },
          typeDoc: {
            // Each entry point is one module, matching one subpath export, so
            // the reference is organised the way the package is imported.
            entryPointStrategy: "resolve",
            // Keep the reading order set in `apiEntryPoints` (engine and the
            // language service first, the lexer/parser/VM internals last)
            // rather than resorting the modules alphabetically, which would
            // open the reference on `constants`.
            sortEntryPoints: false,
            // The barrels have no README of their own; the section index is
            // generated instead.
            readme: "none",
            // A member's own page, so a large class does not render as one wall.
            outputFileStrategy: "members",
            useCodeBlocks: true,
            expandObjects: true,
            parametersFormat: "table",
          },
        }),
      ],
      title: "Solve",
      description:
        "An expression evaluation engine for natural, human-readable calculations. Lexer, Pratt parser, bytecode VM, and an extensible package system.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/LiamRiddell/solve-engine",
        },
      ],
      editLink: {
        baseUrl:
          "https://github.com/LiamRiddell/solve-engine/edit/main/docs/",
      },
      favicon: "/favicon.svg",
      components: {
        // Only to add one script. Every `solve` block on a reference page is
        // upgraded to an editable notepad in the browser, which keeps the
        // Expressive Code block as the fallback and keeps the markdown as the
        // single source the doc-example test reads.
        Head: "./src/components/Head.astro",
        // Same parts as the default, arranged as one band rather than as three
        // columns aligned to the content beneath. See the component.
        Header: "./src/components/Header.astro",
      },
      // Order matters and is a dependency chain, not a preference: tokens
      // define the palette, theme maps it onto Starlight's own variables, and
      // components reads the result.
      customCss: [
        "./src/styles/tokens.css",
        "./src/styles/theme.css",
        "./src/styles/components.css",
        "./src/styles/notepad.css",
        "./src/styles/mermaid.css",
        "./src/styles/pipeline.css",
        "./src/styles/pipeline-map.css",
        "./src/styles/explainer.css",
        "./src/styles/landing.css",
      ],
      expressiveCode: {
        // Registers the ```solve language, and ```solve-doc for whole-document
        // examples (see solve-grammar.js). Without them every example in the
        // syntax reference falls back to unhighlighted plain text.
        shiki: { langs: [solveGrammar, solveDocGrammar] },
        // One Dark is the palette the playground's CodeMirror editor uses, so
        // an expression looks the same in the docs as it does when the reader
        // pastes it into the playground.
        themes: ["one-dark-pro", "github-light"],
        styleOverrides: {
          borderRadius: "calc(var(--radius) + 4px)",
          borderColor: "var(--border)",
          codeFontFamily: "var(--sl-font-mono)",
          codeFontSize: "var(--sl-text-sm)",
          // Both themes paint their own near-black/near-white slab, which
          // would sit as an opaque rectangle on top of the ambient backdrop.
          // Transparent lets the glass frame in components.css show through.
          codeBackground: "transparent",
          frames: {
            editorTabBarBackground: "transparent",
            editorActiveTabBackground: "transparent",
            editorActiveTabIndicatorTopColor: "var(--primary)",
            editorTabBarBorderBottomColor: "var(--border)",
            terminalBackground: "transparent",
            terminalTitlebarBackground: "transparent",
            terminalTitlebarBorderBottomColor: "var(--border)",
            frameBoxShadowCssValue: "none",
          },
        },
      },
      // Every group is listed rather than autogenerated. Autogeneration sorts a
      // directory alphabetically, which put the bytecode virtual machine before
      // the overview that introduces it, and Async and live data before
      // Embedding the engine. Alphabetical order is not an order; it is the
      // absence of one, and a documentation sidebar is a reading order.
      //
      // The cost is that a new page has to be added here to appear. That is
      // what `scripts/check-sidebar.mjs` is for: it fails the build when a page
      // exists and this file has not been told about it.
      sidebar: [
        {
          label: "Getting started",
          items: [
            { slug: "getting-started/introduction" },
            { slug: "getting-started/installation" },
            { slug: "getting-started/quick-start" },
            { slug: "getting-started/concepts" },
          ],
        },
        {
          // Every documentation page, ordered alphabetically by title, so a
          // reader scanning the sidebar finds a topic by name (the way the
          // playground's example gallery is ordered). The unit reference, a
          // generated lookup table rather than a topic to read, is split out
          // into its own "Reference" group below.
          label: "Documentation",
          items: [
            { slug: "syntax/algebra" },
            { slug: "syntax/calculus" },
            { slug: "syntax/category-tags" },
            { slug: "syntax/charts" },
            { slug: "syntax/cheatsheet" },
            { slug: "syntax/colours" },
            { slug: "syntax/complex" },
            { slug: "syntax/conditionals" },
            { slug: "syntax/constants" },
            { slug: "syntax/dates" },
            { slug: "syntax/dice" },
            { slug: "syntax/geometry" },
            { slug: "syntax/goal-seek" },
            { slug: "syntax/hashing" },
            { slug: "syntax/health" },
            { slug: "syntax/knowledge" },
            { slug: "syntax/line-references" },
            { slug: "syntax/map-reduce-and-aggregates" },
            { slug: "syntax/money-and-finance" },
            { slug: "syntax/networking" },
            { slug: "syntax/numbers-and-math" },
            { slug: "syntax/numerals" },
            { slug: "syntax/percentages" },
            { slug: "syntax/programmer-math" },
            { slug: "syntax/random" },
            { slug: "syntax/ratios" },
            { slug: "syntax/statistics" },
            { slug: "syntax/stocks" },
            { slug: "syntax/symbolic" },
            { slug: "syntax/table-columns" },
            { slug: "syntax/text-encoding" },
            { slug: "syntax/text-operations" },
            { slug: "syntax/time" },
            { slug: "syntax/trigger-words" },
            { slug: "syntax/units-and-conversions" },
            { slug: "syntax/variables" },
            { slug: "syntax/vectors-and-matrices" },
            { slug: "syntax/weather" },
          ],
        },
        {
          // The generated unit-spelling lookup, kept apart from the reading
          // pages: it is a reference table, not a topic. Sits right after the
          // documentation group in the nav.
          label: "Reference",
          items: [
            { slug: "syntax/unit-reference" },
          ],
        },
        {
          // The order an integration actually happens in.
          label: "Embedding guide",
          items: [
            { slug: "guide/embedding" },
            { slug: "guide/upgrading-to-2" },
            { slug: "guide/typescript-usage" },
            { slug: "guide/explaining-lines" },
            { slug: "guide/formatting" },
            { slug: "guide/editor-integration" },
            { slug: "guide/async-and-live-data" },
            { slug: "guide/async-data-sources" },
            { slug: "guide/performance" },
            { slug: "guide/security" },
            { slug: "guide/subpath-exports" },
          ],
        },
        {
          // A reading order, not alphabetical: the overview, then the reference
          // index, then a hands-on guide per extension point in pipeline order,
          // then testing.
          label: "Writing packages",
          items: [
            { slug: "packages/authoring-a-package" },
            { slug: "packages/recognising-phrases" },
            { slug: "packages/units-and-keywords" },
            { slug: "packages/functions-and-operators" },
            { slug: "packages/as-converters" },
            { slug: "packages/highlighting-and-completions" },
            { slug: "packages/testing-a-package" },
          ],
        },
        {
          // Overview first, then the pipeline it describes, then the two pieces
          // the pipeline leans on, then the reasoning behind all of it.
          label: "Architecture",
          items: [
            { slug: "architecture/overview" },
            { slug: "architecture/pipeline" },
            { slug: "architecture/bytecode-vm" },
            { slug: "architecture/package-system" },
            { slug: "architecture/design-decisions" },
          ],
        },
        {
          label: "Contributing",
          items: [
            { slug: "contributing/development-setup" },
            { slug: "contributing/coding-standards" },
            { slug: "contributing/testing" },
            { slug: "contributing/releasing" },
          ],
        },
        {
          label: "Playground",
          link: "/playground/",
          attrs: { target: "_self" },
        },
        // Populated by starlight-typedoc at build time. The pages under it are
        // generated into `content/docs/api` and are not in the repository, so
        // `scripts/check-sidebar.mjs` skips that prefix rather than reporting
        // every generated page as missing from this file.
        typeDocSidebarGroup,
      ],
    }),
    // The landing page runs the real engine in a Plate editor. Those islands
    // are `client:only`, so React never renders on the server and the engine
    // is never imported into Node during the build.
    react(),
  ],
});
