/**
 * A structural guard over the algebra verbs, in the mould of
 * `PipelineConsistency.spec.ts`.
 *
 * That spec exists because the `=>` grammar once shipped correct and tested on
 * one evaluation path while being dead code on the real one. Adding a verb has
 * three more ways to half-ship: the normalizer can mint a token type no
 * parselet is registered for, a `CALL_BUILTIN` index can be allocated but never
 * implemented (which the engine's own iteration log records happening twice
 * when parallel work collided on that shared number space), and a verb can work
 * while being documented nowhere.
 *
 * Every check below is driven from the single `SYMBOLIC_FUNCTIONS` table, so a
 * verb added there without its wiring fails rather than silently doing nothing.
 */
import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SYMBOLIC_FUNCTIONS, SYMBOLIC_PACKAGE } from "@solve-js/packages/symbolic";
import { builtinFunctions } from "@solve-js/vm/VMBuiltins";
import { SYMBOLIC_NATIVE_BUILTINS } from "@solve-js/vm/SymbolicOps";
import { getTokenCategory } from "@solve-js/language/TokenCategoryMap";
import { formatValue } from "@solve-js/format/FormatEngine";
import { newTrackedEngine } from "@tools/trackedEngine";

/** Repository-root-relative path to the documentation pages the table points at. */
const DOC_DIR = join(__dirname, "..", "..", "..", "..", "docs", "src", "content", "docs", "syntax");

describe.each(SYMBOLIC_FUNCTIONS.map(fn => [fn.word, fn] as const))("algebra verb: %s", (_word, fn) => {
	test("has a parselet registered for the token type the normalizer mints", () => {
		const registered = (SYMBOLIC_PACKAGE.prefixParselets ?? []).map(entry => entry.tokenType);
		expect(registered).toContain(fn.tokenType);
	});

	test("its builtin index has a live implementation", () => {
		expect(typeof builtinFunctions[fn.builtinIndex]).toBe("function");
	});

	test("its builtin index is exempt from the VM's symbolic interception", () => {
		// An algebra verb must receive the expression containing unknowns rather
		// than be told it cannot be applied to one. vm/SymbolicOps.ts holds that
		// exemption set separately because vm/ may not import from packages/, so
		// this is the check that the two stay in agreement.
		expect(SYMBOLIC_NATIVE_BUILTINS.has(fn.builtinIndex)).toBe(true);
	});

	test("its token type has a highlighting category", () => {
		expect(getTokenCategory(fn.tokenType)).toBeDefined();
	});

	test("stays an ordinary identifier when not called, so it works as a variable name", () => {
		const engine = newTrackedEngine();
		try {
			const [assigned] = engine.evaluateLine(1, `:${fn.word} = 1.5`);
			expect(assigned.toNumber()).toBe(1.5);
			const [read] = engine.evaluateLine(2, `:${fn.word} + 1`);
			expect(read.toNumber()).toBe(2.5);
		} finally {
			engine.clear();
		}
	});

	test("produces identical output through every public entry point", () => {
		const viaLine = newTrackedEngine();
		const viaDebug = newTrackedEngine();
		const viaLean = newTrackedEngine();
		try {
			const line = formatValue(viaLine.evaluateLine(1, fn.example)[0]);
			const debug = formatValue(viaDebug.evaluateLineWithDebug(1, fn.example).value);
			const parsed = viaLean.evaluateLines([fn.example]);
			const lean = formatValue(parsed[0].result!);

			expect(line).toBe(fn.expected);
			expect(debug).toBe(line);
			expect(lean).toBe(line);
		} finally {
			viaLine.clear();
			viaDebug.clear();
			viaLean.clear();
		}
	});

	test("is documented with a runnable example", () => {
		const path = join(DOC_DIR, fn.docPage);
		expect(existsSync(path)).toBe(true);
		const text = readFileSync(path, "utf8");
		// DocExamples.spec.ts executes every ```solve block, so requiring the
		// word to appear inside one makes that spec transitively responsible for
		// this example being correct, not merely present.
		const blocks = text.match(/```solve\n[\s\S]*?```/g) ?? [];
		expect(blocks.some(block => block.includes(fn.word))).toBe(true);
	});
});
