/**
 * Checks that every `with:` input a workflow passes to an action is one that
 * action declares.
 *
 * GitHub ignores an input an action does not declare, with a warning in a log
 * nobody reads, rather than failing the step. publish.yml records the time it
 * mattered: changesets/action v2 renamed every input the version step passes,
 * and the old spellings would have quietly reverted the step to the action's
 * defaults (#691). `lint:actions` checks that each action is pinned; this
 * checks what it is given.
 *
 * The inputs each pinned action declares are kept in
 * `.github/action-inputs.json`, read from the action's own `action.yml` at the
 * pinned revision. The check itself is offline and reads only that file and
 * the workflows. A reference the file does not list fails, so moving a pin
 * means refreshing the list, which is the moment its inputs may have changed:
 *
 *   node scripts/check-action-inputs.mjs            check the workflows
 *   node scripts/check-action-inputs.mjs --update   refresh the list from GitHub
 *
 * `--root=<dir>` reads another checkout's `.github` instead, which is how the
 * spec runs it over fixture workflows.
 *
 * Workflows are read line by line rather than through a YAML parser, as
 * check-action-pins.mjs reads them: a `uses:` key and a `with:` key at the same
 * indentation in one mapping are one step (or one job calling a reusable
 * workflow), and the `with:` block's keys are the inputs passed. A local action
 * (`./...`) and a container action (`docker://...`) are skipped, as the pin
 * check skips them.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const rootArgument = process.argv.find((arg) => arg.startsWith("--root="));
const ROOT = rootArgument ? path.resolve(rootArgument.slice("--root=".length)) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");
const MANIFEST = path.join(ROOT, ".github", "action-inputs.json");

/** The column a line's content starts at, a leading `- ` counted as indentation. */
function keyColumn(line) {
	const match = line.match(/^(\s*)(-\s+)?/);
	return match[1].length + (match[2]?.length ?? 0);
}

/** The key a line opens, or null: `  with:` gives "with". */
function keyOf(line) {
	const match = line.match(/^\s*(?:-\s+)?([A-Za-z0-9_-]+):(?:\s|$)/);
	return match === null ? null : match[1];
}

/** Whether a line carries nothing a mapping reads: blank, or a comment. */
function isFiller(line) {
	return /^\s*(#.*)?$/.test(line);
}

/**
 * Every `uses:` in a workflow with the inputs its `with:` passes.
 *
 * @param {string} text - The workflow.
 * @returns {{ line: number, reference: string, inputs: string[] }[]}
 */
export function usesWithInputs(text) {
	const lines = text.split(/\r?\n/);
	const found = [];
	lines.forEach((line, index) => {
		const match = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)/);
		if (match === null) return;
		const column = keyColumn(line);
		// The mapping `uses:` belongs to starts at the list item that opens it,
		// which is this line or the nearest one above at the same column.
		let start = index;
		while (start > 0 && !/^\s*-\s/.test(lines[start]) ) {
			const above = lines[start - 1];
			if (!isFiller(above) && keyColumn(above) < column) break;
			start--;
		}
		const inputs = [];
		for (let i = start; i < lines.length; i++) {
			const current = lines[i];
			if (i > start && !isFiller(current)) {
				const col = keyColumn(current);
				if (col < column || (col === column && /^\s*-\s/.test(current))) break;
			}
			if (keyOf(current) !== "with" || keyColumn(current) !== column) continue;
			let child = -1;
			for (let j = i + 1; j < lines.length; j++) {
				if (isFiller(lines[j])) continue;
				const col = keyColumn(lines[j]);
				if (col <= column) break;
				if (child === -1) child = col;
				if (col === child) {
					const key = keyOf(lines[j]);
					if (key !== null) inputs.push(key);
				}
			}
		}
		found.push({ line: index + 1, reference: match[1], inputs });
	});
	return found;
}

/**
 * The inputs an `action.yml` declares: the keys of its top-level `inputs:`
 * mapping. A reusable workflow's are under `on: workflow_call: inputs:`.
 *
 * @param {string} text - The action's metadata, or the reusable workflow.
 * @returns {string[]}
 */
