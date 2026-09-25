/**
 * Shared set-up for the specs that pin a call as read-only: highlighting
 * (#559), explaining (#566), and anything else a host makes freely, per
 * keystroke or per hover, against the engine that holds the document.
 *
 * `stateOf` flattens everything a line can change when it runs into plain,
 * comparable data, so a spec takes it before and after the call and asks for
 * the two to be equal. It reads a few private fields; the names are the
 * engine's own, reached through a cast rather than widened, since no host
 * should read them.
 */
import { createEngine } from "@solve-js/api/createEngine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { ThreeTierEvaluator } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import { sharedGlobalVariableStore } from "@solve-js/vm/GlobalVariableStore";
import type { Value } from "@solve-js/vm/Value";

/** A document that sets one of everything, so a read-only call has state to disturb. */
export const STATE_CHANGING_DOCUMENT = [
	"total += 5",
	":x = 3",
	"y = 3",
	"f(x) = x * 2",
	"1 sprint = 2 weeks",
	"random seed 7",
	"m = roll(1, 100)",
	"6 sprints in weeks",
	"total * 2",
	"a*c*n = 10",
];

/** Every shape of line that changes something when it runs. */
export const STATE_CHANGING_LINES: [string, string][] = [
	["a running total", "total += 5"],
	["a running total that subtracts", "total -= 2"],
	["a running total on a new name", "spent += 10"],
	["a running total on a unit-letter name", "b += 5"],
	["a running total that reads the line above", "total += prev"],
	["a running total that draws randomness", "total += roll(1, 6)"],
	["a running product", "total *= 3"],
	["a running quotient", "total /= 2"],
	["a colon assignment", ":x = 30"],
	["a bare assignment", "x = 3"],
	["a bare assignment to a new name", "z = 2 + 2"],
	["a bare matrix assignment", "q = [1, 2; 3, 4]"],
	["a function definition", "f(x) = x * 2"],
	["a redefined function", "f(x) = x * 9"],
	["a unit definition", "1 sprint = 2 weeks"],
	["a changed unit definition", "1 sprint = 3 weeks"],
	["a random seed", "random seed 7"],
	["a different random seed", "random seed 8"],
	["a scalar equation", "w^2 - 4 = 0"],
	["a product-chain equation", "a*c*n = 10"],
	["a solve", "n =>"],
	["a simplification", "expand((u+1)*(u+2))"],
	["a lone known variable", "total"],
];

/** Names an equation could be stored under by any line above. */
const EQUATION_NAMES = ["w", "n", "x", "y", "z", "q", "u", "total"];

/** Global names any line above could write. */
const GLOBAL_NAMES = ["g"];

/** The internals a read-only call used to write, read without widening their visibility. */
interface EngineInternals {
	accumulatorNames: Set<string>;
	userUnits: { byKey: Map<string, { ratioText: string; baseUnit: string; definedByLineId: number }> };
	linesDrawingRandom: Set<number>;
	documentRandomSeed: string | undefined;
	lineContext: { lineIndex: number } | null;
}

/** A value as a reader sees it, with its type, or `none`. */
export function describeValue(value: Value | null | undefined): string {
	return value ? `${value.type}:${formatValue(value)}` : "none";
}

/** Everything a line can change when it runs, as plain comparable data. */
export function stateOf(engine: ExpressionEngine, doc?: DocumentModel) {
	const inner = engine as unknown as EngineInternals;
	const vm = engine.getVM();
	const cachedLines: string[] = [];
	engine.getLineCache().forEach((key, entry) => cachedLines.push(`${key} -> ${describeValue(entry.result)}`));
	const documentLines: string[] = [];
	if (doc) {
		for (let n = 1; n <= doc.lineCount; n++) {
			const line = doc.getLineAt(n);
			documentLines.push(`${describeValue(line?.result)}${line?.dirty ? ", dirty" : ""}`);
		}
	}
	return {
		variables: vm.getVariableEntries().map(([name, value]) => `${name} = ${describeValue(value)}`).sort(),
		// The body as well as the signature, so a redefinition with the same
		// parameters still shows.
		functions: vm
			.getUserFunctionDefs()
			.map(def => `${def.name}(${def.params.join(", ")}) ${Array.from(def.program.opcodes).join(".")} ${Array.from(def.program.numbers).join(".")}`)
			.sort(),
		equations: EQUATION_NAMES.filter(name => vm.hasEquation(name) || vm.hasScalarEquation(name)),
		accumulators: [...inner.accumulatorNames].sort(),
		units: [...inner.userUnits.byKey].map(([key, d]) => `${key} = ${d.ratioText} ${d.baseUnit}, line id ${d.definedByLineId}`),
		randomLines: [...inner.linesDrawingRandom].sort(),
		randomSeed: inner.documentRandomSeed,
		lineContext: inner.lineContext?.lineIndex,
		cachedLines: cachedLines.sort(),
		dependencyGraph: JSON.stringify(engine.getDag().getSnapshot()),
		globals: GLOBAL_NAMES.map(name => `${name} = ${describeValue(sharedGlobalVariableStore.get(name))}`),
		documentLines,
	};
}

/** An engine and the document it holds, with a way to let both go. */
export interface Session {
	engine: ExpressionEngine;
	doc?: DocumentModel;
	evaluator?: ThreeTierEvaluator;
	dispose(): void;
}

/** A batch pass over the document, the way `parseDocument` hosts run it. */
export function openBatch(lines: string[] = STATE_CHANGING_DOCUMENT): Session {
	const engine = createEngine() as unknown as ExpressionEngine;
	engine.parseDocument(lines.join("\n"));
	return { engine, dispose: () => engine.clear() };
}

/** A live editor: a document model, an incremental evaluator, several settled passes. */
export function openEditor(lines: string[] = STATE_CHANGING_DOCUMENT): Session & { doc: DocumentModel; evaluator: ThreeTierEvaluator } {
	const engine = createEngine() as unknown as ExpressionEngine;
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, engine);
	for (let pass = 0; pass < 3; pass++) evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
	return {
		engine,
		doc,
		evaluator,
		dispose: () => {
			evaluator.terminateWorker();
			engine.clear();
		},
	};
}

/** The answers a reader of a live document sees, formatted. */
export function answersOf(doc: DocumentModel): string[] {
	return Array.from({ length: doc.lineCount }, (_, i) => {
		const result = doc.getLineAt(i + 1)?.result;
		return result ? formatValue(result).replace(/^=\s*/, "") : "";
	});
}
