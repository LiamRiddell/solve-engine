import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { NUMERIC_EDGES, PROTOTYPE_WORDS, RESOURCE_PROBES, TEXT_EDGES, expectHonestDocument, expectHonestLine, expectPrototypeUntouched, fill } from "@tools/adversarial";
import { formatValue } from "@solve-js/format/FormatEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId, type Token } from "@solve-js/lexer/Token";
import type { Parser } from "@solve-js/parser/Parser";
import { constantParselet } from "@solve-js/packages/constants/parselets/ConstantParselet";
import { quantityRefusal } from "@solve-js/vm/SymbolicOps";
import { refuseLikeProduct } from "@solve-js/vm/UnitAlgebra";
import { numberValue, uomValue, type Value } from "@solve-js/vm/Value";
import type { ParsedLine } from "@solve-js/types/ParsingResult";

/**
 * Found bug: a constant with a unit (`gravity`, `speed of light`), and one
 * marked with the unit it is really in (`planck`, `avogadro`), was refused
 * inside every held expression (a function body, the expression of `solve`,
 * `der` and `integral`, a map transform) with "calls an async operation
 * (weather, stocks, currency, ...)", a reason that had nothing to do with it.
 *
 * The cause: the constants package attaches a constant's unit through its
 * `constantValue` plugin call, and every plugin call marked the compiled
 * program as one that may wait for data, which each held expression refuses.
 * That plugin answers from its own table and never waits, so the call is now
 * emitted as synchronous (`emitPluginCall(name, argCount, { synchronous: true })`)
 * and leaves the mark alone. A function body and a map take `gravity` as they
 * take `pi`. A formula (`solve`, `der`, `integral`, the arrow) still cannot
 * hold a unit, so it refuses the constant with its own reason,
 * SYMBOLIC_QUANTITY_OPERAND, which now names the acceleration as `m/s²` rather
 * than the engine's `mps2`.
 */

/** A line's answer, or `THROWS <message>`. */
function shown(line: string, engine: ExpressionEngine = newTrackedEngine()): string {
	try {
		return formatValue(engine.evaluateExpression(line)).replace(/^=\s*/, "");
	} catch (e) {
		return `THROWS ${(e as Error).message}`;
	}
}

/** A line's error code, or `none`. */
function code(line: string): string {
	try {
		const v = newTrackedEngine().evaluateExpression(line);
		return v.isError() ? String(v.errorCode) : "none";
	} catch (e) {
		return `THROWS ${(e as { code?: string }).code ?? ""}`;
	}
}

/** A document line's answer, or `THREW: <message>`. */
function read(line: ParsedLine | undefined): string {
	if (!line) return "THREW: no line";
	if (line.error) return `THREW: ${line.error}`;
	return line.result ? formatValue(line.result).replace(/^=\s*/, "") : "";
}

/** Each line of a document, through both passes, which must agree. */
function both(lines: readonly string[]): string[] {
	const text = lines.join("\n");
	const batch = newTrackedEngine().parseDocument(text).lines.map(read);
	const incremental = evaluateDocument(newTrackedEngine(), text).lines.map(read);
	expect(incremental).toEqual(batch);
	return batch;
}

/** A bare token, for driving a parselet by hand. */
function token(type: string, text: string): Token {
	return new LexerToken(type, tokenTypeId(type), text, text, 0, text.length, 1, 1);
}

/** The reason a formula gives for refusing gravity. */
const FORMULA_REFUSAL = 'A formula keeps no units, so combining "x" with an amount in m/s² would drop the m/s². Give "x" a value on a line above, or write the formula without the unit.';

