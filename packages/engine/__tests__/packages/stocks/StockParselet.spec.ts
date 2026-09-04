import { describe, expect, test } from "@jest/globals";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { stockFnParselet, bareStockTickerParselet } from "@solve-js/packages/stocks/parselets/StockParselet";
import { STOCK_TICKER_TYPE } from "@solve-js/packages/stocks/normalizer/StockTickerNormalizerRule";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { DATE_CALENDAR } from "@solve-js/calendar/DateCalendar";

// The parselets emit their plugin calls by NAME (builder.emitPluginCall), and
// StocksPackage.ts keys pluginFunctions by these names under the package name
// "solve-stocks". The engine assigns each an index at registration; recover the
// same index here so a hand-built builder's emitted operand matches the engine's.
const PACKAGE_NAME = "solve-stocks";
const CURRENT_FN = "stock";
const HISTORICAL_FN = "stockhistorical";
const CURRENT_FN_IDX = pluginFunctionIndexFor(`${PACKAGE_NAME}:${CURRENT_FN}`);
const HISTORICAL_FN_IDX = pluginFunctionIndexFor(`${PACKAGE_NAME}:${HISTORICAL_FN}`);

// A parselet driven directly in a unit test builds its own BytecodeBuilder
// without an engine, so it needs this name->index map for emitPluginCall to
// resolve the way the engine's own map does at registration.
const STOCK_INDEX_MAP = new Map<string, number>([
	[CURRENT_FN, CURRENT_FN_IDX],
	[HISTORICAL_FN, HISTORICAL_FN_IDX],
]);

function tok(type: string, value: string): Token {
	return { type, typeId: 0, value, text: value, offset: 0, lineBreaks: 0, line: 1, col: 1 } as Token;
}
const LPAREN = () => tok("LPAREN", "(");
const RPAREN = () => tok("RPAREN", ")");
const IDENT = (v: string) => tok("IDENT", v);
const STRING = (v: string) => tok("STRING", `"${v}"`);
const NUMBER = (v: string) => tok("NUMBER", v);
const COMMA = () => tok("COMMA", ",");
const STOCK_TICKER = (v: string) => tok(STOCK_TICKER_TYPE, v);

function mockParser(tokens: Token[]) {
	const queue = [...tokens];
	return {
		// The date phrase reads its calendar backend off the parser, as a parselet does.
		getCalendar: () => DATE_CALENDAR,
		peek: () => (queue.length > 0 ? queue[0] : undefined),
		consume: (expected?: string) => {
			const t = queue.shift();
			if (!t) throw new Error("Unexpected end of input");
			if (expected && t.type !== expected) {
				throw new Error(`Expected token type "${expected}" but got "${t.type}" ("${t.value}")`);
			}
			return t;
		},
	} as any;
}

function opcodesAndStrings(builder: BytecodeBuilder) {
	const program = builder.build();
	return { opcodes: Array.from(program.opcodes), strings: program.strings };
}

