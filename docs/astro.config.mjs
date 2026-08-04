import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import { solveGrammar } from "./src/solve-grammar.js";
import { remarkMermaid } from "./src/plugins/remark-mermaid.mjs";
import { rehypeBaseLinks } from "./src/plugins/rehype-base-links.mjs";

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
        "./src/styles/landing.css",
      ],
      expressiveCode: {
        // Registers the ```solve language. Without it every example in the
        // syntax reference falls back to unhighlighted plain text.
        shiki: { langs: [solveGrammar] },
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
      sidebar: [
        {
          label: "Getting started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quick start", slug: "getting-started/quick-start" },
            { label: "Core concepts", slug: "getting-started/concepts" },
          ],
        },
        {
          label: "Syntax reference",
          items: [{ autogenerate: { directory: "syntax" } }],
        },
        {
          label: "Embedding guide",
          items: [{ autogenerate: { directory: "guide" } }],
        },
        {
          label: "Writing packages",
          items: [{ autogenerate: { directory: "packages" } }],
        },
        {
          label: "Architecture",
          items: [{ autogenerate: { directory: "architecture" } }],
        },
        {
          label: "Contributing",
          items: [{ autogenerate: { directory: "contributing" } }],
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