describe("the lines that exposed it", () => {
	test("a function body takes a constant with a unit, and the answer keeps it", () => {
		expect(shown("f(m) = m * gravity")).toBe("f(m) defined");
		expect(both(["f(m) = m * gravity", "f(70 kg) as N"])).toEqual(["f(m) defined", "686.47 N"]);
		expect(both(["h(t) = 0.5 * gravity * t^2", "h(3)"])).toEqual(["h(t) defined", "44.13 m/s²"]);
		expect(both(["g(n) = n * speed of light", "g(0.5) in km/s"])).toEqual(["g(n) defined", "149,896.23 km/s"]);
	});

	test("a constant marked with the unit it is in is a plain number there, as it is on its own", () => {
		expect(both(["p(n) = n * planck", "p(2)"])).toEqual(["p(n) defined", "1.33e-33"]);
		expect(shown("solve(x^2 = avogadro, x)")).toBe("[-776,024,533,117.35, 776,024,533,117.35]");
	});

	test("a map and an aggregate over a list take it", () => {
		expect(shown("map(x * gravity, [1, 2])")).toBe("[9.81 m/s², 19.61 m/s²]");
		expect(shown("sum(x * gravity, [1, 2])")).toBe("29.42 m/s²");
		expect(shown("map(x * planck, [1, 2])")).toBe("[6.63e-34, 1.33e-33]");
	});

	test("a formula refuses it for its unit, in plain words, never as live data", () => {
		for (const line of ["solve(x = gravity * 2, x)", "der(gravity*x^2, x)", "integral(x*gravity, x, 0, 1)", "gravity * x =>"]) {
			expect(shown(line)).toBe(FORMULA_REFUSAL);
			expect(code(line)).toBe("SYMBOLIC_QUANTITY_OPERAND");
		}
		// The same refusal a unit written out by hand gets.
		expect(shown("solve(x = 9.8 m/s^2 * 2, x)")).toBe(FORMULA_REFUSAL);
		expect(shown("solve(x = 2 * speed of light, x)")).toBe('A formula keeps no units, so combining "x" with an amount in m/s would drop the m/s. Give "x" a value on a line above, or write the formula without the unit.');
	});

	test("through the three entry points", () => {
		expect(formatValue(newTrackedEngine().evaluateLine(1, "f(m) = m * gravity"))).toBe("= f(m) defined");
		expect(formatValue(newTrackedEngine().evaluateLine(1, "map(x * gravity, [1, 2])"))).toBe("= [9.81 m/s², 19.61 m/s²]");
		expect(both(["weight(m) = m * gravity", "weight(2 kg) as N", "check weight(1 kg) as N > 9 N"])).toEqual(["weight(m) defined", "19.61 N", "✓"]);
		expect(both(["solve(x = gravity * 2, x)"])).toEqual([FORMULA_REFUSAL]);
	});
});

describe("the parts: emitPluginCall's synchronous option", () => {
	/** A builder that knows two plugin functions, one past the narrow index. */
	function builder(): BytecodeBuilder {
		return new BytecodeBuilder(new Map([["fast", 3], ["wide", 300]]));
	}

	test("ordinary: a synchronous call is emitted byte for byte as any call, and does not mark the program", () => {
		const sync = builder();
		sync.emitPluginCall("fast", 1, { synchronous: true });
		const plain = builder();
		plain.emitPluginCall("fast", 1);
		const a = sync.build();
		const b = plain.build();
		expect(Array.from(a.opcodes)).toEqual(Array.from(b.opcodes));
		expect(Array.from(a.opcodes)).toEqual([OpCode.CALL_PLUGIN, 3, 1]);
		expect(a.pluginCalls).toEqual(b.pluginCalls);
		expect(a.hasAsync).toBe(false);
		expect(b.hasAsync).toBe(true);
	});

	test("boundary: an asynchronous call on the same line still counts, before or after, and the wide form is covered", () => {
		const before = builder();
		before.emitPluginCall("fast", 0);
		before.emitPluginCall("fast", 0, { synchronous: true });
		expect(before.build().hasAsync).toBe(true);
		const after = builder();
		after.emitPluginCall("fast", 0, { synchronous: true });
		after.emitPluginCall("fast", 0);
		expect(after.build().hasAsync).toBe(true);
		const wide = builder();
		wide.emitPluginCall("wide", 2, { synchronous: true });
		const program = wide.build();
		expect(Array.from(program.opcodes)).toEqual([OpCode.CALL_PLUGIN_WIDE, 300 & 0xff, 300 >> 8, 2]);
		expect(program.hasAsync).toBe(false);
		// A reset builder starts unmarked.
		before.reset();
		expect(before.build().hasAsync).toBe(false);
	});

	test("hostile: no option, an empty one or a false one is asynchronous, and an unknown name is refused without marking", () => {
		for (const options of [undefined, {}, { synchronous: false }]) {
			const b = builder();
			b.emitPluginCall("fast", 1, options);
			expect(b.build().hasAsync).toBe(true);
		}
		const b = builder();
		for (const name of ["missing", ...PROTOTYPE_WORDS]) {
			expect(() => b.emitPluginCall(name, 1, { synchronous: true })).toThrow(/No registered plugin function/);
		}
		expect(b.build().hasAsync).toBe(false);
	});

	test("hostile: a handler marked synchronous that breaks the contract and returns a promise is answered honestly", () => {
		// A package that promises a synchronous handler and returns a promise
		// anyway. The line waits for it, or is refused; it never crashes or hangs.
		const LIAR: IEnginePackage = {
			name: "test-liar",
			lexerVocabulary: { keywords: { liar: "LIAR" } },
			prefixParselets: {
				LIAR: {
					category: "Test",
					parse(_parser: Parser, _token: Token, b: BytecodeBuilder): void {
						b.emitPluginCall("liarValue", 0, { synchronous: true });
					},
				},
			},
			pluginFunctions: { liarValue: (): Value => Promise.resolve(numberValue(7)) as unknown as Value },
		};
		const engine = newTrackedEngine({ packages: [...BUILTIN_PACKAGES, LIAR] });
		expectHonestLine("liar + 1", { engine });
		// On its own line the answer waits for the promise; run inside a body,
		// the VM's own guard refuses it, as it refuses any call that waits there.
		expect(shown("liar + 1", engine)).toBe("…");
		expect(newTrackedEngine({ packages: [...BUILTIN_PACKAGES, LIAR] }).parseDocument("f(n) = n * liar\nf(2)\nmap(x * liar, [1, 2])").lines.map(read)).toEqual([
			"f(n) defined",
			"THREW: f: user-defined functions with async bodies (weather, stocks, currency, ...) aren't supported",
			"THREW: map/reduce transform bodies calling an async operation (weather, stocks, currency, ...) aren't supported",
		]);
		expectHonestLine("f(n) = n * liar", { engine });
		expectHonestDocument("f(n) = n * liar\nf(2)\nmap(x * liar, [1, 2])");
	});
});

