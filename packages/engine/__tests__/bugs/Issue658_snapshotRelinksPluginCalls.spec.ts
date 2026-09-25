import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildSync } from "esbuild";
import { defineFunction } from "@solve-js/api/defineFunction";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { restoreBytecode, type EngineSnapshot, type SerializedBytecode } from "@solve-js/engine/EngineSnapshot";
import { formatValue } from "@solve-js/format/FormatEngine";
import { OpCode } from "@solve-js/parser/OpCode";
import { BUILTIN_PACKAGES } from "@solve-js/packages";
import { numberValue, type Value } from "@solve-js/vm/Value";

/**
 * Issue #658: a snapshot carried compiled bytecode with plugin-function indices
 * baked in, and an index is allocated process-wide in registration order. A
 * snapshot restored in another process, with the same packages in another
 * order, ran whatever sat at the old index: `zbeta(21)` answered 1,021, the
 * `zalpha` answer. Version 2 names the function behind every call, a restore
 * relinks each one by name, and a snapshot that calls a function no registered
 * package provides is refused.
 */

const SRC = path.resolve(__dirname, "../../src");
let scratch: string;
let bundle: string;

// One script, bundled from the source, run as its own process per step, so each
// step allocates plugin indices from nothing, as a separate process does.
const SCRIPT = `
import * as fs from "node:fs";
import { ExpressionEngine } from ${JSON.stringify(path.join(SRC, "engine/ExpressionEngine"))};
import { BUILTIN_PACKAGES } from ${JSON.stringify(path.join(SRC, "packages"))};
import { defineFunction } from ${JSON.stringify(path.join(SRC, "api/defineFunction"))};
import { formatValue } from ${JSON.stringify(path.join(SRC, "format/FormatEngine"))};

const fn = (name, call) => defineFunction({ name, args: [{ name: "x", type: "number" }], returns: "number", call });
const zalpha = fn("zalpha", (x) => x + 1000);
const zbeta = fn("zbeta", (x) => x * 2);
const zgamma = fn("zgamma", (x) => x - 1);
const TEXTS = ["zalpha(21)", "zbeta(21)", 'upper("abc")', 'sha256("abc")', "twice(5)"];
const DOCUMENT = TEXTS.slice(0, 4).join("\\n") + "\\ntwice(x) = x * 2 + 1";

function answers(engine) {
	return TEXTS.map((text) => {
		try {
			return formatValue(engine.evaluateExpression(text));
		} catch (error) {
			return "THROWS " + error.code;
		}
	});
}

const [mode, file] = process.argv.slice(2);
let out;
try {
	if (mode === "write") {
		const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, zalpha, zbeta] });
		engine.parseDocument(DOCUMENT);
		out = { answers: answers(engine) };
		fs.writeFileSync(file, JSON.stringify(engine.toJSON()));
	} else {
		const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
		if (mode === "after-another") new ExpressionEngine({ packages: [zgamma] });
		const packages = {
			reversed: [...BUILTIN_PACKAGES, zbeta, zalpha],
			"after-another": [...BUILTIN_PACKAGES, zalpha, zbeta],
			"custom-first": [zbeta, zalpha, ...BUILTIN_PACKAGES],
			missing: [...BUILTIN_PACKAGES, zbeta],
		}[mode];
		out = { answers: answers(ExpressionEngine.fromJSON(snapshot, { packages })) };
	}
} catch (error) {
	out = { refused: error.code, message: error.message };
}
console.log(JSON.stringify(out));
`;

function run(mode: string, file: string): { answers?: string[]; refused?: string; message?: string } {
	const result = spawnSync(process.execPath, [bundle, mode, file], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`${mode} exited ${result.status}: ${result.stderr}`);
	return JSON.parse(result.stdout.trim().split("\n").pop()!);
}

