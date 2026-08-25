/**
 * The bounded half of the fuzzer: what runs on every ordinary test run.
 *
 * Two things happen here, and they answer different questions.
 *
 * The corpus replay answers "did a bug we already found come back". Every
 * finding the soak has ever produced is committed as a file under `corpus/`,
 * reduced to its smallest reproducer, and replayed here. That is the only part
 * of a fuzzer that protects a fix: a run with fresh seeds will not find the same
 * bug again on purpose, so without a corpus a fix is verified once and never
 * again.
 *
 * The bounded run answers "is the engine still robust against the input we know
 * how to generate", on a handful of fixed seeds and a few seconds of budget.
 * The seeds are fixed rather than random deliberately: a suite that fails on a
 * different case every run trains people to re-run it until it passes.
 *
 * ## Why this file is safe to run inside Jest, and `npm run fuzz` is not
 *
 * The whole point of a fuzzer is that it generates input designed to break
 * things, and two of the three failures worth finding cannot be contained: an
 * out-of-memory abort ends the process, and a wedged synchronous loop cannot be
 * interrupted by anything inside it. Either one, inside a shared Jest process,
 * costs the whole run rather than one test.
 *
 * So exploration happens elsewhere: `npm run fuzz` spawns a throwaway child
 * with a small heap and supervises it from outside. What is left here is only
 * what has already been executed there and observed to be survivable, and even
 * that runs under tightened VM ceilings and a wall-clock budget checked between
 * cases, so a regression that turns a fast case into a slow one is reported
 * rather than left to hit Jest's own timeout.
 */

import * as path from "node:path";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { describe, expect, test } from "@jest/globals";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { failureSignature, knownOpenSignatures, loadCorpus } from "@tools/fuzz/Corpus";
import { generateExpressionCase } from "@tools/fuzz/ExpressionFuzzer";
import { buildMutationPool, generateBytecodeCase } from "@tools/fuzz/BytecodeFuzzer";
import { buildVocabulary } from "@tools/fuzz/Vocabulary";
import { runCase, type OracleOptions } from "@tools/fuzz/Oracle";
import { isFailure, type FuzzCase, type OutcomeKind } from "@tools/fuzz/FuzzCase";

const CORPUS_DIRECTORY = path.join(__dirname, "corpus");

/**
 * Ceilings for the in-suite run, well below the shipped defaults.
 *
 * A soak runs at the real defaults, because those are what a host gets. This
 * run shares its process with every other spec, so it is tightened by roughly
 * two orders of magnitude: a case that would materialise twenty thousand
 * elements is refused here instead of allocating. That changes which error some
 * cases produce, and changes nothing about the invariants being checked, since
 * none of them is "the engine allowed this".
 */
const BOUNDED_LIMITS: OracleOptions = {
	limits: {
		maxStackDepth: 200,
		maxInstructions: 20000,
		maxFunctionRecursionDepth: 20,
		maxCollectionSize: 5000,
		maxAllocatedElements: 20000,
	},
	slowMs: 1500,
};

/** Outcomes that fail this suite, unless the corpus already records them as open. */
const FORBIDDEN: ReadonlySet<OutcomeKind> = new Set<OutcomeKind>(["throw", "contract", "crash", "hang"]);

/**
 * The findings already recorded and not yet fixed.
 *
 * A fuzzer that reports a real bug puts the maintainer in an awkward spot: the
 * bug is unfixed, the suite is red, and a permanently red suite is one nobody
 * reads. Rather than pretend the bug is not there (by picking seeds that avoid
 * it, which quietly stops testing that area) the corpus records it, and the run
 * below tolerates exactly what the corpus knows about. Anything else fails.
 * Fixing a bug means flipping its entry to `fixed`, after which any recurrence
 * is a new failure again.
 */
const KNOWN_OPEN = knownOpenSignatures(loadCorpus(CORPUS_DIRECTORY));

/** Whether a failure is one the corpus already accounts for. */
function isKnown(outcome: { kind: OutcomeKind; detail: string }, input: FuzzCase): boolean {
	return KNOWN_OPEN.has(failureSignature(outcome, input));
}