describe("the parts: constantParselet", () => {
	/** The program a constant compiles to. */
	function compiled(name: string): ReturnType<BytecodeBuilder["build"]> {
		const b = new BytecodeBuilder(new Map([["constantValue", 0]]));
		constantParselet(name).parse({} as Parser, token("GRAVITY", name), b);
		return b.build();
	}

	test("ordinary: gravity calls the plugin, synchronously", () => {
		const program = compiled("gravity");
		expect(program.pluginCalls?.names).toEqual(["constantValue"]);
		expect(program.hasAsync).toBe(false);
	});

	test("boundary: every constant the plugin builds is synchronous, the marked ones included", () => {
		for (const name of ["speed of light", "electron mass", "proton mass", "boltzmann", "avogadro", "planck", "elementary charge", "gas constant"]) {
			expect(compiled(name).hasAsync).toBe(false);
		}
	});

	test("hostile: a name the table does not have still goes to the plugin, which refuses it by name", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const program = compiled(word);
				expect(program.pluginCalls?.names).toEqual(["constantValue"]);
				expect(program.hasAsync).toBe(false);
			}
		});
	});
});

describe("the parts: the refusals name the unit as the reader writes it", () => {
	test("quantityRefusal: ordinary, an acceleration, and no unknown to name", () => {
		expect(quantityRefusal("km", "x").errorMessage).toBe('A formula keeps no units, so combining "x" with an amount in km would drop the km. Give "x" a value on a line above, or write the formula without the unit.');
		expect(quantityRefusal("mps2", "x").errorMessage).toBe(FORMULA_REFUSAL);
		expect(quantityRefusal("mps2", null).errorMessage).toContain("combining an unknown with an amount in m/s²");
		expect(quantityRefusal("km/mps2", "x").errorMessage).toContain("km/m/s²");
	});

	test("quantityRefusal: hostile units and names are written as text", () => {
		expect(quantityRefusal("timecode@30", "t").errorMessage).toContain("timecode at 30 fps");
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const v = quantityRefusal(word, word);
				expect(v.errorCode).toBe("SYMBOLIC_QUANTITY_OPERAND");
				expect(v.errorMessage).toContain(`"${word}"`);
			}
		});
		expect(quantityRefusal("", "x").errorMessage).toContain("an amount in  would drop");
	});

	test("refuseLikeProduct: an acceleration times an acceleration says m/s², and other units are as before", () => {
		expect(refuseLikeProduct(uomValue(1, "mps2"), uomValue(2, "mps2"))?.errorMessage).toBe(
			"A quantity in m/s² times one in m/s² has no unit: acceleration times acceleration is not a unit. Lengths multiply into an area or a volume, and no other quantity squares into one.",
		);
		expect(refuseLikeProduct(uomValue(1, "kg"), uomValue(2, "g"))?.errorMessage).toBe(
			"A quantity in kg times one in g has no unit: mass times mass is not a unit. Lengths multiply into an area or a volume, and no other quantity squares into one.",
		);
		expect(refuseLikeProduct(uomValue(1, "kg"), uomValue(2, "m"))).toBeUndefined();
		expect(refuseLikeProduct(numberValue(1), uomValue(2, "mps2"))).toBeUndefined();
		expect(shown("gravity * gravity")).toContain("A quantity in m/s² times one in m/s²");
		expect(shown("prod(x * gravity, [1, 2])")).toContain("A quantity in m/s² times one in m/s²");
	});
});

