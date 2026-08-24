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
		variables: "src/variables/index.ts",
		resolvers: "src/resolvers/index.ts",
		errors: "src/errors/index.ts",
		utilities: "src/utilities/index.ts",
		uom: "src/uom/index.ts",
		services: "src/services/index.ts",
		worker: "src/worker/index.ts",
		testing: "src/testing/index.ts",
	},
	format: ["esm", "cjs"],
	/*
	 * `semver` is bundled rather than installed alongside.
	 *
	 * Three functions are used from it, in one file, and none of them reach the
	 * public type surface: it appears in the shipped declarations only inside
	 * doc comments. That makes it an implementation detail, and an
	 * implementation detail has no business in a consumer's lockfile.
	 *
	 * Bundling is also less code, not more. Installed, a consumer gets the whole
	 * package. Bundled, `treeshake` below keeps only what `satisfies`,
	 * `validRange` and `coerce` actually reach, which measures a few kilobytes.
	 *
	 * `@tanstack/query-core` is deliberately NOT here. Its types are part of what
	 * this package ships, so inlining it would leave sixteen declaration files
	 * pointing at a package the consumer no longer has.
	 */
	noExternal: ["semver"],
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
