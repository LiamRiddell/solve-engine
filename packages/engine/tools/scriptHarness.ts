/**
 * Helpers for testing the repository's Node scripts and workflow files from
 * Jest: run a script as a child process, call one of an ES module's exports
 * with JSON arguments, make throwaway trees, and read a job or a step's shell
 * out of a workflow file.
 *
 * The scripts under `scripts/` are ES modules, which this CommonJS test run
 * cannot import, so an export is called in a child `node` that imports it and
 * prints the result as JSON. The workflow readers work on the text by
 * indentation, which is all a GitHub workflow's shape needs, so no YAML parser
 * has to be a dependency of the tests.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** The repository root, from this file's place in it. */
export const REPO_ROOT = path.resolve(__dirname, "../../..");

/** How a script run came out: its exit status, and stdout and stderr joined. */
export interface ScriptResult {
	readonly status: number | null;
	readonly out: string;
}

/**
 * Run a Node script from the repository's `scripts/` folder.
 *
 * @param name - The script's file name, `check-message-style.mjs`.
 * @param args - Its command-line arguments.
 * @param options - A working directory and extra environment variables.
 * @returns The exit status and everything it printed.
 */
export function runScript(
	name: string,
	args: readonly string[] = [],
	options: { cwd?: string; env?: Record<string, string> } = {},
): ScriptResult {
	const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", name), ...args], {
		cwd: options.cwd ?? REPO_ROOT,
		encoding: "utf8",
		env: { ...process.env, ...options.env },
		maxBuffer: 64 * 1024 * 1024,
	});
	return { status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * Call one export of a script module with JSON arguments, in a child process.
 * An export that is not a function is returned as it is.
 *
 * @param name - The script's file name under `scripts/`.
 * @param exportName - The function to call, or the value to read.
 * @param args - Its arguments, each round-tripped through JSON.
 * @returns What it returned, round-tripped through JSON.
 */
export function callExport<T = unknown>(name: string, exportName: string, args: readonly unknown[] = []): T {
	const url = `file://${path.join(REPO_ROOT, "scripts", name).split(path.sep).join("/")}`;
	const program =
		`const m = await import(${JSON.stringify(url)});` +
		`const fs = await import("node:fs");` +
		`const args = JSON.parse(fs.readFileSync(0, "utf8"));` +
		`const e = m[${JSON.stringify(exportName)}];` +
		`const out = typeof e === "function" ? await e(...args) : e;` +
		`process.stdout.write(JSON.stringify(out === undefined ? null : out));`;
	const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		// Through stdin rather than the environment, which caps one variable at
		// 128 KiB on Linux and would refuse a large fixture.
		input: JSON.stringify(args),
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0) throw new Error(`${name} ${exportName}() failed: ${result.stderr ?? result.error?.message}`);
	return JSON.parse(result.stdout) as T;
}

/** Throwaway directories made by {@link tempTree}, removed by {@link removeTempTrees}. */
const made: string[] = [];

/**
 * A throwaway directory holding the given files.
 *
 * @param files - Relative path to content; folders are created as needed.
 * @returns The directory's absolute path.
 */
export function tempTree(files: Record<string, string> = {}): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "solve-script-"));
	made.push(root);
	for (const [file, content] of Object.entries(files)) {
		const full = path.join(root, file);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content);
	}
	return root;
}

/** Remove every directory {@link tempTree} made. Call it from `afterEach`. */
export function removeTempTrees(): void {
	while (made.length > 0) fs.rmSync(made.pop()!, { recursive: true, force: true });
}

/** A workflow file's text, read from `.github/workflows`. */
export function readWorkflow(file: string): string {
	return fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", file), "utf8");
}

/**
 * One job of a workflow, as the lines under its `<id>:` key.
 *
 * @param workflow - The workflow's text.
 * @param id - The job's key under `jobs:`.
 * @returns The job's text, header included, or null when there is no such job.
 */
export function workflowJob(workflow: string, id: string): string | null {
	const lines = workflow.split(/\r?\n/);
	const start = lines.findIndex((l) => l === `  ${id}:`);
	if (start === -1) return null;
	let end = start + 1;
	while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end]) && !/^\S/.test(lines[end])) end++;
	return lines.slice(start, end).join("\n");
}

/**
 * The shell a named step runs, dedented, from a `run: |` block.
 *
 * @param job - A job's text, from {@link workflowJob}.
 * @param stepName - The step's `name:`.
 * @returns The script, or null when the step has no block `run:`.
 */
export function stepScript(job: string, stepName: string): string | null {
	const lines = job.split(/\r?\n/);
	const at = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
	if (at === -1) return null;
	const stepIndent = lines[at].indexOf("-");
	let i = at + 1;
	while (i < lines.length && !/^\s*run: \|\s*$/.test(lines[i])) {
		const indent = lines[i].search(/\S/);
		if (indent !== -1 && indent <= stepIndent) return null;
		i++;
	}
	if (i >= lines.length) return null;
	const body: string[] = [];
	let blockIndent = -1;
	for (i = i + 1; i < lines.length; i++) {
		const line = lines[i];
		const indent = line.search(/\S/);
		if (indent !== -1 && blockIndent === -1) blockIndent = indent;
		if (indent !== -1 && indent < blockIndent) break;
		body.push(line.slice(Math.max(0, blockIndent)));
	}
	return `${body.join("\n").replace(/\s+$/, "")}\n`;
}
