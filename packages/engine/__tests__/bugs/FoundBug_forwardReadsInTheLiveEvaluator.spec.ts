import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, expectHonestDocument, expectPrototypeUntouched } from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { VMCheckpointer } from "@solve-js/vm/VMCheckpoints";
import { createVM } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { MultiWordNameTable } from "@solve-js/packages/variables/MultiWordNames";
import { formatValue } from "@solve-js/format/FormatEngine";
import { numberValue, ValueType } from "@solve-js/vm/Value";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Found bug: the live evaluator read a name defined further down with the
 * value the previous pass left it. `x * 2` above `x = 5` answered 10 from the
 * second pass on, `x + 1` above `:x = 5` answered 6, and the same held for a
 * function (`f(2)` above `f(x) = x + 1`) and for a name of several words
 * (`hourly rate * 2` above `hourly rate = 5`), where `parseDocument` reads the
 * note from the top and has none of them defined there.
 *
 * The cause: the VM holds whatever the lines that ran last wrote, and a pass
 * reads it as it finds it. The checkpoint chain now keeps the VM at a line
 * (`VMCheckpointer.syncTo`), and the evaluator moves it to the line above each
 * line it runs, so every line reads the prefix a pass from the top gives it;
 * the table of names of several words is limited to the names a line above
 * defines for the length of a pass (`MultiWordNameTable.setVisibility`).
 */

/** A line of a live pass, formatted, or `ERROR <message>`. */
function shownLine(line: EvalLineResult): string {
	if (line.error) return `ERROR ${line.error}`;
	if (!line.result) return "";
	const text = formatValue(line.result).replace(/^=\s*/, "");
	return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
}

/** A document result, formatted the same way. */
function read(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		if (line.error) return `ERROR ${line.error}`;
		if (!line.result) return "";
		const text = formatValue(line.result).replace(/^=\s*/, "");
		return line.result.type === ValueType.Error ? `ERROR ${text}` : text;
	});
}

const batch = (lines: string[]): string[] => read(newTrackedEngine().parseDocument(lines.join("\n"), { inputType: "markdown" }));
const incremental = (lines: string[]): string[] => read(evaluateDocument(newTrackedEngine(), lines.join("\n"), { inputType: "markdown" }));

/** A live evaluator's answers on each of `passes` passes over the whole note. */
function passes(lines: string[], count = 3): string[][] {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	try {
		const out: string[][] = [];
		for (let i = 0; i < count; i++) out.push(evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(shownLine));
		return out;
	} finally {
		evaluator.dispose();
	}
}

/** A live evaluator's answers after a pass, one edit, and another pass. */
function afterEdit(lines: string[], lineNumber: number, text: string): { editor: string[]; settled: string[] } {
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
	try {
		evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
		doc.editLine(lineNumber, text);
		const editor = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(shownLine);
		return { editor, settled: batch(doc.getAllLines().map((l) => l.text)) };
	} finally {
		evaluator.dispose();
	}
}

describe("the reported documents: a line above a definition does not read it", () => {
	test.each([
		[["x * 2", "x = 5"], ["ERROR Undefined variable: x", "5"]],
		[["x + 1", ":x = 5"], ["ERROR Undefined variable: x", "5"]],
		[["f(2)", "f(x) = x + 1"], ["ERROR Undefined function: f", "f(x) defined"]],
		[["hourly rate * 2", "hourly rate = 5"], ['ERROR Expected an operator or the end of the line, but found "rate"', "5"]],
	])("%j answers what a pass from the top answers, on every pass", (lines, answers) => {
		expect(batch(lines)).toEqual(answers);
		expect(incremental(lines)).toEqual(answers);
		for (const pass of passes(lines)) expect(pass).toEqual(answers);
	});

	test("the stored formula of #732 stays a formula above its unknown's definition", () => {
		const lines = ["y = x + 1", "x = 5", "y + x"];
		for (const pass of passes(lines)) expect(pass).toEqual(["x+1", "5", "11"]);
		expect(afterEdit(lines, 2, "x = 6").editor).toEqual(["x+1", "6", "13"]);
	});

	test("a line below the definition still reads it", () => {
		for (const pass of passes(["x = 5", "x * 2", "hourly rate = 3", "hourly rate * 2", "f(x) = x + 1", "f(2)"])) {
			expect(pass).toEqual(["5", "10", "3", "6", "f(x) defined", "3"]);
		}
	});

	test("a name defined twice is read with the definition above the reader", () => {
		for (const pass of passes([":x = 1", "x + 100", ":x = 99", "x + 100"])) expect(pass).toEqual(["1", "101", "99", "199"]);
	});
});

