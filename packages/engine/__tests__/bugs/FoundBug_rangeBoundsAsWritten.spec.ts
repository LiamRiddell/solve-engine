import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import {
	NUMERIC_EDGES,
	PROTOTYPE_WORDS,
	RESOURCE_PROBES,
	TEXT_EDGES,
	evaluateLine,
	expectHonestDocument,
	expectHonestLine,
	expectPrototypeUntouched,
	fill,
} from "@tools/adversarial";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import { QUOTE_LIMIT } from "@solve-js/engine/ColonLabel";
import { formatValue } from "@solve-js/format/FormatEngine";
import { EngineError } from "@solve-js/errors/EngineError";
import { Lexer } from "@solve-js/lexer/Lexer";
import type { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { OPERAND_BYTES } from "@solve-js/parser/OperandWidth";
import { PrecedenceParser } from "@solve-js/parser/PrecedenceParser";
import { ParseletRegistry } from "@solve-js/parser/registry/ParseletRegistry";
import { MAX_WRITTEN_TOKENS, emitRange, isPlainNumber, tokensBack } from "@solve-js/packages/mapreduce/MapReduceShared";
import { boundAsWritten, descendingRangeMessage } from "@solve-js/vm/RangeBounds";
import { createVM, executeBytecode } from "@solve-js/vm/VM";
import { OpRegistry } from "@solve-js/vm/OpRegistry";

/**
 * Found bug: a range that counts down was refused with the numbers its bounds
 * came to, not the bounds the reader wrote.
 *
 * In `total(1 + 24:00)` the colon is a range's (the list `sum`, `total`,
 * `prod`, `map` and `reduce` work through reads a colon as a range by design),
 * so its bounds are `1 + 24` and `00`. The refusal said "A range's min (25)
 * cannot be greater than its max (0)", two numbers the reader never typed.
 *
 * The parser now keeps each side's text beside a range whose sides are more
 * than plain numbers (`RANGE_NEW_WRITTEN`), and the refusal quotes it with the
 * number it came to (vm/RangeBounds.ts). A range of two plain numbers
 * (`sum(5:1)`) compiles and reads as before.
 */

/** One line through evaluateExpression: its code and message, or its answer. */
function outcome(line: string): string {
	const o = evaluateLine(line);
	if (o.kind === "value") return o.text.replace(/^=\s*/, "");
	if (o.kind === "crashed") return `CRASHED ${o.name}`;
	return `${o.code}: ${o.message}`;
}

/** One line through the single-line entry point `evaluateLine`. */
function single(line: string): string {
	let value;
	try {
		value = newTrackedEngine().evaluateLine(1, line);
	} catch (error) {
		if (error instanceof EngineError) return `${error.code}: ${error.message}`;
		throw error;
	}
	return value.isError() ? `${String(value.errorCode)}: ${String(value.errorMessage)}` : formatValue(value).replace(/^=\s*/, "");
}

type DocumentResult = ReturnType<ReturnType<typeof newTrackedEngine>["parseDocument"]>;

/** Both document passes, each line's message or answer. */
function both(text: string): { batch: string[]; incremental: string[] } {
	const lines = (result: DocumentResult): string[] =>
		result.lines.map((l) => {
			if (l.result == null) return l.error ? `ERROR ${String(l.errorCode)}` : "";
			if (l.result.isError()) return `ERROR ${String(l.result.errorMessage)}`;
			return formatValue(l.result).replace(/^=\s*/, "");
		});
	return { batch: lines(newTrackedEngine().parseDocument(text)), incremental: lines(evaluateDocument(newTrackedEngine(), text)) };
}

/** The lexer's tokens for a line. */
function lex(source: string): Token[] {
	const lexer = new Lexer("en");
	lexer.reset(source);
	return Array.from(lexer).filter((t) => t.type !== "WS" && t.type !== "NEWLINE" && !t.type.startsWith("MD_"));
}

/** A bare parser loaded with a line's tokens, moved past the first `consumed` of them. */
function parserAt(source: string, consumed: number): { parser: PrecedenceParser; list: Token[] } {
	const parser = new PrecedenceParser(new ParseletRegistry(), 50, "en");
	const list = lex(source);
	parser.load(list, false);
	for (let k = 0; k < consumed; k++) parser.consume();
	return { parser, list };
}

/** What emitRange writes for two sides: the opcode and the pooled texts. */
function emitted(minSide: Token[] | null, maxSide: Token[] | null): { op: string; strings: string[] } {
	const builder = new BytecodeBuilder(new Map());
	emitRange(builder, minSide, maxSide);
	const program = builder.build();
	return { op: OpCode[program.opcodes[0]], strings: program.strings };
}

/** A hand-built stream through the VM: two numbers, then a range instruction. */
function run(opcodes: number[], numbers: number[], strings: string[]) {
	return executeBytecode({ opcodes: new Uint8Array(opcodes), numbers: new Float64Array(numbers), strings }, createVM(new OpRegistry()));
}

const MIN_25 = 'DESCENDING_RANGE: A range\'s min (1 + 24, which is 25) cannot be greater than its max (00, which is 0). Did you mean "0:25"?';

describe("the lines that exposed it", () => {
	test("total(1 + 24:00) names its bounds as written, with the numbers they came to", () => {
		expect(outcome("total(1 + 24:00)")).toBe(MIN_25);
		expect(outcome("sum(1+24:00)")).toBe('DESCENDING_RANGE: A range\'s min (1+24, which is 25) cannot be greater than its max (00, which is 0). Did you mean "0:25"?');
		expect(outcome("total(2*3:1)")).toBe('DESCENDING_RANGE: A range\'s min (2*3, which is 6) cannot be greater than its max (1). Did you mean "1:6"?');
	});

	test("a range of two plain numbers reads as it did, and an ascending one is added up", () => {
		expect(outcome("sum(5:1)")).toBe('DESCENDING_RANGE: A range\'s min (5) cannot be greater than its max (1). Did you mean "1:5"?');
		expect(outcome("sum(3:1)")).toBe('DESCENDING_RANGE: A range\'s min (3) cannot be greater than its max (1). Did you mean "1:3"?');
		expect(outcome("sum(1:3)")).toBe("6");
		expect(outcome("total(1 + 2:2*3)")).toBe("18");
		expect(outcome("sum(1.5:3)")).toBe('NON_INTEGER_RANGE_BOUND: A range\'s bounds must be whole numbers, got "1.5:3".');
	});

	test("every place a range is written: the element form, map, reduce and a list slice", () => {
		expect(outcome("sum(x, 2*3:1)")).toMatch(/^DESCENDING_RANGE: A range's min \(2\*3, which is 6\)/);
		expect(outcome("map(10*x, 10:2*1)")).toMatch(/its max \(2\*1, which is 2\)\. Did you mean "2:10"\?$/);
		expect(outcome("reduce(acc+x, 3:-1)")).toMatch(/^DESCENDING_RANGE: A range's min \(3\) cannot be greater than its max \(-1\)/);
		expect(outcome("[1,2,3;4,5,6][1+1:1, 1]")).toMatch(/^DESCENDING_RANGE: A range's min \(1\+1, which is 2\)/);
		expect(outcome("[1,2,3;4,5,6][2:1, 1]")).toBe('DESCENDING_RANGE: A range\'s min (2) cannot be greater than its max (1). Did you mean "1:2"?');
	});
});

describe("through every entry point", () => {
	test("the single-line evaluateLine gives the same refusal", () => {
		expect(single("total(1 + 24:00)")).toBe(MIN_25);
		expect(single("sum(5:1)")).toBe('DESCENDING_RANGE: A range\'s min (5) cannot be greater than its max (1). Did you mean "1:5"?');
	});

	test("parseDocument and evaluateDocument name a bound read from a line above, and agree", () => {
		const { batch, incremental } = both("x = 5\nsum(x:1)\ntotal(x + 1:x)\nsum(1:x)");
		expect(batch).toEqual([
			"5",
			'ERROR A range\'s min (x, which is 5) cannot be greater than its max (1). Did you mean "1:5"?',
			'ERROR A range\'s min (x + 1, which is 6) cannot be greater than its max (x, which is 5). Did you mean "5:6"?',
			"15",
		]);
		expect(incremental).toEqual(batch);
	});
});

// ── The parts ──────────────────────────────────────────────────────────────

describe("boundAsWritten", () => {
	test("ordinary: the number alone when written that way, the text and the number otherwise", () => {
		expect(boundAsWritten("5", 5)).toBe("5");
		expect(boundAsWritten("-1", -1)).toBe("-1");
		expect(boundAsWritten("1 + 24", 25)).toBe("1 + 24, which is 25");
		expect(boundAsWritten("00", 0)).toBe("00, which is 0");
		expect(boundAsWritten("x", 5)).toBe("x, which is 5");
	});

	test("boundary: no text kept, or only spaces, gives the number", () => {
		expect(boundAsWritten("", 25)).toBe("25");
		expect(boundAsWritten("   ", 25)).toBe("25");
		expect(boundAsWritten(" 5 ", 5)).toBe("5");
	});

	test("hostile: a long side is shortened, prototype words and markup are text", () => {
		const long = "a".repeat(QUOTE_LIMIT + 10);
		expect(boundAsWritten(long, 1)).toBe(`${"a".repeat(QUOTE_LIMIT)}..., which is 1`);
		for (const word of PROTOTYPE_WORDS) expect(boundAsWritten(word, 3)).toBe(`${word}, which is 3`);
		expect(boundAsWritten("<script>", 3)).toBe("<script>, which is 3");
		expect(boundAsWritten("NaN", NaN)).toBe("NaN");
	});
});

describe("descendingRangeMessage", () => {
	test("with and without the written sides", () => {
		expect(descendingRangeMessage(5, 1)).toBe('A range\'s min (5) cannot be greater than its max (1). Did you mean "1:5"?');
		expect(descendingRangeMessage(25, 0, "1 + 24", "00")).toBe(MIN_25.replace(/^DESCENDING_RANGE: /, ""));
		expect(descendingRangeMessage(0, -0, "0", "-0")).toBe('A range\'s min (0) cannot be greater than its max (-0, which is 0). Did you mean "0:0"?');
	});
});

describe("isPlainNumber", () => {
	test("one whole number written plainly, and nothing else", () => {
		expect(isPlainNumber(lex("5"))).toBe(true);
		expect(isPlainNumber(lex("0"))).toBe(true);
		expect(isPlainNumber(lex("24"))).toBe(true);
		expect(isPlainNumber(lex("00"))).toBe(false);
		expect(isPlainNumber(lex("05"))).toBe(false);
		expect(isPlainNumber(lex("5.0"))).toBe(false);
		expect(isPlainNumber(lex("1e3"))).toBe(false);
		expect(isPlainNumber(lex("1 + 2"))).toBe(false);
		expect(isPlainNumber(lex("x"))).toBe(false);
		expect(isPlainNumber([])).toBe(false);
		expect(isPlainNumber(null)).toBe(false);
	});
});

describe("tokensBack", () => {
	test("ordinary: the side's tokens in line order, read back to its first token", () => {
		const { parser, list } = parserAt("1 + 24 : 00", 3);
		expect(tokensBack(parser, list[0], 1)?.map((t) => t.text)).toEqual(["1", "+", "24"]);
		parser.consume();
		expect(tokensBack(parser, list[0], 2)?.map((t) => t.text)).toEqual(["1", "+", "24"]);
	});

	test("boundary: no first token, a first token not behind the parser, or nothing consumed", () => {
		const { parser, list } = parserAt("1 + 24", 3);
		expect(tokensBack(parser, undefined, 1)).toBeNull();
		expect(tokensBack(parser, lex("9")[0], 1)).toBeNull();
		const fresh = parserAt("1", 0);
		expect(tokensBack(fresh.parser, fresh.list[0], 1)).toBeNull();
		expect(tokensBack(parser, list[2], 1)?.map((t) => t.text)).toEqual(["24"]);
	});

	test("hostile: a side longer than the limit is not kept, and the walk stops there", () => {
		const terms = MAX_WRITTEN_TOKENS;
		const { parser, list } = parserAt(Array.from({ length: terms }, () => "1").join(" + "), terms * 2 - 1);
		expect(tokensBack(parser, list[0], 1)).toBeNull();
		const short = parserAt(Array.from({ length: terms / 2 }, () => "1").join(" + "), terms - 1);
		expect(tokensBack(short.parser, short.list[0], 1)?.length).toBe(terms - 1);
	});
});

describe("emitRange", () => {
	test("plain numbers keep RANGE_NEW; anything else carries both sides' text", () => {
		expect(emitted(lex("1"), lex("5"))).toEqual({ op: "RANGE_NEW", strings: [] });
		expect(emitted(lex("1 + 24"), lex("00"))).toEqual({ op: "RANGE_NEW_WRITTEN", strings: ["1 + 24", "00"] });
		expect(emitted(lex("x"), lex("1"))).toEqual({ op: "RANGE_NEW_WRITTEN", strings: ["x", "1"] });
		// A side not kept is written as no text, which the refusal reads as "use the number".
		expect(emitted(null, lex("1"))).toEqual({ op: "RANGE_NEW_WRITTEN", strings: ["", "1"] });
		expect(emitted(null, null)).toEqual({ op: "RANGE_NEW_WRITTEN", strings: [""] });
	});

	test("RANGE_NEW_WRITTEN takes two operands, and the VM reads them", () => {
		expect(OPERAND_BYTES[OpCode.RANGE_NEW_WRITTEN]).toBe(2);
		const refused = run([OpCode.PUSH_NUMBER, 0, OpCode.PUSH_NUMBER, 1, OpCode.RANGE_NEW_WRITTEN, 0, 1, OpCode.HALT], [25, 0], ["1 + 24", "00"]);
		expect(refused.type).toBe("value");
		if (refused.type !== "value") return;
		expect(refused.value.isError()).toBe(true);
		expect(refused.value.errorMessage).toBe(MIN_25.replace(/^DESCENDING_RANGE: /, ""));
		const built = run([OpCode.PUSH_NUMBER, 0, OpCode.PUSH_NUMBER, 1, OpCode.RANGE_NEW_WRITTEN, 0, 1, OpCode.HALT], [1, 3], ["1", "x"]);
		expect(built.type).toBe("value");
	});

	test("hostile: a string index past the pool is refused as malformed bytecode, not a crash", () => {
		const result = run([OpCode.PUSH_NUMBER, 0, OpCode.PUSH_NUMBER, 1, OpCode.RANGE_NEW_WRITTEN, 0, 9, OpCode.HALT], [5, 1], ["x"]);
		expect(result.type).toBe("error");
		if (result.type !== "error") return;
		expect(result.error.code).toBe("MALFORMED_BYTECODE_CONSTANT_INDEX");
	});
});

// ── Adversarial ───────────────────────────────────────────────────────────

describe("adversarial", () => {
	test("security: prototype words as bounds, sized input, look-alike characters and markup", () => {
		expectPrototypeUntouched(() => {
			for (const word of PROTOTYPE_WORDS) {
				const { batch, incremental } = both(`${word} = 5\nsum(${word}:1)`);
				expect(batch[1]).toBe(`ERROR A range's min (${word}, which is 5) cannot be greater than its max (1). Did you mean "1:5"?`);
				expect(incremental).toEqual(batch);
				expectHonestLine(`sum(${word}:1)`);
			}
		});
		// A side too long to keep, and one long enough to shorten.
		const long = Array.from({ length: 200 }, () => "1").join(" + ");
		expect(outcome(`sum(${long}:1)`)).toBe('DESCENDING_RANGE: A range\'s min (200) cannot be greater than its max (1). Did you mean "1:200"?');
		expect(outcome(`sum(${Array.from({ length: 20 }, () => "1").join(" + ")}:1)`)).toMatch(/^DESCENDING_RANGE: A range's min \(1 \+ 1 \+ 1 .{20,}\.\.\., which is 20\)/);
		expectHonestLine(`total(${RESOURCE_PROBES.longSum(2_000)}:0)`, { budgetMs: 5_000 });
		expectHonestLine(`sum(${RESOURCE_PROBES.hugeRange()})`, { budgetMs: 5_000 });
		expectHonestLine(`sum(${"(".repeat(200)}5${")".repeat(200)}:1)`, { budgetMs: 5_000 });
		// Many ranges on one line each keep their text in the pool, and stay honest.
		expectHonestLine(Array.from({ length: 150 }, (_, k) => `sum(${k}+1:${k})`).join(" + "), { budgetMs: 5_000 });
		// Digits from another script, a fullwidth colon, a zero-width space,
		// a direction override and markup: each is honest.
		for (const line of ["sum(٥:1)", "sum(5：1)", "sum(5​:1)", "‮sum(5:1)", 'sum("<b>":1)', "sum(<b>5</b>:1)"]) expectHonestLine(line);
		for (const line of fill("sum(X:1)", TEXT_EDGES)) expectHonestLine(line);
	});

	test("realistic: a bound from the line above, a typo, a check over it, a tag, a section and an edit", () => {
		const { batch, incremental } = expectHonestDocument("start = 10\nend = 2\nsum(start:end) #r\nsum(strat:end)\nsum(end:start)\ncheck line 5 > 50");
		expect(batch[2]).toBe('ERROR A range\'s min (start, which is 10) cannot be greater than its max (end, which is 2). Did you mean "2:10"?');
		expect(batch[3]).toMatch(/^ERROR /);
		expect(batch[4]).toBe("= 54");
		expect(batch[5]).toBe("= ✓");
		expect(incremental).toEqual(batch);
		const sectioned = both("# Ranges\nsum(2*3:1)\nsum(1:2*3)");
		expect(sectioned.batch.slice(1)).toEqual(['ERROR A range\'s min (2*3, which is 6) cannot be greater than its max (1). Did you mean "1:6"?', "21"]);
		expect(sectioned.incremental).toEqual(sectioned.batch);
		// The edit the suggestion names works.
		expect(outcome("total(00:1 + 24)")).toBe("325");
		// A time in a call that is not a range context is still read as a time.
		expect(outcome("max(1 + 24:00, 1)")).toBe('INVALID_TIME_LITERAL: "24:00" is not a valid time');
	});

	test("edge: zero and negative zero, negatives, 2^53, the largest doubles, quotients with no answer", () => {
		expect(outcome("sum(1 - 1:-1)")).toBe('DESCENDING_RANGE: A range\'s min (1 - 1, which is 0) cannot be greater than its max (-1). Did you mean "-1:0"?');
		expect(outcome("sum(-0:-1)")).toMatch(/^DESCENDING_RANGE: A range's min \(-0, which is 0\)/);
		expect(outcome("sum(2^53:1)")).toMatch(/^(DESCENDING_RANGE: A range's min \(2\^53, which is 9007199254740992\)|COLLECTION_TOO_LARGE)/);
		for (const line of fill("sum(X:1)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		for (const line of fill("sum(5:X)", NUMERIC_EDGES)) expectHonestLine(line, { allowNaN: true });
		const { batch, incremental } = both("a = 3\r\n\r\nsum(a:1)\r\n");
		expect(batch.slice(0, 3)).toEqual(["3", "", 'ERROR A range\'s min (a, which is 3) cannot be greater than its max (1). Did you mean "1:3"?']);
		expect(incremental).toEqual(batch);
	});
});
