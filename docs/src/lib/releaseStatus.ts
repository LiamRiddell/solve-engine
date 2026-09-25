/**
 * Which engine version the site describes, worked out once per build (#618).
 *
 * The site deploys on every push to main and builds against the engine in the
 * repository, so every page and every live notepad describes main. Between
 * releases that is ahead of what `npm install solve-engine` gives: when the
 * survey behind #618 was taken, main carried 51 unreleased changes and the
 * site taught checks, what-if and tracing while npm served the version before
 * them. Nothing on the site said so.
 *
 * The status compares three things: the version in the engine's package.json,
 * the changesets waiting to be released, and the version npm's `latest` names.
 * The registry is asked once, with a short timeout, and a build that cannot
 * reach it still deploys: it states the repository's version and leaves the
 * comparison out.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** What the banner needs to say which version a page describes. */
export interface ReleaseStatus {
	/** The version in packages/engine/package.json. */
	readonly engine: string;
	/** Changesets waiting to be released. */
	readonly pending: number;
	/** What npm's `latest` names, or null when the registry could not be reached. */
	readonly latest: string | null;
	/** The sentence the banner shows. */
	readonly sentence: string;
}

/** The repository root, whether the build runs from docs/ or from the root. */
function repositoryRoot(): string {
	const cwd = process.cwd();
	return path.basename(cwd) === "docs" ? path.dirname(cwd) : cwd;
}

/** npm's `latest` for solve-engine, or null when the registry does not answer in time. */
async function npmLatest(): Promise<string | null> {
	try {
		const response = await fetch("https://registry.npmjs.org/solve-engine/latest", { signal: AbortSignal.timeout(5_000) });
		if (!response.ok) return null;
		const body = (await response.json()) as { version?: unknown };
		return typeof body.version === "string" ? body.version : null;
	} catch {
		return null;
	}
}

/** "1 unreleased change", "3 unreleased changes". */
function unreleased(count: number): string {
	return `${count} unreleased change${count === 1 ? "" : "s"}`;
}

async function compute(): Promise<ReleaseStatus> {
	const root = repositoryRoot();
	const engine = (JSON.parse(readFileSync(path.join(root, "packages/engine/package.json"), "utf8")) as { version: string }).version;
	let pending = 0;
	try {
		pending = readdirSync(path.join(root, ".changeset")).filter((f) => f.endsWith(".md") && f !== "README.md").length;
	} catch {
		pending = 0;
	}
	const latest = await npmLatest();

	const onMain = `This site describes solve-engine as it is on main: ${engine}${pending > 0 ? ` and ${unreleased(pending)}` : ""}`;
	let sentence: string;
	if (latest === null) {
		sentence = `${onMain}.`;
	} else if (latest === engine && pending === 0) {
		sentence = `This site describes solve-engine ${engine}, the version npm installs.`;
	} else if (latest === engine) {
		sentence = `${onMain}. npm installs ${latest} without them, so a page may show an answer that version does not give yet.`;
	} else {
		sentence = `${onMain}, which npm does not have yet. npm installs ${latest}, so a page may show an answer that version does not give yet.`;
	}
	return { engine, pending, latest, sentence };
}

let status: Promise<ReleaseStatus> | undefined;

/** The status for this build, computed on first use and shared by every page. */
export function releaseStatus(): Promise<ReleaseStatus> {
	status ??= compute();
	return status;
}
