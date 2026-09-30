import { defineConfig } from "tsup";

export default defineConfig({
	// One executable, ESM, with its shebang. The engine stays external: the
	// command imports the `solve-engine` installed beside it, so an engine fix
	// reaches the command without a new release of the command.
	entry: { solve: "src/bin.ts" },
	format: ["esm"],
	platform: "node",
	target: "node22",
	external: ["solve-engine", /^solve-engine\//],
	banner: { js: "#!/usr/bin/env node" },
	clean: true,
	sourcemap: true,
	tsconfig: "./tsconfig.build.json",
});