const WRITER = ["= 1,021", "= 42", "= ABC", "= ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "= 11"];

beforeAll(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "solve-658-"));
	const entry = path.join(scratch, "probe.ts");
	fs.writeFileSync(entry, SCRIPT);
	bundle = path.join(scratch, "probe.mjs");
	buildSync({
		entryPoints: [entry],
		bundle: true,
		platform: "node",
		format: "esm",
		outfile: bundle,
		tsconfig: path.resolve(__dirname, "../../tsconfig.json"),
		logLevel: "silent",
		banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
	});
}, 60_000);

afterAll(() => {
	fs.rmSync(scratch, { recursive: true, force: true });
});

describe("a snapshot restored in another process answers as the writer did", () => {
	let file: string;
	beforeAll(() => {
		file = path.join(scratch, "snapshot.json");
		expect(run("write", file).answers).toEqual(WRITER);
	}, 30_000);

	test.each([
		["the same packages in another order", "reversed"],
		["after another engine registered first", "after-another"],
		["with the custom packages ahead of the built-ins", "custom-first"],
	])("%s", (_label, mode) => {
		expect(run(mode, file).answers).toEqual(WRITER);
	}, 30_000);

	test("a package it needs is missing: refused, not answered", () => {
		const result = run("missing", file);
		expect(result.refused).toBe("SNAPSHOT_PACKAGE_MISSING");
		expect(result.message).toContain('"define:zalpha" from the package "solve-fn-zalpha"');
	}, 30_000);

	test("a version 1 snapshot restores, and its plugin calls recompile rather than run on trust", () => {
		const v1 = JSON.parse(fs.readFileSync(file, "utf8"));
		v1.version = 1;
		const strip = (sb: SerializedBytecode) => {
			delete sb.pluginCalls;
			sb.userFunctionBodies?.forEach((fn) => strip(fn.program));
			sb.anonymousBodies?.forEach((body) => strip(body.program));
		};
		v1.lineCache.forEach((e: { bytecode: SerializedBytecode }) => strip(e.bytecode));
		v1.bytecodeCache.forEach((c: { program: SerializedBytecode }) => strip(c.program));
		v1.userFunctions.forEach((fn: { program: SerializedBytecode }) => strip(fn.program));
		const v1File = path.join(scratch, "snapshot-v1.json");
		fs.writeFileSync(v1File, JSON.stringify(v1));
		// The lines that call a plugin function recompile and answer as the writer
		// did; the user function, which calls none, restores as it always did.
		expect(run("reversed", v1File).answers).toEqual(WRITER);
	}, 30_000);
});

// ── In-process adversarial cases ────────────────────────────────────────────

const fn = (name: string, call: (x: number) => number) => defineFunction({ name, args: [{ name: "x", type: "number" }], returns: "number", call });
const zalpha = fn("zalpha", (x) => x + 1000);
const zbeta = fn("zbeta", (x) => x * 2);

function written(): EngineSnapshot {
	const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, zalpha, zbeta] });
	engine.parseDocument("zalpha(21)\nzbeta(21)");
	return JSON.parse(JSON.stringify(engine.toJSON()));
}

const cached = (snapshot: EngineSnapshot, expression: string) => snapshot.bytecodeCache.find((c) => c.expression === expression)!.program;

function outcome(run: () => ExpressionEngine, text: string): string {
	try {
		return formatValue(run().evaluateExpression(text) as Value);
	} catch (error) {
		return `REFUSED ${(error as { code?: string }).code}`;
	}
}

