import { defineConfig } from "tsup";

export default defineConfig({
	// One executable, ESM, with its shebang. The engine and the SDK stay
	// external, installed beside the server. The code shared with the solve
	// command (packages/cli/src/evaluate.ts and what it imports) is bundled in,
	// so the server does not depend on the command's package at run time.
	entry: { "solve-mcp": "src/bin.ts" },
	format: ["esm"],
	platform: "node",
	target: "node22",
	external: ["solve-engine", /^solve-engine\//, "@modelcontextprotocol/sdk", /^@modelcontextprotocol\/sdk\//, "zod"],
	banner: { js: "#!/usr/bin/env node" },
	clean: true,
	sourcemap: true,
	tsconfig: "./tsconfig.build.json",
});