export function declaredInputs(text) {
	const lines = text.split(/\r?\n/);
	const inputs = [];
	for (let i = 0; i < lines.length; i++) {
		if (!/^inputs:\s*(#.*)?$/.test(lines[i]) && !/^\s+inputs:\s*(#.*)?$/.test(lines[i])) continue;
		const column = keyColumn(lines[i]);
		// A top-level `inputs:`, or the one under `workflow_call:`.
		if (column !== 0 && keyOf(lines[i - 1] ?? "") !== "workflow_call") continue;
		let child = -1;
		for (let j = i + 1; j < lines.length; j++) {
			if (isFiller(lines[j])) continue;
			const col = keyColumn(lines[j]);
			if (col <= column) break;
			if (child === -1) child = col;
			if (col === child) {
				const key = keyOf(lines[j]);
				if (key !== null) inputs.push(key);
			}
		}
	}
	return [...new Set(inputs)];
}

/** Every reference the workflows make that this check covers, in file order. */
function collect() {
	const out = [];
	for (const entry of fs.readdirSync(WORKFLOWS).sort()) {
		if (!/\.ya?ml$/.test(entry)) continue;
		const text = fs.readFileSync(path.join(WORKFLOWS, entry), "utf8");
		for (const use of usesWithInputs(text)) {
			if (use.reference.startsWith("./") || use.reference.startsWith("docker://")) continue;
			out.push({ file: entry, ...use });
		}
	}
	return out;
}

/** `owner/repo/sub/path@ref` into its parts. */
function parseReference(reference) {
	const at = reference.lastIndexOf("@");
	const name = reference.slice(0, at);
	const ref = reference.slice(at + 1);
	const [owner, repo, ...rest] = name.split("/");
	return { owner, repo, subPath: rest.join("/"), ref };
}

/** Fetch an action's metadata at its pinned revision. */
async function fetchMetadata(reference) {
	const { owner, repo, subPath, ref } = parseReference(reference);
	// A reusable workflow is named by its own file; an action by its directory.
	const candidates = /\.ya?ml$/.test(subPath) ? [subPath] : [`${subPath ? `${subPath}/` : ""}action.yml`, `${subPath ? `${subPath}/` : ""}action.yaml`];
	for (const file of candidates) {
		const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`;
		const response = await fetch(url);
		if (response.ok) return { file, text: await response.text() };
	}
	throw new Error(`No action.yml for ${reference} (tried ${candidates.join(", ")})`);
}

async function update() {
	const references = [...new Set(collect().map((use) => use.reference))].sort();
	const manifest = {};
	for (const reference of references) {
		const { file, text } = await fetchMetadata(reference);
		manifest[reference] = { source: file, inputs: declaredInputs(text).sort() };
	}
	fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, "\t")}\n`);
	console.log(`Wrote ${path.relative(ROOT, MANIFEST)}: ${references.length} action reference(s).`);
}

function check() {
	const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
	const problems = [];
	const seen = new Set();
	let checked = 0;
	for (const use of collect()) {
		seen.add(use.reference);
		const entry = manifest[use.reference];
		if (entry === undefined) {
			problems.push(`${use.file}:${use.line}  ${use.reference} is not in .github/action-inputs.json: refresh it with --update`);
			continue;
		}
		for (const input of use.inputs) {
			checked++;
			if (!entry.inputs.includes(input)) {
				problems.push(`${use.file}:${use.line}  ${use.reference} declares no input "${input}" (it declares: ${entry.inputs.join(", ") || "none"})`);
			}
		}
	}
	for (const reference of Object.keys(manifest)) {
		if (!seen.has(reference)) problems.push(`.github/action-inputs.json lists ${reference}, which no workflow uses: refresh it with --update`);
	}
	if (problems.length > 0) {
		console.error("A workflow passes an input its action does not declare, or the input list is stale.\n");
		for (const problem of problems) console.error(`  ${problem}`);
		console.error("\nGitHub ignores an undeclared input rather than failing the step, so a renamed input\nsilently reverts to the action's default.");
		process.exit(1);
	}
	console.log(`${checked} with: input(s) across ${seen.size} action reference(s) are ones the actions declare.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes("--update")) {
		update().catch((error) => {
			console.error(error.message);
			process.exit(1);
		});
	} else {
		check();
	}
}
