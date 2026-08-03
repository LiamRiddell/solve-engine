import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { solveGrammar } from "./src/solve-grammar.js";

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
      customCss: ["./src/styles/custom.css"],
      expressiveCode: {
        // Registers the ```solve language. Without it every example in the
        // syntax reference falls back to unhighlighted plain text.
        shiki: { langs: [solveGrammar] },
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
          autogenerate: { directory: "syntax" },
        },
        {
          label: "Embedding guide",
          autogenerate: { directory: "guide" },
        },
        {
          label: "Writing packages",
          autogenerate: { directory: "packages" },
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Contributing",
          autogenerate: { directory: "contributing" },
        },
        {
          label: "Playground",
          link: "/playground/",
          attrs: { target: "_self" },
        },
      ],
    }),
  ],
});
