import path from "path"
import { fileURLToPath } from "url"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// GitHub Pages serves a project site from a subdirectory, and the playground is
// nested one level below the documentation, so every asset URL needs that
// prefix. The deploy workflow supplies it. The default suits `vite dev` and any
// deployment at a domain root, where there is no prefix.
//
// Getting this wrong produces a page that loads its HTML and then 404s every
// script, stylesheet and font, which is why the workflow asserts the prefix
// actually appears in the built output rather than trusting it.
const base = process.env.BASE_PATH ?? "/";

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Specific aliases MUST come before catch-all prefixes so they match first
      { find: "@solve-js-examples", replacement: path.resolve(dirname, "../packages/engine/examples") },
      { find: "@solve-js", replacement: path.resolve(dirname, "../packages/engine/src") },
      { find: "@bridge", replacement: path.resolve(dirname, "../packages/playground-bridge/src") },
      { find: "@", replacement: path.resolve(dirname, "./src") },
    ],
  },
  define: {
    global: "globalThis",
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["style-mod", "@marijn/find-cluster-break"],
  },
  server: {
    port: 5174,
    open: true,
  },
})