describe("the parts: the chain keeps the VM at a line", () => {
	/** A chain over a VM of its own, with `:name = value` recorded at each line as a pass would. */
	function chainOf(bindings: [number, string, number][]): { vm: ReturnType<typeof createVM>; chain: VMCheckpointer } {
		const vm = createVM(sharedOpRegistry);
		const chain = new VMCheckpointer(vm);
		chain.syncTo(0);
		for (const [line, name, value] of bindings) {
			chain.syncTo(line - 1);
			vm.setVar(name, numberValue(value));
			chain.snapshot(line, line, [name]);
			chain.noteLineRan(line);
		}
		return { vm, chain };
	}
	const at = (vm: ReturnType<typeof createVM>, name: string): number | undefined => vm.getVar(name)?.toNumber();

	test("ordinary: moving up takes a later definition back, moving down applies it again", () => {
		const { vm, chain } = chainOf([[1, "x", 1], [3, "x", 99], [5, "y", 7]]);
		expect(chain.syncedLine).toBe(5);
		chain.syncTo(2);
		expect([at(vm, "x"), at(vm, "y")]).toEqual([1, undefined]);
		chain.syncTo(4);
		expect([at(vm, "x"), at(vm, "y")]).toEqual([99, undefined]);
		chain.syncTo(5);
		expect([at(vm, "x"), at(vm, "y")]).toEqual([99, 7]);
		chain.syncTo(0);
		expect([at(vm, "x"), at(vm, "y")]).toEqual([undefined, undefined]);
	});

	test("boundary: a line not known sets every name from the chain, and noteLineRan out of order forgets the line", () => {
		const { vm, chain } = chainOf([[2, "x", 4]]);
		chain.desync();
		expect(chain.syncedLine).toBeNull();
		vm.setVar("x", numberValue(1000));
		chain.syncTo(1);
		expect(at(vm, "x")).toBeUndefined();
		chain.syncTo(2);
		expect(at(vm, "x")).toBe(4);
		chain.noteLineRan(7);
		expect(chain.syncedLine).toBeNull();
		chain.syncTo(2);
		expect(chain.syncedLine).toBe(2);
		chain.noteLineRan(3);
		expect(chain.syncedLine).toBe(3);
	});

	test("boundary: a name the chain does not record is left alone, and so is a function the chain does not hold", () => {
		const { vm, chain } = chainOf([[1, "x", 1]]);
		vm.setVar("hostName", numberValue(42));
		chain.syncTo(0);
		expect(at(vm, "hostName")).toBe(42);
		expect(at(vm, "x")).toBeUndefined();
	});

	test("boundary: resync puts a name changed outside the chain back to the line the VM is at", () => {
		const { vm, chain } = chainOf([[1, "spent", 10], [2, "spent", 30]]);
		vm.deleteVar("spent");
		chain.resync(["spent"]);
		expect(at(vm, "spent")).toBe(30);
		chain.desync();
		vm.deleteVar("spent");
		chain.resync(["spent"]);
		expect(at(vm, "spent")).toBeUndefined();
	});

	test("boundary: restoreTo records the line it rebuilt to, and applyCheckpointAt makes it unknown", () => {
		const { chain } = chainOf([[1, "x", 1], [2, "y", 2]]);
		chain.restoreTo(1);
		expect(chain.syncedLine).toBe(1);
		chain.applyCheckpointAt(2);
		expect(chain.syncedLine).toBeNull();
	});

	test("hostile: names that are inherited properties are keys like any other", () => {
		expectPrototypeUntouched(() => {
			const bindings = PROTOTYPE_WORDS.map((word, i) => [i + 1, word, i] as [number, string, number]);
			const { vm, chain } = chainOf(bindings);
			chain.syncTo(0);
			for (const word of PROTOTYPE_WORDS) expect(vm.getVar(word)).toBeUndefined();
			chain.syncTo(PROTOTYPE_WORDS.length);
			PROTOTYPE_WORDS.forEach((word, i) => expect(at(vm, word)).toBe(i));
		});
	});

	test("hostile: a line number that is not a whole number moves nowhere it should not", () => {
		const { vm, chain } = chainOf([[1, "x", 1], [2, "x", 2]]);
		chain.syncTo(Number.NaN);
		expect(chain.syncedLine).toBeNull();
		expect(at(vm, "x")).toBe(2);
		chain.syncTo(-5);
		expect(at(vm, "x")).toBeUndefined();
		chain.syncTo(Number.MAX_SAFE_INTEGER);
		expect(at(vm, "x")).toBe(2);
	});
});