describe("adversarial restores", () => {
	test("the snapshot names each call by package and function", () => {
		expect(cached(written(), "zbeta(21)").pluginCalls).toEqual([{ pkg: "solve-fn-zbeta", name: "define:zbeta" }]);
	});

	test("index bytes edited by hand are relinked by name, not trusted", () => {
		const snapshot = written();
		const program = cached(snapshot, "zbeta(21)");
		const site = program.opcodes.indexOf(OpCode.CALL_PLUGIN);
		program.opcodes[site + 1] = cached(snapshot, "zalpha(21)").opcodes[site + 1];
		expect(outcome(() => ExpressionEngine.fromJSON(snapshot, { packages: [...BUILTIN_PACKAGES, zalpha, zbeta] }), "zbeta(21)")).toBe("= 42");
	});

	test("a recorded name no package provides is refused", () => {
		const snapshot = written();
		cached(snapshot, "zbeta(21)").pluginCalls![0].name = "define:nosuch";
		expect(outcome(() => ExpressionEngine.fromJSON(snapshot, { packages: [...BUILTIN_PACKAGES, zalpha, zbeta] }), "zbeta(21)")).toBe("REFUSED SNAPSHOT_PACKAGE_MISSING");
	});

	test("the recorded name, now registered by a different package, is refused", () => {
		const impostor: IEnginePackage = { name: "impostor", pluginFunctions: { "define:zbeta": (): Value => numberValue(-1) } };
		expect(outcome(() => ExpressionEngine.fromJSON(written(), { packages: [...BUILTIN_PACKAGES, zalpha, impostor] }), "zbeta(21)")).toBe("REFUSED SNAPSHOT_PACKAGE_MISSING");
	});

	test("a call with its name dropped is malformed, not relinked out of step", () => {
		const snapshot = written();
		cached(snapshot, "zbeta(21)").pluginCalls = [];
		expect(outcome(() => ExpressionEngine.fromJSON(snapshot, { packages: [...BUILTIN_PACKAGES, zalpha, zbeta] }), "zbeta(21)")).toBe("REFUSED SNAPSHOT_MALFORMED");
	});

	test("a program calling an index nothing is registered at is left out of the snapshot", () => {
		const engine = new ExpressionEngine({ packages: [...BUILTIN_PACKAGES, zalpha, zbeta] });
		engine.parseDocument("zbeta(21)\n1 + 1");
		engine.unregisterPackage("solve-fn-zbeta");
		const snapshot = engine.toJSON();
		expect(snapshot.lineCache.map((e) => e.expression)).toEqual(["1 + 1"]);
		expect(snapshot.bytecodeCache.map((c) => c.expression)).not.toContain("zbeta(21)");
	});
});

describe("restoreBytecode", () => {
	const call = (op: OpCode, ...index: number[]): SerializedBytecode => ({
		opcodes: [OpCode.PUSH_NUMBER, 0, op, ...index, 1, OpCode.HALT],
		numbers: [1],
		strings: [],
		hasAsync: true,
		pluginCalls: [{ pkg: "p", name: "f" }],
	});

	test("a one-byte call relinks to an index that fits", () => {
		expect(Array.from(restoreBytecode(call(OpCode.CALL_PLUGIN, 7), () => 9)!.opcodes)).toEqual([OpCode.PUSH_NUMBER, 0, OpCode.CALL_PLUGIN, 9, 1, OpCode.HALT]);
	});

	test("a one-byte call cannot take an index past 255, so the program recompiles instead", () => {
		expect(restoreBytecode(call(OpCode.CALL_PLUGIN, 7), () => 300)).toBeNull();
	});

	test("a two-byte call takes any index", () => {
		expect(Array.from(restoreBytecode(call(OpCode.CALL_PLUGIN_WIDE, 7, 0), () => 300)!.opcodes).slice(2, 5)).toEqual([OpCode.CALL_PLUGIN_WIDE, 300 & 0xff, 300 >> 8]);
	});

	test("a version 1 program with a call is not trusted", () => {
		const v1 = call(OpCode.CALL_PLUGIN, 7);
		delete v1.pluginCalls;
		expect(restoreBytecode(v1, null)).toBeNull();
	});

	test("a program with no call restores unchanged, and records none", () => {
		const plain: SerializedBytecode = { opcodes: [OpCode.PUSH_NUMBER, 0, OpCode.HALT], numbers: [5], strings: [], hasAsync: false };
		const program = restoreBytecode(plain, null)!;
		expect(Array.from(program.opcodes)).toEqual(plain.opcodes);
		expect(program.pluginCalls).toBeUndefined();
	});
});
