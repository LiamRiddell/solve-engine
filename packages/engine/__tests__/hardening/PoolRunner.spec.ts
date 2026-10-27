import { describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { REPO_ROOT } from "@tools/scriptHarness";

/**
 * `scripts/lib/pool.mjs`, which the coverage runner starts its shards through:
 * at most `limit` at once, started in order, results in the items' order, and
 * a worker that rejects does not strand the others.
 *
 * Run in a child process, as the coverage-floor spec runs its library, since
 * Jest's sandbox does not import an `.mjs` file.
 */

const POOL = pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", "pool.mjs")).href;

/** Runs a scenario body against `runPool` in a child and returns what it printed as JSON. */
function scenario(body: string): unknown {
	const script = `
		import { runPool } from ${JSON.stringify(POOL)};
		const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));
		const result = await (async () => { ${body} })();
		console.log(JSON.stringify(result));
	`;
	const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
	if (run.status !== 0) throw new Error(run.stderr);
	return JSON.parse(run.stdout.trim().split("\n").pop()!);
}

describe("runPool", () => {
	test("never runs more than the limit at once, and runs every item", () => {
		expect(scenario(`
			let active = 0, peak = 0; const seen = [];
			await runPool([...Array(20).keys()], 4, async (n) => { active++; peak = Math.max(peak, active); await tick(2); seen.push(n); active--; });
			return { peak, seen: seen.sort((a, b) => a - b) };
		`)).toEqual({ peak: 4, seen: [...Array(20).keys()] });
	});

	test("starts items in order and returns results in the items' order, however they finish", () => {
		expect(scenario(`
			const started = [];
			const out = await runPool([30, 1, 15, 1], 2, async (ms, index) => { started.push(index); await tick(ms); return "item " + index; });
			return { started, out };
		`)).toEqual({ started: [0, 1, 2, 3], out: ["item 0", "item 1", "item 2", "item 3"] });
	});

	test("a worker that rejects is returned as an error in its place, and the rest still run", () => {
		expect(scenario(`
			const out = await runPool([1, 2, 3, 4, 5], 2, async (n) => { if (n === 2) throw new Error("boom"); return n * 10; });
			return out.map((o) => (typeof o === "object" ? "error: " + o.error.message : o));
		`)).toEqual([10, "error: boom", 30, 40, 50]);
	});

	test("a limit of one is sequential, and a limit past the item count is just all of them", () => {
		expect(scenario(`
			let active = 0, peak = 0;
			const work = async () => { active++; peak = Math.max(peak, active); await tick(); active--; };
			await runPool([1, 2, 3], 1, work); const one = peak; peak = 0;
			await runPool([1, 2, 3], 99, work);
			return { one, all: peak };
		`)).toEqual({ one: 1, all: 3 });
	});

	test("no items is no work and an empty answer", () => {
		expect(scenario(`
			let called = false;
			return { out: await runPool([], 4, async () => (called = true)), called };
		`)).toEqual({ out: [], called: false });
	});

	test("adversarial: a limit that is not a whole number of at least one is refused by name", () => {
		expect(scenario(`
			const bad = [0, -1, 1.5, NaN, Infinity, "3", null, undefined];
			const messages = [];
			for (const limit of bad) { try { await runPool([1], limit, async () => 1); messages.push("accepted"); } catch (e) { messages.push(e.message.slice(0, 55)); } }
			return messages;
		`)).toEqual(Array(8).fill("The pool limit must be a whole number of at least 1, no"));
	});

	test("adversarial: items named like Object.prototype properties are ordinary items", () => {
		expect(scenario(`
			const before = Object.getOwnPropertyNames(Object.prototype).sort();
			const words = ["constructor", "__proto__", "toString", "hasOwnProperty"];
			const out = await runPool(words, 2, async (w) => w.length);
			return { out, untouched: JSON.stringify(Object.getOwnPropertyNames(Object.prototype).sort()) === JSON.stringify(before) };
		`)).toEqual({ out: [11, 9, 8, 14], untouched: true });
	});
});