describe("the parts: the table of names of several words is limited to the lines above", () => {
	test("ordinary: a name hidden by the test is not matched, and the table says it passed one over", () => {
		const table = new MultiWordNameTable();
		table.define(["hourly", "rate"], 7);
		expect(table.match(["hourly", "rate", "x"])).toBe(2);
		table.setVisibility((ids) => !ids.has(7));
		expect(table.match(["hourly", "rate", "x"])).toBe(0);
		expect(table.isHidden("hourly rate")).toBe(true);
		expect(table.takeHidden()).toBe(true);
		expect(table.takeHidden()).toBe(false);
		table.setVisibility(null);
		expect(table.match(["hourly", "rate"])).toBe(2);
		expect(table.isHidden("hourly rate")).toBe(false);
	});

	test("boundary: a shorter visible name still matches when a longer one is hidden", () => {
		const table = new MultiWordNameTable();
		table.define(["hourly", "rate"], 1);
		table.define(["hourly", "rate", "cap"], 9);
		table.setVisibility((ids) => ids.has(1));
		expect(table.match(["hourly", "rate", "cap"])).toBe(2);
		expect(table.takeHidden()).toBe(true);
	});

	test("boundary: a name not registered is not hidden, and nothing is hidden without a test", () => {
		const table = new MultiWordNameTable();
		table.setVisibility(() => false);
		expect(table.isHidden("no such name")).toBe(false);
		expect(table.match(["no", "such"])).toBe(0);
		expect(table.takeHidden()).toBe(false);
	});

	test("hostile: inherited property names are names like any other", () => {
		expectPrototypeUntouched(() => {
			const table = new MultiWordNameTable();
			table.define(["constructor", "toString"], 3);
			table.setVisibility(() => false);
			expect(table.match(["constructor", "toString"])).toBe(0);
			expect(table.isHidden("constructor toString")).toBe(true);
			expect(table.isHidden("__proto__")).toBe(false);
		});
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS)("a line above %s's definition does not read it, and Object.prototype is unchanged", (word) => {
		expectPrototypeUntouched(() => {
			const lines = [`${word} * 2`, `:${word} = 5`, `${word} * 2`];
			const answers = batch(lines);
			for (const pass of passes(lines)) expect(pass).toEqual(answers);
			expect(answers[2]).toBe("10");
		});
	});

	test("two thousand lines reading a name defined at the bottom stay undefined, within budget", () => {
		const text = [...Array.from({ length: 2_000 }, () => "x + 1"), "x = 5"];
		const started = performance.now();
		const [, second] = passes(text, 2);
		expect(performance.now() - started).toBeLessThan(20_000);
		expect(new Set(second.slice(0, -1))).toEqual(new Set(["ERROR Undefined variable: x"]));
		expect(second[second.length - 1]).toBe("5");
	});

	test("a long chain of lines each reading the one below is refused on every line", () => {
		const text = RESOURCE_PROBES.manyLines(500, "prev + 1").split("\n").reverse();
		const [, second] = passes(text, 2);
		expect(second).toEqual(batch(text));
	});

	test("a zero-width character makes a different name, above and below", () => {
		const lines = ["x​ * 2", "x = 5", "x​ * 2"];
		const answers = batch(lines);
		for (const pass of passes(lines)) expect(pass).toEqual(answers);
	});

	test("markup-shaped text around the definition is read as text", () => {
		expectHonestDocument(["<b>x</b> * 2", "x = 5", "<script>x</script>"].join("\n"));
		const lines = ["<b>x</b> * 2", "x = 5", "x * 2"];
		for (const pass of passes(lines)) expect(pass).toEqual(batch(lines));
	});
});

describe("adversarial: realistic breakage", () => {
	test("typing the definition above the reader gives the reader its value on the same pass", () => {
		const { editor, settled } = afterEdit(["", "x * 2", "x = 5"], 1, "x = 3");
		expect(editor).toEqual(settled);
		expect(editor[1]).toBe("6");
	});

	test("editing the definition away leaves the reader undefined", () => {
		const { editor, settled } = afterEdit(["x = 5", "x * 2"], 1, "7");
		expect(editor).toEqual(settled);
		expect(editor[1]).toBe("ERROR Undefined variable: x");
	});

	test("moving the definition below the reader, as a delete and an insert", () => {
		const doc = new DocumentModel();
		doc.setDocument(["x = 5", "x * 2", "1"].join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluate({ startLine: 1, endLine: 3 });
			evaluator.applyTransaction([{ startLine: 1, deleteCount: 1, insertLines: [] }]);
			evaluator.applyTransaction([{ startLine: 3, deleteCount: 0, insertLines: ["x = 5"] }]);
			const shown = evaluator.evaluate({ startLine: 1, endLine: 3 }).lines.map(shownLine);
			expect(shown).toEqual(batch(doc.getAllLines().map((l) => l.text)));
			expect(shown[0]).toBe("ERROR Undefined variable: x");
		} finally {
			evaluator.dispose();
		}
	});

	test("a running total above a forward read keeps counting from its seed", () => {
		const lines = ["spent += 10", "spent += x", "x = 5", "spent"];
		for (const pass of passes(lines)) expect(pass).toEqual(batch(lines));
	});

	test("a check and a what-if over a forward read agree with the batch pass", () => {
		for (const lines of [["check x == 5", "x = 5"], ["x * 2", "x = 5", "line 1 if x = 7"]]) {
			for (const pass of passes(lines)) expect(pass).toEqual(batch(lines));
		}
	});

	test("a viewport-only pass reads the same prefix", () => {
		const lines = [":x = 1", "x + 100", ":x = 99", "x + 100", "y * 2", "y = 4"];
		const doc = new DocumentModel();
		doc.setDocument(lines.join("\n"));
		const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
		try {
			evaluator.evaluate({ startLine: 1, endLine: 6 });
			const view = evaluator.setViewport({ startLine: 2, endLine: 5 }).lines.map(shownLine);
			expect(view).toEqual(batch(lines).slice(1, 5));
		} finally {
			evaluator.dispose();
		}
	});
});

describe("adversarial: edge cases", () => {
	test.each(NUMERIC_EDGES)("a definition of %s below its reader is not read, and above it is", (value) => {
		const lines = ["x", `x = ${value}`, "x"];
		const answers = batch(lines);
		for (const pass of passes(lines, 2)) expect(pass).toEqual(answers);
	});

	test("an empty note, a blank-only note and CRLF line endings", () => {
		for (const text of ["", "\n\n", "x * 2\r\nx = 5\r\n"]) {
			const doc = new DocumentModel();
			doc.setDocument(text);
			const evaluator = new ThreeTierEvaluator(doc, newTrackedEngine());
			try {
				evaluator.evaluate({ startLine: 1, endLine: doc.lineCount });
				const second = evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(shownLine);
				expect(second).toEqual(read(newTrackedEngine().parseDocument(text)));
			} finally {
				evaluator.dispose();
			}
		}
	});

	test("a line that reads the name it defines, with nothing above", () => {
		const lines = [":x = x + 1", "x"];
		for (const pass of passes(lines)) expect(pass).toEqual(batch(lines));
	});
});
