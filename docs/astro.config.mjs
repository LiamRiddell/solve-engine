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
  // The six broad "catch-all" pages were split into one focused page per
  // feature. Anyone holding a link to an old page (a bookmark, a search result)
  // lands on the first page of what it became rather than a 404. Astro prepends
  // `base` to both sides, so these are written base-relative.
  redirects: {
    "/syntax/numbers-and-math/": "/syntax/operators/",
    "/syntax/programmer-math/": "/syntax/number-bases/",
    "/syntax/money-and-finance/": "/syntax/currency/",
    "/syntax/units-and-conversions/": "/syntax/unit-arithmetic/",
    "/syntax/dates/": "/syntax/date-literals/",
    "/syntax/algebra/": "/syntax/expanding/",
  },
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
        // Two readers, two umbrellas. Someone typing expressions into a notepad
        // wants the language; someone embedding or extending the engine wants the
        // code. Each reader sees their half as one top-level heading and can
        // ignore the other. Within an umbrella, the sub-groups are the areas that
        // reader browses by; the umbrella itself stays open so those areas are
        // visible at a glance, and each area collapses so the list stays scannable.
        {
          label: "Documentation",
          items: [
            {
              // The first four pages anyone reads, in reading order, ending on
              // the cheatsheet as the one-page tour of the whole language.
              label: "Start here",
              items: [
                { slug: "getting-started/introduction" },
                { slug: "getting-started/quick-start" },
                { slug: "getting-started/concepts" },
                { slug: "syntax/cheatsheet" },
              ],
            },
            {
              // Everyday number work: the operators, the ways a number can be
              // written, and the functions that reshape one. Foundations first,
              // then the forms a reader reaches for by name.
              label: "Arithmetic",
              collapsed: true,
              items: [
                { slug: "syntax/operators" },
                { slug: "syntax/number-suffixes" },
                { slug: "syntax/decimals" },
                { slug: "syntax/fractions" },
                { slug: "syntax/percentages" },
                { slug: "syntax/ratios" },
                { slug: "syntax/rounding" },
                { slug: "syntax/number-functions" },
                { slug: "syntax/uncertainty" },
              ],
            },
            {
              // Numbers written in a system other than plain base-ten decimal.
              label: "Numbers",
              collapsed: true,
              items: [
                { slug: "syntax/numerals" },
                { slug: "syntax/big-integers" },
                { slug: "syntax/complex" },
                { slug: "syntax/constants" },
              ],
            },
            {
              // The bit-level work a programmer reaches for.
              label: "Programmer math",
              collapsed: true,
              items: [
                { slug: "syntax/number-bases" },
                { slug: "syntax/bit-shifting" },
                { slug: "syntax/bitwise-operators" },
                { slug: "syntax/data-sizes" },
              ],
            },
            {
              // Working with the symbols themselves, not just their values.
              label: "Algebra",
              collapsed: true,
              items: [
                { slug: "syntax/expanding" },
                { slug: "syntax/factoring" },
                { slug: "syntax/solving-equations" },
                { slug: "syntax/cancelling-fractions" },
                { slug: "syntax/splitting-fractions" },
                { slug: "syntax/exact-coefficients" },
                { slug: "syntax/calculus" },
                { slug: "syntax/symbolic" },
              ],
            },
            {
              label: "Statistics",
              collapsed: true,
              items: [
                { slug: "syntax/vectors-and-matrices" },
                { slug: "syntax/statistics" },
              ],
            },
            {
              label: "Finance",
              collapsed: true,
              items: [
                { slug: "syntax/currency" },
                { slug: "syntax/money-precision" },
                { slug: "syntax/tax" },
                { slug: "syntax/recurring-schedules" },
                { slug: "syntax/splitting-a-bill" },
                { slug: "syntax/interest-and-inflation" },
                { slug: "syntax/savings-goals" },
                { slug: "syntax/payroll" },
                { slug: "syntax/shopping" },
                { slug: "syntax/stocks" },
                { slug: "syntax/crypto" },
              ],
            },
            {
              // Writing a date, doing arithmetic on it, and asking about the one
              // relative to today.
              label: "Dates",
              collapsed: true,
              items: [
                { slug: "syntax/date-literals" },
                { slug: "syntax/date-arithmetic" },
                { slug: "syntax/relative-dates" },
                { slug: "syntax/relative-months" },
                { slug: "syntax/nth-weekday" },
                { slug: "syntax/age" },
                { slug: "syntax/date-differences" },
                { slug: "syntax/working-days" },
                { slug: "syntax/displaying-dates" },
                { slug: "syntax/time" },
              ],
            },
            {
              // Quantities that carry a unit, and converting between them.
              label: "Units",
              collapsed: true,
              items: [
                { slug: "syntax/unit-arithmetic" },
                { slug: "syntax/cooking" },
                { slug: "syntax/converting-units" },
                { slug: "syntax/unit-representations" },
                { slug: "syntax/custom-units" },
                { slug: "syntax/css-units" },
                { slug: "syntax/screen-and-image-sizes" },
                { slug: "syntax/rates-and-speeds" },
                { slug: "syntax/travel" },
                { slug: "syntax/fuel-economy" },
                { slug: "syntax/derived-units" },
                { slug: "syntax/surveying-units" },
                { slug: "syntax/geometry" },
                { slug: "syntax/health" },
              ],
            },
            {
              label: "Text",
              collapsed: true,
              items: [
                { slug: "syntax/text-operations" },
                { slug: "syntax/text-encoding" },
                { slug: "syntax/hashing" },
                { slug: "syntax/networking" },
              ],
            },
            {
              label: "Visual",
              collapsed: true,
              items: [
                { slug: "syntax/charts" },
                { slug: "syntax/colours" },
              ],
            },
            {
              label: "Everyday",
              collapsed: true,
              items: [
                { slug: "syntax/dice" },
                { slug: "syntax/random" },
              ],
            },
            {
              label: "Live data",
              collapsed: true,
              items: [
                { slug: "syntax/weather" },
                { slug: "syntax/knowledge" },
              ],
            },
            {
              // The forms that read or re-run other lines rather than standing
              // alone: they are a family, and grouping them says so.
              label: "Working across lines",
              collapsed: true,
              items: [
                { slug: "syntax/variables" },
                { slug: "syntax/line-references" },
                { slug: "syntax/category-tags" },
                { slug: "syntax/table-columns" },
                { slug: "syntax/map-reduce-and-aggregates" },
                { slug: "syntax/conditionals" },
                { slug: "syntax/goal-seek" },
                { slug: "syntax/trigger-words" },
              ],
            },
            {
              // The generated unit-spelling lookup, kept apart from the reading
              // pages: it is a reference table, not a topic to read through.
              label: "Reference",
              collapsed: true,
              items: [
                { slug: "syntax/unit-reference" },
                // The changelog is published per version as a GitHub release,
                // with the verification section each note ends with. Linked
                // rather than copied, so there is one record of what shipped.
                {
                  label: "Release notes",
                  link: "https://github.com/LiamRiddell/solve-engine/releases",
                  attrs: { target: "_blank", rel: "noopener" },
                },
              ],
            },
          ],
        },
        {
          label: "Developer guide",
          items: [
            {
              // Get the package on disk and, for an existing integration, across
              // the 2.0 boundary, before anything else.
              label: "Set up",
              items: [
                { slug: "getting-started/installation" },
                { slug: "guide/subpath-exports" },
                { slug: "guide/versioning-and-support" },
                { slug: "guide/upgrading-to-2" },
              ],
            },
            {
              // The order an integration actually happens in: stand the engine
              // up, drive it from TypeScript, then explain, format, and wire it
              // into an editor and live data, ending on the cross-cutting concerns.
              label: "Embedding",
              collapsed: true,
              items: [
                { slug: "guide/embedding" },
                { slug: "guide/typescript-usage" },
                { slug: "guide/explaining-lines" },
                { slug: "guide/formatting" },
                { slug: "guide/dates-on-temporal" },
                { slug: "guide/editor-integration" },
                // After formatting, because choosing a zone is a decision about
                // what a date MEANS in this host, and the page is read once the
                // dates are already on screen and reading wrongly.
                { slug: "guide/dates-on-temporal" },
                { slug: "guide/async-and-live-data" },
                { slug: "guide/async-data-sources" },
                { slug: "guide/performance" },
                { slug: "guide/security" },
              ],
            },
            {
              // Overview first, then a hands-on guide per extension point in
              // pipeline order, then testing.
              label: "Writing packages",
              collapsed: true,
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
              // Overview first, then the pipeline it describes, then the two
              // pieces the pipeline leans on, then the reasoning behind all of it.
              label: "How it works",
              collapsed: true,
              items: [
                { slug: "architecture/overview" },
                { slug: "architecture/pipeline" },
                { slug: "architecture/bytecode-vm" },
                { slug: "architecture/package-system" },
                { slug: "architecture/design-decisions" },
              ],
            },
            // The generated type reference. Populated by starlight-typedoc at
            // build time into `content/docs/api`, pages not in the repository, so
            // `scripts/check-sidebar.mjs` skips that prefix rather than reporting
            // every generated page as missing from this file. Nested here so the
            // API reference sits inside the developer umbrella with everything
            // else a package author needs.
            typeDocSidebarGroup,
            {
              label: "Contributing",
              collapsed: true,
              items: [
                { slug: "contributing/development-setup" },
                { slug: "contributing/coding-standards" },
                { slug: "contributing/testing" },
                { slug: "contributing/releasing" },
              ],
            },
          ],
        },
        {
          label: "Playground",
          link: "/playground/",
          attrs: { target: "_self" },
        },
      ],
    }),
    // The landing page runs the real engine in a Plate editor. Those islands
    // are `client:only`, so React never renders on the server and the engine
    // is never imported into Node during the build.
    react(),
  ],
});
