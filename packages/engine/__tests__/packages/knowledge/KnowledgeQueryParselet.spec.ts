import { describe, expect, test } from "@jest/globals";
import { LexerToken } from "@solve-js/lexer/ExpressionLexer";
import { tokenTypeId } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { pluginFunctionIndexFor } from "@solve-js/vm/VMBuiltins";
import { knowledgeQueryParselet } from "@solve-js/packages/knowledge/parselets/KnowledgeQueryParselet";

// The parselet now emits its plugin call by NAME (see KnowledgePackage.ts:
// packageName "solve-knowledge", function name "knowledge"). The engine files
// the function under `${pkg.name}:${name}` and assigns its CALL_PLUGIN index by
// that qualified name; pluginFunctionIndexFor resolves the same, stable index.
const KNOWLEDGE_FN = "knowledge";
const KNOWLEDGE_FN_IDX = pluginFunctionIndexFor("solve-knowledge:knowledge");

// A parselet driven directly in a unit test builds its own BytecodeBuilder
// without an engine, so it needs this name→index map for emitPluginCall to
// resolve the function the way the engine's own map does at registration.
const KNOWLEDGE_INDEX_MAP = new Map<string, number>([[KNOWLEDGE_FN, KNOWLEDGE_FN_IDX]]);

describe("knowledgeQueryParselet", () => {
	test("compiles the KNOWLEDGE_QUERY token's value directly to PUSH_STRING + CALL_PLUGIN", () => {
		const parselet = knowledgeQueryParselet(KNOWLEDGE_FN);
		const builder = new BytecodeBuilder(KNOWLEDGE_INDEX_MAP);
		const token = new LexerToken(
			"KNOWLEDGE_QUERY", tokenTypeId("KNOWLEDGE_QUERY"),
			"distance to the moon", "distance to the moon", 0, 0, 1, 1,
		);

		// The parser is never touched — the token already carries the full
		// query, extracted at the lexer's rawLinePatterns layer.
		parselet.parse({} as any, token, builder);

		const program = builder.build();
		const opcodes = Array.from(program.opcodes);
		expect(opcodes[0]).toBe(OpCode.PUSH_STRING);
		expect(opcodes[2]).toBe(OpCode.CALL_PLUGIN);
		expect(opcodes[3]).toBe(KNOWLEDGE_FN_IDX);
		expect(opcodes[4]).toBe(1);
		expect(program.strings[0]).toBe("distance to the moon");
	});

	test("category is Knowledge", () => {
		expect(knowledgeQueryParselet(KNOWLEDGE_FN).category).toBe("Knowledge");
	});
});