describe("stockFnParselet — stock(TICKER) function-call form", () => {
	test("stock(AAPL) — bare identifier ticker, current price", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		parselet.parse(mockParser([LPAREN(), IDENT("AAPL"), RPAREN()]), tok("STOCK_FN", "stock"), builder);

		const { opcodes, strings } = opcodesAndStrings(builder);
		expect(opcodes[0]).toBe(OpCode.PUSH_STRING);
		expect(opcodes[2]).toBe(OpCode.CALL_PLUGIN);
		expect(opcodes[3]).toBe(CURRENT_FN_IDX);
		expect(opcodes[4]).toBe(1);
		expect(strings[0]).toBe("AAPL");
	});

	test('stock("AAPL") — quoted ticker, stripped of quotes', () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		parselet.parse(mockParser([LPAREN(), STRING("AAPL"), RPAREN()]), tok("STOCK_FN", "stock"), builder);
		const { strings } = opcodesAndStrings(builder);
		expect(strings[0]).toBe("AAPL");
	});

	test("stock(aapl) — lowercase input is upper-cased", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		parselet.parse(mockParser([LPAREN(), IDENT("aapl"), RPAREN()]), tok("STOCK_FN", "stock"), builder);
		const { strings } = opcodesAndStrings(builder);
		expect(strings[0]).toBe("AAPL");
	});

	test("accepts a fused STOCK_TICKER token inside the parens too", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		parselet.parse(mockParser([LPAREN(), STOCK_TICKER("MSFT"), RPAREN()]), tok("STOCK_FN", "stock"), builder);
		const { strings } = opcodesAndStrings(builder);
		expect(strings[0]).toBe("MSFT");
	});

	test("throws for a non-ticker argument (e.g. a bare number)", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		expect(() =>
			parselet.parse(mockParser([LPAREN(), NUMBER("123"), RPAREN()]), tok("STOCK_FN", "stock"), builder),
		).toThrow(/Expected a ticker symbol/);
	});

	test("stock(AAPL) on April 12, 2005 — defaults to 'close' field, routes to the HISTORICAL fn index", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		const tokens = [
			LPAREN(), IDENT("AAPL"), RPAREN(),
			IDENT("on"), IDENT("April"), NUMBER("12"), COMMA(), NUMBER("2005"),
		];
		parselet.parse(mockParser(tokens), tok("STOCK_FN", "stock"), builder);

		const { opcodes, strings } = opcodesAndStrings(builder);
		expect(opcodes[3]).toBe(HISTORICAL_FN_IDX);
		expect(strings[0]).toBe("close:AAPL:2005-04-12");
	});

	test("stock(AAPL) close on <date> — explicit 'close' field", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		const tokens = [
			LPAREN(), IDENT("AAPL"), RPAREN(),
			IDENT("close"), IDENT("on"), IDENT("April"), NUMBER("12"), COMMA(), NUMBER("2005"),
		];
		parselet.parse(mockParser(tokens), tok("STOCK_FN", "stock"), builder);
		const { strings } = opcodesAndStrings(builder);
		expect(strings[0]).toBe("close:AAPL:2005-04-12");
	});

	test("stock(AAPL) volume on <date> — 'volume' field", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		const tokens = [
			LPAREN(), IDENT("AAPL"), RPAREN(),
			IDENT("volume"), IDENT("on"), IDENT("April"), NUMBER("12"), COMMA(), NUMBER("2005"),
		];
		parselet.parse(mockParser(tokens), tok("STOCK_FN", "stock"), builder);
		const { opcodes, strings } = opcodesAndStrings(builder);
		expect(opcodes[3]).toBe(HISTORICAL_FN_IDX);
		expect(strings[0]).toBe("volume:AAPL:2005-04-12");
	});

	test("throws when 'close'/'volume' isn't followed by 'on'", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		const tokens = [LPAREN(), IDENT("AAPL"), RPAREN(), IDENT("close"), IDENT("banana")];
		expect(() => parselet.parse(mockParser(tokens), tok("STOCK_FN", "stock"), builder)).toThrow(/Expected "on <date>"/);
	});

	test("throws when 'on' isn't followed by a parseable date", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		const tokens = [LPAREN(), IDENT("AAPL"), RPAREN(), IDENT("on"), IDENT("banana")];
		expect(() => parselet.parse(mockParser(tokens), tok("STOCK_FN", "stock"), builder)).toThrow(/Expected a date/);
	});

	test("no suffix at all — stock(AAPL) alone is complete", () => {
		const parselet = stockFnParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		parselet.parse(mockParser([LPAREN(), IDENT("AAPL"), RPAREN()]), tok("STOCK_FN", "stock"), builder);
		const { opcodes, strings } = opcodesAndStrings(builder);
		expect(opcodes[3]).toBe(CURRENT_FN_IDX);
		expect(strings[0]).toBe("AAPL");
	});
});

describe("bareStockTickerParselet — opt-in bare-ticker stretch-goal form", () => {
	test("AAPL alone -> current price query", () => {
		const parselet = bareStockTickerParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		parselet.parse(mockParser([]), STOCK_TICKER("AAPL"), builder);
		const { opcodes, strings } = opcodesAndStrings(builder);
		expect(opcodes[3]).toBe(CURRENT_FN_IDX);
		expect(strings[0]).toBe("AAPL");
	});

	test("AAPL on April 12, 2005 -> historical query", () => {
		const parselet = bareStockTickerParselet(CURRENT_FN, HISTORICAL_FN);
		const builder = new BytecodeBuilder(STOCK_INDEX_MAP);
		const tokens = [IDENT("on"), IDENT("April"), NUMBER("12"), COMMA(), NUMBER("2005")];
		parselet.parse(mockParser(tokens), STOCK_TICKER("AAPL"), builder);
		const { opcodes, strings } = opcodesAndStrings(builder);
		expect(opcodes[3]).toBe(HISTORICAL_FN_IDX);
		expect(strings[0]).toBe("close:AAPL:2005-04-12");
	});

	test("category is Stocks for both parselets", () => {
		expect(stockFnParselet(CURRENT_FN, HISTORICAL_FN).category).toBe("Stocks");
		expect(bareStockTickerParselet(CURRENT_FN, HISTORICAL_FN).category).toBe("Stocks");
	});
});
