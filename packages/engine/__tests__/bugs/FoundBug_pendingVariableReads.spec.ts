import { afterEach, describe, expect, test } from "@jest/globals";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import type { PrefixParselet } from "@solve-js/parser/Parselet";
import type { Parser } from "@solve-js/parser/Parser";
import type { Token } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { BytecodeBuilder, type BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { createQueryResolver } from "@solve-js/resolvers/QueryResolver";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { numberValue, stringValue, type Value } from "@solve-js/vm/Value";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { formatValue } from "@solve-js/format/FormatEngine";
import { createTestEngine } from "@solve-js/testing";
import type { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import type { ParsingResult } from "@solve-js/types/ParsingResult";
import { asColonAssignment, namesStoredBy, readBeforeItsFetch } from "@solve-js/engine/PendingAssignment";
import { ExpressionEngine as Engine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { errorValue, pendingValue } from "@solve-js/vm/Value";
import { PROTOTYPE_WORDS, expectPrototypeUntouched } from "@tools/adversarial";
import { newTrackedEngine } from "@tools/trackedEngine";

/**
 * Found bug: a variable whose live value was still being fetched read as
 * undefined. `:x = <a live lookup>` answers pending on its first run, and the
 * line after it, `check x > 1` or `x * 2`, answered "Undefined variable: x".
 *
 * The cause was in two places. A line whose fetch is started answers pending
 * without the VM running it, so its `STORE_VAR` never ran and `x` was never
 * set; the engine now holds the pending value under each name the line would
 * have stored (`namesStoredBy`), so a line reading it is pending too. And a
 * bare assignment (`x = <lookup>`, no colon) went through the symbolic grammar,
 * which evaluates its right-hand side directly and never runs the resolver
 * preflight, so the fetch never started; such a line is restated as its colon
 * form (`asColonAssignment`) for the ordinary path.
 */

/** A package whose `lookup <word>` fetches through a resolver the test controls. */
function lookupPackage(): { pkg: IEnginePackage; land: (value: number) => void } {
	const name = "found-pending";
	const waiting: Array<(v: Value) => void> = [];
	const { resolver, pluginFunction } = createQueryResolver({
		namespace: name,
		pluginFunctionIndex: pluginFunctionIndexFor(`${name}:lookup`),
		fetchQuery: () => new Promise<Value>((resolve) => waiting.push(resolve)),
		timeoutMs: 5_000,
	});
	class LookupParselet implements PrefixParselet {
		readonly category = "Probe";
		parse(parser: Parser, _token: Token, builder: BytecodeBuilder): void {
			const word = parser.consume();
			builder.emitOpcode(OpCode.PUSH_STRING);
			builder.emitString(String(word.value));
			builder.emitPluginCall("lookup", 1);
		}
	}
	return {
		pkg: {
			name,
			lexerVocabulary: { keywords: { lookup: "PROBE_LOOKUP" } },
			prefixParselets: { PROBE_LOOKUP: new LookupParselet() },
			pluginFunctions: { lookup: pluginFunction },
			asyncResolvers: [resolver],
		},
		land: (value) => {
			for (const resolve of waiting.splice(0)) resolve(numberValue(value));
		},
	};
}

/** Each line as a reader sees it: PENDING, the error's message, or the formatted answer. */
function shown(result: ParsingResult): string[] {
	return result.lines.map((line) => {
		const v = line.result;
		if (v == null) return line.error ? `ERROR ${line.error}` : "";
		if (v.isPending()) return "PENDING";
		if (v.isError()) return `ERROR ${v.errorMessage}`;
		return formatValue(v);
	});
}

const engines: ExpressionEngine[] = [];
function engineWith(pkg: IEnginePackage): ExpressionEngine {
	const engine = createTestEngine([pkg]);
	engine.getBatcher().onLineResult = () => {};
	engines.push(engine);
	return engine;
}
afterEach(() => {
	for (const engine of engines.splice(0)) engine.clear();
});

describe("the lines that exposed it", () => {
	test.each([
		[":x = lookup abc\ncheck x > 1\nx * 2"],
		["x = lookup abc\ncheck x > 1\nx * 2"],
		["x = lookup abc\ny = x * 2\ny + 1"],
	])("%j reads pending on every line, through both document passes", (doc) => {
		const { pkg } = lookupPackage();
		expect(shown(engineWith(pkg).parseDocument(doc))).toEqual(["PENDING", "PENDING", "PENDING"]);
		const { pkg: again } = lookupPackage();
		expect(shown(evaluateDocument(engineWith(again), doc))).toEqual(["PENDING", "PENDING", "PENDING"]);
	});

	test("once the value lands, the lines that read it answer from it", async () => {
		const { pkg, land } = lookupPackage();
		const engine = engineWith(pkg);
		const doc = ":x = lookup abc\ncheck x > 1\nx * 2";
		expect(shown(engine.parseDocument(doc))).toEqual(["PENDING", "PENDING", "PENDING"]);
		land(21);
		await engine.settle({ timeoutMs: 2_000 });
		expect(shown(engine.parseDocument(doc))).toEqual(["= 21", "= ✓", "= 42"]);
	});

	test("a bare assignment starts its fetch too, and lands the same way", async () => {
		const { pkg, land } = lookupPackage();
		const engine = engineWith(pkg);
		const doc = "x = lookup abc\nx * 2";
		expect(shown(engine.parseDocument(doc))).toEqual(["PENDING", "PENDING"]);
		land(5);
		await engine.settle({ timeoutMs: 2_000 });
		expect(shown(engine.parseDocument(doc))).toEqual(["= 5", "= 10"]);
	});
});

// ── The parts ────────────────────────────────────────────────────────────

/** Tokens as the normaliser hands them on: a type, a value and an offset. */
function tokens(...spec: Array<[string, string]>): Token[] {
	let offset = 0;
	return spec.map(([type, value]) => {
		const token = { type, typeId: tokenTypeId(type), value, text: value, offset } as Token;
		offset += value.length + 1;
		return token;
	});
}

describe("asColonAssignment", () => {
	test("a bare single-name assignment gains a colon, and nothing else changes", () => {
		const out = asColonAssignment(tokens(["IDENT", "x"], ["EQUALS", "="], ["NUMBER", "5"]));
		expect(out?.map((t) => [t.type, t.value])).toEqual([["COLON", ":"], ["IDENT", "x"], ["EQUALS", "="], ["NUMBER", "5"]]);
	});

	test("a unit spelling as the name is a name too", () => {
		expect(asColonAssignment(tokens(["UNIT", "m"], ["EQUALS", "="], ["NUMBER", "5"]))?.[0].type).toBe("COLON");
	});

	test("the shapes it leaves alone: too short, no equals after the name, a second equals, a spaced name, an empty name", () => {
		expect(asColonAssignment([])).toBeNull();
		expect(asColonAssignment(tokens(["IDENT", "x"], ["EQUALS", "="]))).toBeNull();
		expect(asColonAssignment(tokens(["IDENT", "x"], ["PLUS", "+"], ["NUMBER", "5"]))).toBeNull();
		expect(asColonAssignment(tokens(["IDENT", "x"], ["EQUALS", "="], ["IDENT", "y"], ["EQUALS", "="], ["NUMBER", "1"]))).toBeNull();
		expect(asColonAssignment(tokens(["IDENT", "my var"], ["EQUALS", "="], ["NUMBER", "5"]))).toBeNull();
		expect(asColonAssignment(tokens(["IDENT", ""], ["EQUALS", "="], ["NUMBER", "5"]))).toBeNull();
		expect(asColonAssignment(tokens(["NUMBER", "3"], ["EQUALS", "="], ["NUMBER", "5"]))).toBeNull();
	});

	test("a prototype word as the name is restated as any other name", () => {
		for (const word of PROTOTYPE_WORDS) {
			expect(asColonAssignment(tokens(["IDENT", word], ["EQUALS", "="], ["NUMBER", "5"]))?.[1].value).toBe(word);
		}
	});
});

describe("readBeforeItsFetch", () => {
	test("a pending value, and a resolver's answer that its fetch never started", () => {
		expect(readBeforeItsFetch(pendingValue("k"))).toBe(true);
		expect(readBeforeItsFetch(errorValue("MYRATES_NOT_PREFLIGHTED", "No cached result"))).toBe(true);
		expect(readBeforeItsFetch(errorValue("HISTORICAL_RATE_NOT_PREFLIGHTED", "no"))).toBe(true);
		expect(readBeforeItsFetch(errorValue("CURRENCY_RATE_UNAVAILABLE", "No exchange rate available for USD to EUR"))).toBe(true);
	});

	test("every other answer, a failed fetch included, stays where it is", () => {
		expect(readBeforeItsFetch(numberValue(5))).toBe(false);
		expect(readBeforeItsFetch(stringValue("_NOT_PREFLIGHTED"))).toBe(false);
		expect(readBeforeItsFetch(errorValue("MYRATES_QUERY_FAILED", "down"))).toBe(false);
		expect(readBeforeItsFetch(errorValue("NOT_PREFLIGHTED_X", "no"))).toBe(false);
		expect(readBeforeItsFetch(errorValue("NETWORK_DISABLED", "off"))).toBe(false);
		for (const word of PROTOTYPE_WORDS) expect(readBeforeItsFetch(errorValue(word, "x"))).toBe(false);
	});
});

/** A compiled program that stores each name in turn. */
function storing(...names: string[]): BytecodeProgram {
	const builder = new BytecodeBuilder();
	for (const name of names) {
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(1);
		builder.emitOpcode(OpCode.STORE_VAR);
		builder.emitString(name);
	}
	return builder.build();
}

describe("namesStoredBy", () => {
	test("each name a program stores, in order and once", () => {
		expect(namesStoredBy(storing("x"))).toEqual(["x"]);
		expect(namesStoredBy(storing("a", "b", "a"))).toEqual(["a", "b"]);
	});

	test("a program that stores nothing, and an empty one", () => {
		expect(namesStoredBy(storing())).toEqual([]);
		const builder = new BytecodeBuilder();
		builder.emitOpcode(OpCode.PUSH_NUMBER);
		builder.emitNumber(3);
		expect(namesStoredBy(builder.build())).toEqual([]);
	});

	test("a malformed program yields fewer names rather than undefined or a throw", () => {
		const program = storing("x");
		const cut = { ...program, opcodes: program.opcodes.slice(0, program.opcodes.length - 1) } as BytecodeProgram;
		expect(() => namesStoredBy(cut)).not.toThrow();
		const noPool = { ...program, strings: [] } as unknown as BytecodeProgram;
		expect(namesStoredBy(noPool)).toEqual([]);
	});

	test("prototype words are names like any other, and the prototype is untouched", () => {
		expectPrototypeUntouched(() => {
			expect(namesStoredBy(storing(...PROTOTYPE_WORDS))).toEqual([...PROTOTYPE_WORDS]);
		});
	});
});

// ── Adversarial ──────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: a prototype word as the pending name reads pending, and the prototype is untouched", () => {
		expectPrototypeUntouched(() => {
			for (const word of ["constructor", "toString", "valueOf"]) {
				const { pkg } = lookupPackage();
				const out = shown(engineWith(pkg).parseDocument(`:${word} = lookup abc\n${word} * 2`));
				expect({ word, out: out[0] }).toEqual({ word, out: "PENDING" });
			}
		});
	});

	test("security: a thousand lines reading one pending name stay within their budget", () => {
		const { pkg } = lookupPackage();
		const doc = [":x = lookup abc", ...Array.from({ length: 1_000 }, () => "x + 1")].join("\n");
		const started = performance.now();
		const out = shown(engineWith(pkg).parseDocument(doc));
		expect(performance.now() - started).toBeLessThan(10_000);
		expect(new Set(out)).toEqual(new Set(["PENDING"]));
	});

	test("realistic: a name the reader never assigned is still undefined, and a typo beside a pending one is named", () => {
		const { pkg } = lookupPackage();
		const out = shown(engineWith(pkg).parseDocument(":x = lookup abc\ny * 2\nxx + 1"));
		expect(out).toEqual(["PENDING", "ERROR Undefined variable: y", "ERROR Undefined variable: xx"]);
	});

	test("realistic: a plain value assigned after the pending one replaces it", () => {
		const { pkg } = lookupPackage();
		expect(shown(engineWith(pkg).parseDocument(":x = lookup abc\n:x = 4\nx * 2"))).toEqual(["PENDING", "= 4", "= 8"]);
	});

	test("realistic: a bare assignment that only might fetch (a constant, a zone conversion) is stored as before, and survives a snapshot", () => {
		for (const [line, read] of [["x = planck", "= 6.63e-34"], ["t = 2026-04-03T15:00 in UTC-5", "= Friday, April 3, 2026, 3:00:00 PM"]] as const) {
			const engine = newTrackedEngine();
			engine.evaluateLine(1, line);
			const restored = Engine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
			try {
				expect({ line, read: formatValue(restored.evaluateExpression(line.split(" ")[0])) }).toEqual({ line, read });
			} finally {
				restored.clear();
				engine.clear();
			}
		}
	});

	test("edge: a bare assignment of a plain number is unchanged, and an equation is still solved", () => {
		const { pkg } = lookupPackage();
		const engine = engineWith(pkg);
		expect(shown(engine.parseDocument("x = 5\nx * 2"))).toEqual(["= 5", "= 10"]);
		expect(shown(evaluateDocument(engine, "x = 5\nx * 2"))).toEqual(["= 5", "= 10"]);
	});

	test("edge: an empty line, CRLF and a trailing newline around the pending line", () => {
		const { pkg } = lookupPackage();
		expect(shown(engineWith(pkg).parseDocument(":x = lookup abc\r\n\r\nx * 2\n"))).toEqual(["PENDING", "", "PENDING", ""]);
	});
});
