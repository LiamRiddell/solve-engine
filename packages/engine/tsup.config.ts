import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/api/index.ts",
		engine: "src/engine/index.ts",
		vm: "src/vm/index.ts",
		format: "src/format/index.ts",
		language: "src/language/index.ts",
		packages: "src/packages/index.ts",
		constants: "src/constants/index.ts",
		lexer: "src/lexer/index.ts",
		parser: "src/parser/index.ts",
		normalizer: "src/normalizer/index.ts",
		resolvers: "src/resolvers/index.ts",
		errors: "src/errors/index.ts",
		utilities: "src/utilities/index.ts",
		uom: "src/uom/index.ts",
		services: "src/services/index.ts",
		worker: "src/worker/index.ts",
		testing: "src/testing/index.ts",
		// The Temporal calendar backend. Its own entry so that nothing under
		// src/temporal is reachable from the root entry or any other subpath:
		// a host that never imports it ships none of it.
		temporal: "src/temporal/index.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
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
