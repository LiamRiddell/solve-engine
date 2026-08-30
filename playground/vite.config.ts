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

/**
 * Serve the playground cross-origin isolated, so the clock is usable.
 *
 * `performance.now()` is deliberately coarsened as a Spectre mitigation: in a
 * page that is not cross-origin isolated it ticks at 100 microseconds, which is
 * longer than most of what this tool exists to measure. Every stage under that
 * read as exactly 0 and every total came back a multiple of 100us, so the
 * per-line timings were showing quantisation rather than time. These two
 * headers restore a 5-microsecond clock.
 *
 * Set through middleware rather than `server.headers`, which Vite 8 does not
 * apply to the HTML document response, and applied to dev and preview alike so
 * the two do not disagree about what the numbers mean.
 *
 * The cost is that cross-origin subresources must opt in via CORP or CORS. The
 * playground has none: its fonts are bundled through @fontsource and the engine
 * is local source, so nothing here is fetched from another origin.
 */
function crossOriginIsolation() {
  const headers = (_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
    next()
  }
  return {
    name: "solve-cross-origin-isolation",
    configureServer(server: { middlewares: { use(fn: typeof headers): void } }) {
      server.middlewares.use(headers)
    },
    configurePreviewServer(server: { middlewares: { use(fn: typeof headers): void } }) {
      server.middlewares.use(headers)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), crossOriginIsolation()],
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