/**
 * Seeds proven survivable by running them in the supervised child first.
 *
 * Not arbitrary numbers. Each block was executed under `npm run fuzz` with a
 * 256MB heap before being listed here, so nothing in this file is a case whose
 * behaviour is unknown. Adding a seed range means running it there first.
 */
const VETTED_BYTECODE_SEEDS = { start: 700_000, count: 4000 };
const VETTED_EXPRESSION_SEEDS = { start: 800_000, count: 600 };

/**
 * Wall-clock budget for each bounded block, checked between cases.
 *
 * Two and a half seconds each, so the whole file costs about five seconds on
 * top of the corpus replay. The budget rather than the seed count is what
 * usually ends a block, which is deliberate: a faster machine fuzzes more cases
 * in the same time instead of finishing early, and a slower one still finishes.
 */
const BLOCK_BUDGET_MS = 2500;

/** A one-line rendering of a case, for an assertion message. */
function describeCase(fuzzCase: FuzzCase): string {
	if (fuzzCase.kind === "expression") return `expression ${JSON.stringify(fuzzCase.source)}`;
	const { opcodes, numbers, strings } = fuzzCase.program;
	return `bytecode opcodes=[${opcodes.join(",")}] numbers=${JSON.stringify(numbers)} strings=${JSON.stringify(strings)}`;
}

describe("fuzz corpus", () => {
	const entries = loadCorpus(CORPUS_DIRECTORY);

	test("the corpus directory is readable and its entries are well formed", () => {
		for (const entry of entries) {
			expect(entry.id).toMatch(/^[0-9a-f]{8}$/);
			expect(entry.input.kind === "bytecode" || entry.input.kind === "expression").toBe(true);
			expect(["open", "fixed"]).toContain(entry.status);
		}
	});

	/**
	 * Entries this process can afford to replay.
	 *
	 * Two exclusions, for different reasons.
	 *
	 * An entry recorded as a crash or a hang, and still open, is by definition
	 * an input that ends or wedges whatever runs it. Replaying one here would
	 * take the whole Jest run with it and prove nothing the record does not
	 * already say.
	 *
	 * An entry recorded as slow, and still open, is a performance finding whose
	 * whole content is "this takes seconds". Replaying it spends those seconds
	 * on every test run to re-learn what the file already states. Both start
	 * being replayed the moment they are marked `fixed`, which is exactly when
	 * the replay becomes both affordable and worth doing.
	 */
	const SKIP_WHILE_OPEN: ReadonlySet<string> = new Set(["crash", "hang", "slow"]);
	const replayable = entries.filter((entry) => entry.status === "fixed" || !SKIP_WHILE_OPEN.has(entry.outcome));

	test("every entry the replay skips is an open crash, hang or slow case", () => {
		for (const entry of entries) {
			if (replayable.includes(entry)) continue;
			expect(entry.status).toBe("open");
			expect([...SKIP_WHILE_OPEN]).toContain(entry.outcome);
		}
	});

	// `test.each` over an empty list throws, so the guard is out here: a fresh
	// checkout that has never found anything should still have a green suite.
	if (replayable.length > 0) {
		test.each(replayable.map((entry) => [`${entry.generator}/${entry.outcome}/${entry.id}`, entry] as const))(
			"replays %s without crashing, hanging or throwing outside the contract",
			(_name, entry) => {
				const engine = entry.input.kind === "expression" ? new ExpressionEngine({ packages: BUILTIN_PACKAGES }) : null;
				try {
					const outcome = runCase(entry.input, engine, BOUNDED_LIMITS);

					if (FORBIDDEN.has(outcome.kind) && !isKnown(outcome, entry.input)) {
						throw new Error(
							`corpus entry ${entry.id} produced an unrecorded ${outcome.kind}: ${outcome.detail}\n` +
							`  recorded as: ${entry.outcome} (${entry.detail})\n  ${describeCase(entry.input)}`,
						);
					}

					if (entry.status === "fixed") {
						// The assertion that catches a regression: the bug coming
						// back turns this outcome from ordinary back into whatever
						// it used to be.
						expect(isFailure(outcome)).toBe(false);
					}
				} finally {
					engine?.clear();
				}
			},
		);
	}
});

