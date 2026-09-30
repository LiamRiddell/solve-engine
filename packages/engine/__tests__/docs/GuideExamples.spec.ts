import { describe, expect, test } from "@jest/globals";
import * as path from "path";
import { collectTsFences, instrumentFence, pageProgram, type TsFence } from "@tools/tsFences";

/**
 * The TypeScript examples in the developer guides, run (#779).
 *
 * `DocExamples.spec.ts` proves the syntax pages' `solve` blocks. The guides'
 * `ts` fences were read by nothing, and two of the results they stated had
 * drifted (`formatting.md` showed `"= 3000.00 m"` where the engine writes
 * `"= 3,000.00 m"`). This holds them to the convention they already use: a
 * statement whose line ends in a comment that opens with a quoted string states
 * its result, and the fence is run and the statement's value compared with it;
 * a comment `// throws: <message>` states that the statement throws with that
 * message.
 *
 * A fence that states a result must run. One that cannot (it needs a network,
 * a worker, an editor or a host object the page only describes) is listed in
 * {@link UNRUNNABLE} with the reason, by page and fence line, and the list
 * fails when an entry goes stale. A fence that states no result is not run:
 * most are fragments (a signature, an options object, an adapter), and the
 * boundary is written down rather than implied.
 *
 * A page's fences build on each other, as a reader takes them: the quick
 * start creates `engine` once and uses it in the fences below. So a fence runs
 * after every earlier fence on its page, in one scope (see `pageProgram`).
 *
 * A fence imports the package the way a consumer does, `solve-engine` and its
 * subpaths, and each subpath is resolved to its source entry here, so what runs
 * is the tree under test rather than a stale build.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DOCS = path.join(REPO_ROOT, "docs/src/content/docs");

/** The pages read: the guides, getting started, and the package-author pages. */
const DIRECTORIES = ["guide", "getting-started", "packages"].map((dir) => path.join(DOCS, dir));

/** The published subpaths, mapped to the source entries `buildEntries.ts` builds them from. */
const SUBPATHS: ReadonlyMap<string, string> = new Map([
	["solve-engine", "@solve-js/api/index"],
	["solve-engine/engine", "@solve-js/engine/index"],
	["solve-engine/vm", "@solve-js/vm/index"],
	["solve-engine/format", "@solve-js/format/index"],
	["solve-engine/language", "@solve-js/language/index"],
	["solve-engine/packages", "@solve-js/packages/index"],
	["solve-engine/constants", "@solve-js/constants/index"],
	["solve-engine/lexer", "@solve-js/lexer/index"],
	["solve-engine/parser", "@solve-js/parser/index"],
	["solve-engine/normalizer", "@solve-js/normalizer/index"],
	["solve-engine/resolvers", "@solve-js/resolvers/index"],
	["solve-engine/errors", "@solve-js/errors/index"],
	["solve-engine/utilities", "@solve-js/utilities/index"],
	["solve-engine/uom", "@solve-js/uom/index"],
	["solve-engine/services", "@solve-js/services/index"],
	["solve-engine/worker", "@solve-js/worker/index"],
	["solve-engine/testing", "@solve-js/testing/index"],
	["solve-engine/temporal", "@solve-js/temporal/index"],
]);

/**
 * Fences that state a result and cannot run here, keyed `<page>:<fence line>`,
 * each with the reason.
 */
const UNRUNNABLE: ReadonlyMap<string, string> = new Map([
	["guide/async-and-live-data.mdx:17", "shows the pending value a live exchange rate gives before it resolves, and this run has live data off"],
	["guide/async-and-live-data.mdx:288", "freezes an answer from a primed live rate the page describes, and waits on a resolution this run never makes"],
	["guide/dates-on-temporal.md:253", "builds calendars from the runtime's own Temporal, which the Node this suite runs on does not ship"],
	["guide/performance.mdx:194", "reads a worker runtime's result, and the worker is started from a module URL (import.meta) no test can load"],
	["guide/performance.mdx:307", "calls the worker client the page starts from a module URL (import.meta); the same call is proven through linked transports in Issue770_workerParity.spec.ts"],
]);

/** The key a fence is listed under in {@link UNRUNNABLE}. */
const keyOf = (fence: TsFence): string => `${path.relative(DOCS, fence.file).replace(/\\/g, "/")}:${fence.line}`;

/** Resolves a fence's import the way a consumer's bundler would, onto the source under test. */
function load(specifier: string): unknown {
	const mapped = SUBPATHS.get(specifier);
	if (mapped === undefined) throw new Error(`The fence imports ${specifier}, which is not a published entry of solve-engine.`);
	return require(mapped);
}

