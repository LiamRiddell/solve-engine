import { defineConfig } from "tsup";
import { PUBLIC_ENTRIES, packageEntries } from "./buildEntries";

export default defineConfig({
	// The published entries, and one entry per built-in package so each lands
	// in chunks of its own that a bundler can drop whole (#716). See
	// buildEntries.ts for why, and for why the second set is not published.
	entry: { ...PUBLIC_ENTRIES, ...packageEntries(".") },
	format: ["esm", "cjs"],
	// Declarations for the published entries only; the per-package entries are
	// a chunking device, not an import path.
	dts: { entry: { ...PUBLIC_ENTRIES } },
	// Minified, but with source maps kept on. The shipped ESM/CJS otherwise
	// parses at full identifier length and whitespace, which a consumer without
	// their own bundler (Node, Deno, a CDN) pays in full on every load: minifying
	// roughly halves that parsed size. Source maps stay on so a production stack
	// trace still points at real source; the two must never be dropped together.
	minify: true,
	sourcemap: true,
	clean: true,
	splitting: true,
	treeshake: true,
	tsconfig: "./tsconfig.json",
});
