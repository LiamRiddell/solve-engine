import { describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT } from "@tools/scriptHarness";

/**
 * Issue #793: the type check ran `tsgo` from a dated native preview
 * (`@typescript/native-preview@7.0.0-dev.20260707.2`). TypeScript 7 is `latest`
 * on npm now (7.0.2), so the check moves to its `tsc`, installed under the
 * alias `typescript7`. Only the check moves: ts-jest peer-declares
 * `typescript >=4.3 <7` and TypeScript 7's root export is a version file rather
 * than the compiler API that ts-jest and tsup's declaration build call, so
 * `typescript` stays 5.9.3 for both, and `typecheck:tsc` stays as the 5.9
 * comparison.
 */

const root = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const engine = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages/engine/package.json"), "utf8"));
const versionOf = (pkg: string): string => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "node_modules", pkg, "package.json"), "utf8")).version;

describe("the compilers", () => {
	test("the dated preview is gone and TypeScript 7 is aliased beside 5.9", () => {
		expect(root.devDependencies["@typescript/native-preview"]).toBeUndefined();
		expect(root.devDependencies.typescript7).toBe("npm:typescript@7.0.2");
		expect(root.devDependencies.typescript).toBe("5.9.3");
		expect(engine.devDependencies.typescript).toBe("5.9.3");
	});

	test("what is installed is what is declared", () => {
		expect(versionOf("typescript7")).toBe("7.0.2");
		expect(versionOf("typescript")).toBe("5.9.3");
	});

	test("the typescript ts-jest resolves is 5.9, inside its peer range", () => {
		const resolved = require.resolve("typescript/package.json", { paths: [path.dirname(require.resolve("ts-jest/package.json"))] });
		expect(JSON.parse(fs.readFileSync(resolved, "utf8")).version).toBe("5.9.3");
	});

	test("`tsc` on the PATH is still 5.9, for typecheck:tsc", () => {
		const bin = path.join(REPO_ROOT, "node_modules/.bin/tsc");
		const run = spawnSync(process.execPath, [fs.realpathSync(bin), "--version"], { encoding: "utf8" });
		expect(run.stdout.trim()).toBe("Version 5.9.3");
	});
});

describe("the scripts", () => {
	test("typecheck runs TypeScript 7's tsc by path, and typecheck:tsc stays on 5.9", () => {
		expect(engine.scripts.typecheck).toBe("node ../../node_modules/typescript7/bin/tsc --noEmit --skipLibCheck");
		expect(engine.scripts["typecheck:tsc"]).toBe("tsc --noEmit --skipLibCheck");
	});

	test("TypeScript 7's tsc reads packages/engine/tsconfig.json and finds no error", () => {
		const run = spawnSync(process.execPath, [path.join(REPO_ROOT, "node_modules/typescript7/bin/tsc"), "--noEmit", "--skipLibCheck", "--pretty", "false"], {
			cwd: path.join(REPO_ROOT, "packages/engine"),
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		expect(run.stdout).toBe("");
		expect(run.status).toBe(0);
	});

	test("the explicit types entry stays, since TypeScript 7 does not find the hoisted @types on its own either", () => {
		const tsconfig = fs.readFileSync(path.join(REPO_ROOT, "packages/engine/tsconfig.json"), "utf8");
		expect(tsconfig).toContain('"types": ["node"]');
	});

	test("nothing names tsgo any more", () => {
		expect(JSON.stringify(engine.scripts)).not.toContain("tsgo");
		expect(JSON.stringify(root.scripts)).not.toContain("tsgo");
	});
});
