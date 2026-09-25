import { afterEach, describe, expect, test } from "@jest/globals";
import * as path from "node:path";
import * as ts from "typescript";
import { createLinkedTransports, createWorkerEngine, serializeValue, startWorkerRuntime, type WorkerEngine } from "@solve-js/worker";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Issue #662: the worker DTO carried an error's message but not its code, so
 * `5 kg in m` arrived without `INCOMPATIBLE_UNITS` and a host could branch only
 * on the words. It now carries `errorCode`. And `EventTargetLike` typed
 * `onmessage` as a function-typed property, which `strict` compares
 * contravariantly, so the performance guide's `eventTargetTransport(worker)`
 * failed to compile against a DOM `Worker`. The shape is loosened and exported,
 * and the fixture below compiles it under `strict` with the DOM and WebWorker
 * libs so it cannot stop compiling unnoticed.
 */

const disposers: Array<() => void> = [];
afterEach(() => {
	while (disposers.length > 0) disposers.pop()!();
});

async function remote(): Promise<WorkerEngine> {
	const { client, host } = createLinkedTransports();
	const stop = startWorkerRuntime(host);
	const engine = await createWorkerEngine({ transport: client });
	disposers.push(() => {
		engine.terminate();
		stop();
	});
	return engine;
}

const FAILURES: Array<[string, string]> = [
	["5 kg in m", "INCOMPATIBLE_UNITS"],
	["sqrt(-1 kg)", "UNIT_ROOT_UNSUPPORTED"],
	["2020-01-01 + 5 kg", "INVALID_DATETIME_OP"],
	["md5(5)", "HASH_EXPECTED_TEXT"],
	["[1,2] + [1,2,3]", "DIMENSION_MISMATCH"],
	["factorial(-1)", "INVALID_FACTORIAL_INPUT"],
	["log(-1)", "FUNCTION_DOMAIN"],
];

describe("an error crosses the worker boundary with its code", () => {
	test.each(FAILURES)("%s through serializeValue", (text, code) => {
		const value = newTrackedEngine().evaluateExpression(text);
		expect(value.errorCode).toBe(code);
		expect(serializeValue(value).errorCode).toBe(code);
	});

	test("every error the engine returns keeps the main thread's code", () => {
		const engine = newTrackedEngine();
		for (const [text] of FAILURES) {
			const value = engine.evaluateExpression(text);
			expect(value.errorCode).toBeDefined();
			expect(serializeValue(value).errorCode).toBe(value.errorCode);
		}
	});

	test("through the remote evaluateExpression and parseDocument", async () => {
		const engine = await remote();
		for (const [text, code] of FAILURES) expect((await engine.evaluateExpression(text)).errorCode).toBe(code);
		const value = await engine.evaluateExpression("5 kg in m");
		expect(value.errorCode).toBe("INCOMPATIBLE_UNITS");
		expect(value.text).toBe("a mass cannot be converted to a length");
		const document = await engine.parseDocument("5 kg in m\n1 + 1");
		expect(document.lines[0].result?.errorCode).toBe("INCOMPATIBLE_UNITS");
		expect(document.lines[1].result && "errorCode" in document.lines[1].result).toBe(false);
	});

	test("a value that is not an error carries no errorCode key", () => {
		const engine = newTrackedEngine();
		for (const text of ["1 + 1", "5 kg", '"text"', "[1, 2]", "#ff0000"]) {
			expect("errorCode" in serializeValue(engine.evaluateExpression(text))).toBe(false);
		}
	});
});

/** Compile `source` as a module beside transport.ts under `strict` with `lib`, and return the diagnostics. */
function compile(source: string, lib: string[]): string[] {
	const fixture = path.resolve(__dirname, "../../src/worker/__typeFixture__.ts");
	const options: ts.CompilerOptions = {
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib,
		types: [],
	};
	const host = ts.createCompilerHost(options);
	const getSourceFile = host.getSourceFile.bind(host);
	const fileExists = host.fileExists.bind(host);
	const readFile = host.readFile.bind(host);
	const same = (name: string) => path.resolve(name) === fixture;
	host.getSourceFile = (name, language, ...rest) =>
		same(name) ? ts.createSourceFile(name, source, language) : getSourceFile(name, language, ...rest);
	host.fileExists = (name) => same(name) || fileExists(name);
	host.readFile = (name) => (same(name) ? source : readFile(name));
	const program = ts.createProgram([fixture], options, host);
	return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("the transport shape compiles under strict against the real DOM types", () => {
	test("a DOM Worker and a MessagePort, main side", () => {
		const diagnostics = compile(
			`import { eventTargetTransport, type EventTargetLike } from "./transport";
declare const worker: Worker;
declare const port: MessagePort;
eventTargetTransport(worker);
eventTargetTransport(port);
const named: EventTargetLike = worker;
void named;
`,
			["lib.es2022.d.ts", "lib.dom.d.ts"],
		);
		expect(diagnostics).toEqual([]);
	}, 30_000);

	test("a DedicatedWorkerGlobalScope and a MessagePort, worker side", () => {
		const diagnostics = compile(
			`import { eventTargetTransport } from "./transport";
declare const scope: DedicatedWorkerGlobalScope;
declare const port: MessagePort;
eventTargetTransport(scope);
eventTargetTransport(port);
`,
			["lib.es2022.d.ts", "lib.webworker.d.ts"],
		);
		expect(diagnostics).toEqual([]);
	}, 30_000);

	test("the fixture is live: a target with no postMessage is still refused", () => {
		const diagnostics = compile(
			`import { eventTargetTransport } from "./transport";
eventTargetTransport({ onmessage: null });
`,
			["lib.es2022.d.ts", "lib.dom.d.ts"],
		);
		expect(diagnostics.join("\n")).toContain("postMessage");
	}, 30_000);
});