describe("bounded bytecode fuzz", () => {
	test("no vetted seed crashes, hangs or breaks the return contract", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		try {
			// Only the shape anchors, no generated seed expressions: compiling is
			// the expensive part, and the mutation strategies find what they find
			// from a handful of real programs rather than from variety.
			const { programs, origins } = buildMutationPool(engine, []);

			const deadline = Date.now() + BLOCK_BUDGET_MS;
			let executed = 0;
			for (let i = 0; i < VETTED_BYTECODE_SEEDS.count; i++) {
				if (Date.now() > deadline) break;
				const seed = VETTED_BYTECODE_SEEDS.start + i;
				const fuzzCase = generateBytecodeCase(seed, { mutationPool: programs, mutationOrigins: origins });
				const outcome = runCase(fuzzCase, null, BOUNDED_LIMITS);
				executed++;
				if (FORBIDDEN.has(outcome.kind) && !isKnown(outcome, fuzzCase)) {
					throw new Error(
						`seed ${seed} produced ${outcome.kind}: ${outcome.detail}\n  ${describeCase(fuzzCase)}\n` +
						`  reduce it with: npm run fuzz -- --generator=bytecode --seed=${seed} --count=1`,
					);
				}
			}
			expect(executed).toBeGreaterThan(100);
		} finally {
			engine.clear();
		}
	});
});

describe("bounded expression fuzz", () => {
	test("no vetted seed crashes, hangs or breaks the return contract", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		try {
			const vocabulary = buildVocabulary(engine);
			const deadline = Date.now() + BLOCK_BUDGET_MS;
			let executed = 0;
			for (let i = 0; i < VETTED_EXPRESSION_SEEDS.count; i++) {
				if (Date.now() > deadline) break;
				const seed = VETTED_EXPRESSION_SEEDS.start + i;
				const fuzzCase = generateExpressionCase(seed, vocabulary);
				const outcome = runCase(fuzzCase, engine, BOUNDED_LIMITS);
				executed++;
				if (FORBIDDEN.has(outcome.kind) && !isKnown(outcome, fuzzCase)) {
					throw new Error(
						`seed ${seed} produced ${outcome.kind}: ${outcome.detail}\n  ${describeCase(fuzzCase)}\n` +
						`  reduce it with: npm run fuzz -- --generator=expression --seed=${seed} --count=1`,
					);
				}
			}
			expect(executed).toBeGreaterThan(50);
		} finally {
			engine.clear();
		}
	});
});

describe("the generators stay deterministic", () => {
	test("the same seed produces the same bytecode case", () => {
		const first = generateBytecodeCase(4242);
		const second = generateBytecodeCase(4242);
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});

	test("the same seed produces the same expression", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		try {
			const vocabulary = buildVocabulary(engine);
			expect(generateExpressionCase(4242, vocabulary).source).toBe(generateExpressionCase(4242, vocabulary).source);
		} finally {
			engine.clear();
		}
	});

	test("the vocabulary is read from the engine rather than hard-coded", () => {
		const engine = new ExpressionEngine({ packages: BUILTIN_PACKAGES });
		try {
			const vocabulary = buildVocabulary(engine);
			// Numbers rather than exact contents: the point is that the tables
			// were populated from live registrations, and asserting the contents
			// would recreate the hard-coded list this design exists to avoid.
			expect(vocabulary.units.length).toBeGreaterThan(500);
			expect(vocabulary.functionNames.length).toBeGreaterThan(30);
			expect(vocabulary.phrases.length).toBeGreaterThan(5);
			expect(vocabulary.builtins.length).toBeGreaterThan(40);
			expect(vocabulary.prefixTokenTypes.length).toBeGreaterThan(20);
			expect(vocabulary.infixTokenTypes.length).toBeGreaterThan(20);
		} finally {
			engine.clear();
		}
	});
});