/**
 * What the guides take as given without importing it on every page: the quick
 * start's imports and its `const engine = createEngine()`, from the published
 * entries a guide reaches for most, with live data off so no fence makes a
 * request. A page's own declarations replace any of it. A page that reads a
 * value it defines only in prose adds it in {@link PAGE_GIVENS}.
 */
const PRELUDE_ENTRIES = ["solve-engine", "solve-engine/format", "solve-engine/errors", "solve-engine/vm", "solve-engine/engine"];

function prelude(page: string): string {
	const lines: string[] = [];
	for (const entry of PRELUDE_ENTRIES) {
		const names = Object.keys(load(entry) as object).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
		lines.push(`var { ${names.join(", ")} } = require(${JSON.stringify(entry)});`);
	}
	lines.push("var engine = createEngine({ config: { network: { enabled: false } } });");
	const given = PAGE_GIVENS.get(page);
	if (given !== undefined) lines.push(given);
	return lines.join("\n");
}

/**
 * Values a page's prose names and its fences read without defining, keyed by
 * page, each as the code the prose describes.
 */
const PAGE_GIVENS: ReadonlyMap<string, string> = new Map([
	// "The engine produces a value" of `3 km in m`, the page's running example,
	// and `calendar` is "a backend" the settings section names in prose.
	["guide/formatting.md", 'var value = engine.evaluateExpression("3 km in m"); var calendar = dateCalendarInZone("Pacific/Kiritimati");'],
]);

/** Runs a page's fences up to one, and returns what each of its asserted statements evaluated to. */
async function run(page: readonly TsFence[], target: number): Promise<unknown[]> {
	const pageKey = path.relative(DOCS, page[target].file).replace(/\\/g, "/");
	const { js, assertions } = pageProgram(page, target, prelude(pageKey));
	const seen: unknown[] = new Array(assertions.length);
	const module = { exports: {} as { __run?: () => Promise<void> } };
	const factory = new Function("require", "module", "exports", "__check", "__default", js);
	const check = (index: number, value: unknown) => {
		seen[index] = value;
		return value;
	};
	const readDefault = (loaded: { default?: unknown }) => loaded?.default ?? loaded;
	// No fence reaches the network: a request fails at once, so an earlier
	// fence that waits on a live value gives up inside its `try` rather than
	// holding the page's run until a slow host answers.
	const realFetch = globalThis.fetch;
	globalThis.fetch = (() => Promise.reject(new Error("the guide examples run with no network"))) as typeof fetch;
	try {
		factory(load, module, module.exports, check, readDefault);
		await module.exports.__run?.();
	} finally {
		globalThis.fetch = realFetch;
	}
	return seen;
}

const fences = [...DIRECTORIES.flatMap((dir) => collectTsFences(dir))];
const asserting = fences.filter((fence) => instrumentFence(fence.source).assertions.length > 0);

/** A fence's page, and its index among the page's fences. */
function placeOf(fence: TsFence): { page: TsFence[]; index: number } {
	const page = fences.filter((other) => other.file === fence.file);
	return { page, index: page.indexOf(fence) };
}

describe("the guides' TypeScript examples", () => {
	test("the fences were found, and some state a result", () => {
		expect(fences.length).toBeGreaterThan(100);
		expect(asserting.length).toBeGreaterThan(5);
	});

	test.each(asserting.filter((fence) => !UNRUNNABLE.has(keyOf(fence))).map((fence) => [keyOf(fence), fence] as const))(
		"%s states what it evaluates to",
		async (_key, fence) => {
			const { assertions } = instrumentFence(fence.source);
			const { page, index } = placeOf(fence);
			const seen = await run(page, index);
			assertions.forEach((assertion, i) => {
				const got = assertion.throws ? (seen[i] instanceof Error ? seen[i].message : "(did not throw)") : seen[i];
				expect({ line: assertion.line, got }).toEqual({ line: assertion.line, got: assertion.expected });
			});
		},
		// A page runs every fence above the one tested, some of which build
		// several engines; a loaded shared machine can take longer than the
		// default five seconds.
		30_000,
	);

	test("every unrunnable entry names a fence that states a result, and gives a reason", () => {
		const keys = new Set(asserting.map(keyOf));
		for (const [key, reason] of UNRUNNABLE) {
			expect({ key, listed: keys.has(key), reason: reason.length > 20 }).toEqual({ key, listed: true, reason: true });
		}
	});
});
