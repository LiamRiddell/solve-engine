import { afterEach, describe, expect, test } from "@jest/globals";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { setEngineWorkerFactory } from "@solve-js/engine";
import { DocumentModel } from "@solve-js/engine/DocumentModel";
import { ThreeTierEvaluator, type EvalLineResult } from "@solve-js/engine/ThreeTierEvaluator";
import { formatValue } from "@solve-js/format/FormatEngine";
import type { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { BindingPower } from "@solve-js/parser/BindingPower";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import { BUILTIN_PACKAGES } from "@solve-js/packages";
import { numberValue, ValueType, type Value } from "@solve-js/vm/Value";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #661: when live data landed and more than fifty lines depended on it,
 * the batcher sent their bytecode to the internal execution pool. Its workers
 * run each line in a bare VM with no variables, packages or line context, so
 * with a worker factory registered every `price * qty` came back as
 * "Undefined variable: price". A re-run now stays on the main thread whatever
 * its size, and answers as it does with no factory.
 */

/** A worker that records what it is sent and never answers. */
class FakeWorker {
	static posted: Array<{ type?: string }> = [];
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	postMessage(message: { type?: string }): void {
		FakeWorker.posted.push(message);
	}
	terminate(): void {}
}

// The pool also asks whether the runtime has a Worker at all, which Node does not.
const globalWorker = (globalThis as { Worker?: unknown }).Worker;
afterEach(() => {
	setEngineWorkerFactory(null);
	(globalThis as { Worker?: unknown }).Worker = globalWorker;
	FakeWorker.posted = [];
});

class CallParselet implements PrefixParselet {
	readonly category = "Function";
	parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
		parser.consume("LPAREN");
		parser.parseExpression(BindingPower.Lowest, builder);
		parser.consume("RPAREN");
		builder.emitPluginCall("liveprice", 1);
	}
}

/** `liveprice(n)` answers `n * 10` once the test lets it. */
function livePrice(): { pkg: IEnginePackage; release: () => void } {
	const waiting: Array<() => void> = [];
	const pkg: IEnginePackage = {
		name: "live-price",
		callFusions: { liveprice: "LIVEPRICE_CALL" },
		prefixParselets: { LIVEPRICE_CALL: new CallParselet() },
		pluginFunctions: {
			liveprice: (args) => new Promise<Value>((resolve) => waiting.push(() => resolve(numberValue(args[0].toNumber() * 10)))),
		},
	};
	return { pkg, release: () => waiting.splice(0).forEach((go) => go()) };
}

function read(line: EvalLineResult): string {
	if (line.error) return `ERROR: ${line.error}`;
	if (!line.result) return "";
	if (line.result.type === ValueType.Pending) return "Pending";
	return formatValue(line.result).replace(/^=\s*/, "");
}

/** The document: a live price, a quantity, then `dependents` lines that read both. */
function documentWith(dependents: number): string[] {
	return [":price = liveprice(1)", ":qty = 3", 'if price > 5 then "high" else "low"', "[price, qty]", ...Array.from({ length: dependents }, () => "price * qty")];
}

/** Evaluate, let the price land, wait for the announcement, and evaluate again as a host does. */
async function refreshed(lines: string[], factory: boolean): Promise<string[]> {
	if (factory) {
		(globalThis as { Worker?: unknown }).Worker = FakeWorker;
		setEngineWorkerFactory(() => new FakeWorker() as unknown as Worker);
	} else {
		setEngineWorkerFactory(null);
		(globalThis as { Worker?: unknown }).Worker = globalWorker;
	}
	const { pkg, release } = livePrice();
	const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, pkg] });
	const reader = engine.getEventStream().getReader();
	const doc = new DocumentModel();
	doc.setDocument(lines.join("\n"));
	const evaluator = new ThreeTierEvaluator(doc, engine);
	try {
		expect(read(evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines[0])).toBe("Pending");
		release();
		const { value: event } = await reader.read();
		expect(event?.type).toBe("lines-updated");
		return evaluator.evaluate({ startLine: 1, endLine: doc.lineCount }).lines.map(read);
	} finally {
		reader.releaseLock();
		evaluator.terminateWorker();
	}
}

describe("a large re-run answers the same with a worker factory as without", () => {
	test("sixty dependent lines: a variable read, a plugin call, a string and a list", async () => {
		const lines = documentWith(60);
		const withFactory = await refreshed(lines, true);
		expect(withFactory.slice(0, 5)).toEqual(["10", "3", "high", "[10, 3]", "30"]);
		expect(withFactory.slice(4).every((shown) => shown === "30")).toBe(true);
		expect(withFactory).toEqual(await refreshed(lines, false));
		expect(FakeWorker.posted.filter((message) => message.type === "EXECUTE_BATCH")).toEqual([]);
	});

	test.each([
		[47, "fifty lines re-run"],
		[48, "fifty-one lines re-run"],
	])("either side of the old threshold: %i dependents, %s", async (dependents) => {
		const lines = documentWith(dependents);
		const withFactory = await refreshed(lines, true);
		expect(withFactory[withFactory.length - 1]).toBe("30");
		expect(withFactory).toEqual(await refreshed(lines, false));
		expect(FakeWorker.posted.filter((message) => message.type === "EXECUTE_BATCH")).toEqual([]);
	});
});