describe("adversarial: security", () => {
	test.each(PROTOTYPE_WORDS.flatMap((word) => [`f(${word}) = ${word} * gravity`, `map(${word} * gravity, [1, 2])`, `solve(${word} = gravity, ${word})`]))("%s", (line) => {
		expectPrototypeUntouched(() => {
			expectHonestLine(line);
		});
	});

	test("a long body of constants and a deep bracket around one are answered in time", () => {
		expectHonestLine(`f(m) = ${Array.from({ length: 2_000 }, () => "m * gravity").join(" + ")}`, { budgetMs: 5_000 });
		expectHonestLine(`f(m) = m * ${"(".repeat(200)}gravity${")".repeat(200)}`, { budgetMs: 5_000 });
		expectHonestLine(`map(x * gravity, [${RESOURCE_PROBES.longSum(500).split(" + ").join(", ")}])`, { budgetMs: 5_000 });
		expectHonestDocument(RESOURCE_PROBES.manyLines(300, "f(m) = m * gravity"), { budgetMs: 10_000 });
	});

	test("a look-alike of gravity is a name, never the constant", () => {
		// A Cyrillic і inside the word.
		expect(shown("f(m) = m * gravіty")).toBe("f(m) defined");
		expect(both(["f(m) = m * gravіty", "f(2)"])[1]).not.toBe("19.61 m/s²");
		expectHonestDocument("f(m) = m * gravіty\nf(2)");
	});

	test.each(fill("f(m) = m * gravity X", TEXT_EDGES.filter((t) => t.trim() !== "")))("a text edge after the body: %j", (line) => {
		expectHonestLine(line);
	});

	test("markup-shaped text around the body is read as text", () => {
		expectHonestLine("<b>f(m) = m * gravity</b>");
		expectHonestLine("map(x * gravity, [1, 2])<script>");
	});
});

describe("adversarial: realistic breakage", () => {
	test("a typo of the constant is an unknown, never gravity", () => {
		expect(both(["f(m) = m * gravty", "f(2)"])[1]).not.toBe("19.61 m/s²");
		expectHonestDocument("f(m) = m * gravty\nf(2)");
	});

	test("a unit that does not fit is refused by name", () => {
		const lines = both(["f(m) = m * gravity", "f(2 kg) in km"]);
		expect(lines[0]).toBe("f(m) defined");
		expect(lines[1]).toBe("a force cannot be converted to a length");
		expectHonestDocument("f(m) = m * gravity\nf(2 kg) in km\nf(gravity)");
	});

	test("the constant from the line above, a what-if and a check through it", () => {
		expect(both(["g = gravity", "f(m) = m * g", "f(2)"])[2]).toBe("19.61 m/s²");
		expectHonestDocument("f(m) = m * gravity\nw = f(70 kg) as N\nline 2 with m = 3 kg\ncheck w > 600 N");
	});

	test("an edit to the body, and a snapshot round trip", () => {
		const engine = newTrackedEngine();
		engine.parseDocument("f(m) = m * gravity\nf(2)");
		const edited = engine.parseDocument("f(m) = m * gravity * 2\nf(2)").lines.map(read);
		expect(edited).toEqual(["f(m) defined", "39.23 m/s²"]);
		const restored = ExpressionEngine.fromJSON(JSON.parse(JSON.stringify(engine.toJSON())), { packages: BUILTIN_PACKAGES });
		try {
			expect(restored.parseDocument("f(m) = m * gravity\nf(3)").lines.map(read)).toEqual(["f(m) defined", "29.42 m/s²"]);
		} finally {
			restored.clear();
		}
	});

	test("the mathematical constants are as before", () => {
		expect(both(["f(x) = x * tau", "f(2)"])).toEqual(["f(x) defined", "12.57"]);
		expect(shown("solve(x^2 = tau, x)")).toBe("[-2.51, 2.51]");
	});
});

describe("adversarial: edge cases", () => {
	test.each(NUMERIC_EDGES)("a numeric edge through a body over gravity: %s", (edge) => {
		expectHonestDocument(`f(m) = m * gravity\nf(${edge})`, { allowNaN: edge.includes("0/0") });
	});

	test.each(fill("map(x * gravity, [X])", NUMERIC_EDGES))("a numeric edge in a map over gravity: %s", (line) => {
		expectHonestLine(line, { allowNaN: line.includes("0/0") });
	});

	test("zero, negative zero and a negative", () => {
		expect(both(["f(m) = m * gravity", "f(0)", "f(-0)", "f(-1)"]).slice(1)).toEqual(["0.00 m/s²", "0.00 m/s²", "-9.81 m/s²"]);
	});

	test("a CRLF line and a trailing newline through both passes", () => {
		expect(both(["f(m) = m * gravity\r", "f(2)\r", ""]).slice(0, 2)).toEqual(["f(m) defined", "19.61 m/s²"]);
	});
});
