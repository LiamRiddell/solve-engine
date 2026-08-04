import { describe, expect, test } from "@jest/globals";
import { tokenTypeName } from "@solve-js/lexer/Token";
import { getOpCodeName } from "@solve-js/parser/OpCode";
import { newTrackedEngine } from "@tools/trackedEngine";
import { EXAMPLES } from "../../../../docs/src/data/pipelineStages";

/**
 * Holds the animated pipeline walkthrough to what the pipeline actually does.
 *
 * The walkthrough on the architecture page shows tokens, a rewritten token
 * stream, an instruction listing, two constant pools and a stack, for three
 * expressions. All of it is authored data rather than a live engine, because
 * an architecture page should not have to load a megabyte of runtime to draw a
 * diagram.
 *
 * That trade is only acceptable if the data cannot quietly stop being true.
 * This re-derives every field from the real engine, so a change to the lexer's
 * token names, to a normaliser rule, to the opcode set or to constant pooling
 * fails here rather than shipping a diagram that describes an engine nobody is
 * running any more.
 */

/** Strips the prefix `tokenTypeName` adds for types with no registered name. */
function typeName(type: unknown): string {
  return String(tokenTypeName(type as never)).replace(/^UNKNOWN_/, "");
}

/** Disassembles a program into the same shape the walkthrough lists. */
function disassemble(program: {
  opcodes: Uint8Array;
  numbers: Float64Array;
  strings: string[];
}): Array<{ op: string; operand?: number }> {
  const out: Array<{ op: string; operand?: number }> = [];
  for (let i = 0; i < program.opcodes.length; i++) {
    const op = getOpCodeName(program.opcodes[i]);
    if (/^(PUSH_|LOAD_|CALL)/.test(op)) {
      out.push({ op, operand: program.opcodes[i + 1] });
      i++;
    } else {
      out.push({ op });
    }
  }
  return out;
}

describe("pipeline walkthrough data matches the engine", () => {
  for (const example of EXAMPLES) {
    describe(example.expression, () => {
      test("lexed tokens are what the lexer produces", () => {
        const engine = newTrackedEngine();
        // Reaching past the public surface on purpose: the walkthrough shows
        // the token stream BEFORE normalisation, which nothing public exposes.
        // A test is the right place to depend on an internal, since it fails
        // loudly rather than shipping.
        const inner = engine as unknown as {
          lexToTokens: (text: string) => { tokens: Array<{ type: unknown; value: string; offset: number }> };
        };
        const { tokens } = inner.lexToTokens(example.expression);

        expect(
          tokens.map((token) => ({
            text: token.value,
            type: typeName(token.type),
            from: token.offset,
            to: token.offset + token.value.length,
          })),
        ).toEqual(example.lexed);
      });

      test("normalised tokens are what the normaliser produces", () => {
        const engine = newTrackedEngine();
        const inner = engine as unknown as {
          lexToTokens: (text: string) => { tokens: unknown[]; hasParens: boolean };
          prepareExpression: (
            text: string,
            tokens: unknown[],
            hasParens: boolean,
          ) => { normalizedTokens?: Array<{ type: unknown; value: string }> };
        };
        const { tokens, hasParens } = inner.lexToTokens(example.expression);
        const prepared = inner.prepareExpression(example.expression, tokens, hasParens);

        expect(
          (prepared.normalizedTokens ?? []).map((token) => ({
            text: token.value,
            type: typeName(token.type),
          })),
        ).toEqual(
          example.normalised.map((token) => ({ text: token.text, type: token.type })),
        );
      });

      test("the instruction listing and both pools match the compiled program", () => {
        const engine = newTrackedEngine();
        const { program } = engine.compileExpression(example.expression);

        expect(disassemble(program)).toEqual(
          example.code.map((instruction) =>
            instruction.operand === undefined
              ? { op: instruction.op }
              : { op: instruction.op, operand: instruction.operand },
          ),
        );
        expect(Array.from(program.numbers)).toEqual(example.numbers);
        expect(program.strings).toEqual(example.strings);
      });

      test("the execution steps list every instruction, in order", () => {
        const listed = example.code.map((instruction) =>
          instruction.operand === undefined
            ? instruction.op
            : `${instruction.op} ${instruction.operand}`,
        );
        expect(example.steps.map((step) => step.instruction)).toEqual(listed);
      });

      test("each step leaves the stack the depth the instruction implies", () => {
        // A push adds one cell, a binary operation removes one, and the run
        // ends with exactly one value: the answer. Getting this wrong is the
        // easiest way for a hand-written stack to look plausible and be wrong.
        let depth = 0;
        for (const [index, step] of example.steps.entries()) {
          const op = example.code[index].op;
          depth += /^(PUSH_|LOAD_)/.test(op) ? 1 : -1;
          expect(step.stack).toHaveLength(depth);
        }
        expect(depth).toBe(1);
      });

      test("the answer is what the engine returns", () => {
        const engine = newTrackedEngine();
        const line = engine.parseDocument(example.expression, { inputType: "plain" }).lines[0];
        const result = line.result as { value: number; unit?: string } | null;

        expect(result).not.toBeNull();
        const rendered =
          result?.unit === undefined ? `${result?.value}` : `${result?.value} ${result.unit}`;
        expect(rendered).toBe(example.answer);

        // The final stack cell is the answer, which is the one place the
        // hand-written execution trace and the real engine have to agree.
        expect(example.steps[example.steps.length - 1].stack).toEqual([example.answer]);
      });
    });
  }
});
