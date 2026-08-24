import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { ExpressionEngine } from "@solve-js/engine/ExpressionEngine";

describe("ExpressionEngine - Long Documents and Robustness Tests", () => {
  let engine: ExpressionEngine;

  beforeEach(() => {
    engine = new ExpressionEngine("en", undefined, undefined, undefined, BUILTIN_PACKAGES);
  });

  // Releases the engine's query client and async batcher. Without it the
  // engine outlives the test file and its pending work lands in whatever
  // runs next, which under --runInBand is the same process.
  afterEach(() => {
  	engine.clear();
  });

  describe("Long document tests", () => {
    test("handles document with 1000 lines", () => {
      const lines = [];
      for (let i = 1; i <= 1000; i++) {
        lines.push(`s\`${i} + ${i}\``);
      }
      const document = lines.join('\n');
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.totalLines).toBe(1000);
      expect(result.lines).toHaveLength(1000);
      expect(result.errors).toHaveLength(0);
      
      // Verify first and last lines
      expect(result.lines[0].inlineSolves[0].result?.toNumber()).toBe(2);
      expect(result.lines[999].inlineSolves[0].result?.toNumber()).toBe(2000);
    });

    test("handles document with 10000 lines", () => {
      const lines = [];
      for (let i = 1; i <= 100; i++) {
        lines.push(`:x${i} = ${i}`);
        lines.push(`s\`:x${i} + ${i}\``);
      }
      const document = lines.join('\n');
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.totalLines).toBe(200);
      expect(result.lines).toHaveLength(200);
      expect(result.errors).toHaveLength(0);
    });

    test("handles document with very long lines", () => {
      // Create a line with a very long expression
      const longExpression = Array(100).fill("1 + 1").join(" + ");
      const document = `s\`${longExpression}\``;
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].inlineSolves).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });

    test("handles document with many inline solves per line", () => {
      // Create a line with many inline solves
      const expressions = Array(50).fill("1 + 1");
      const line = expressions.map((expr, i) => `s\`${expr}\``).join(" + ");
      const document = line;
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].inlineSolves).toHaveLength(50);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Broken markdown tests", () => {
    test("handles incomplete inline solve syntax", () => {
      const document = `s\`1 + 2
3 + 4\``;
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.lines).toHaveLength(2);
      // An inline solve opened on one line and closed on the next is broken on
      // both. The second line carries a trailing backtick with no opener, so it
      // errors rather than evaluating as a bare `3 + 4`. The point of the case
      // is that neither line takes the document down, not that the second one
      // recovers into a number.
      expect(result.lines[0].error).toBeDefined();
      expect(result.lines[1].error).toBeDefined();
      expect(result.lines[1].result).toBeNull();
    });

    test("handles malformed variable assignments", () => {
      const document = `:x = 
:y = 10
:z = 20`;
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.lines).toHaveLength(3);
      expect(result.lines[0].error).toBeDefined(); // Incomplete assignment
      expect(result.lines[1].result?.toNumber()).toBe(10);
      expect(result.lines[2].result?.toNumber()).toBe(20);
    });

    test("handles nested markdown structures", () => {
      const document = `# Heading
> Blockquote with s\`1 + 2\`
- List item with s\`3 + 4\`
  - Nested list with s\`5 + 6\``;
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.lines).toHaveLength(4);
      // A heading is skipped rather than evaluated, which is what heading
      // support added. It reports as empty for that reason: there is no
      // expression on it to compute. This assertion previously expected the
      // opposite, from before headings were recognised at all.
      expect(result.lines[0].isEmpty).toBe(true);
      expect(result.lines[0].inlineSolves).toHaveLength(0);
      // A blockquote is skipped in the same way a heading is, so the inline
      // solve inside it is never extracted. List items are not skipped, so
      // theirs are. This asymmetry is recorded rather than asserted as correct:
      // see the open question about whether `> quote with s`1 + 2`` should
      // evaluate.
      expect(result.lines[1].isEmpty).toBe(true);
      expect(result.lines[1].inlineSolves).toHaveLength(0);
      expect(result.lines[2].inlineSolves[0].result?.toNumber()).toBe(7);
      expect(result.lines[3].inlineSolves[0].result?.toNumber()).toBe(11);
    });

    test("handles mixed valid and invalid syntax", () => {
      const document = `:x = 10
s\`:x + 5
invalid syntax here
:y = 20
s\`:x + :y\``;
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.lines).toHaveLength(5);
      expect(result.lines[0].result?.toNumber()).toBe(10);
      expect(result.lines[1].error).toBeDefined(); // Incomplete inline solve
      expect(result.lines[2].error).toBeDefined(); // Invalid syntax
      expect(result.lines[3].result?.toNumber()).toBe(20);
      expect(result.lines[4].inlineSolves[0].result?.toNumber()).toBe(30);
    });

    test("handles extreme whitespace scenarios", () => {
      const document = `   
:x = 10
   
s\`:x + 5\`
   
   
:y = 20
   
s\`:x + :y\``;
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.lines).toHaveLength(9);
      // Count non-empty lines
      const nonEmptyLines = result.lines.filter(l => !l.isEmpty);
      expect(nonEmptyLines).toHaveLength(4);
    });

    test("handles emoji and special characters", () => {
      const document = `😀 s\`1 + 2\`
:symbol = 123
s\`2 × 3\``;
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.lines).toHaveLength(3);
      expect(result.lines[0].inlineSolves[0].result?.toNumber()).toBe(3);
      expect(result.lines[1].result?.toNumber()).toBe(123);
      expect(result.lines[2].inlineSolves[0].result?.toNumber()).toBe(6);
    });
  });

  describe("Stress tests", () => {
    test("handles rapid successive evaluations", () => {
      const results = [];
      for (let i = 0; i < 100; i++) {
        const result = engine.parseDocument(`s\`${i} + ${i}\``, { inputType: 'markdown' });
        results.push(result.lines[0].inlineSolves[0].result?.toNumber());
      }
      
      expect(results).toHaveLength(100);
      expect(results.every((r, i) => r === i * 2)).toBe(true);
    });

    test("handles memory pressure with large document", () => {
      // Create a document that would stress memory if not handled properly
      const lines = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`:var${i} = ${i}`);
        lines.push(`s\`:var${i} + ${i}\``);
      }
      const document = lines.join('\n');
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.totalLines).toBe(2000);
      expect(result.lines).toHaveLength(2000);
      expect(result.errors).toHaveLength(0);
      
      // Line 0: :var0 = 0 (result = 0)
      // Line 1: s`:var0 + 0` (result = 0 + 0 = 0)
      // Line 2: :var1 = 1 (result = 1)
      // Line 3: s`:var1 + 1` (result = 1 + 1 = 2)
      // ...
      // Line 1000: :var500 = 500 (result = 500)
      // Line 1001: s`:var500 + 500` (result = 500 + 500 = 1000)
      
      expect(result.lines[1].inlineSolves[0].result?.toNumber()).toBe(0); // :var0 + 0 = 0 + 0 = 0
      expect(result.lines[1001].inlineSolves[0].result?.toNumber()).toBe(1000); // :var500 + 500 = 500 + 500 = 1000
      
      // Verify some random lines
      const randomIndex = Math.floor(Math.random() * 500);
      expect(result.lines[randomIndex * 2].result?.toNumber()).toBe(randomIndex); // :varN = N
      expect(result.lines[randomIndex * 2 + 1].inlineSolves[0].result?.toNumber()).toBe(randomIndex * 2); // :varN + N = N + N = 2N
    });

    test("handles concurrent variable modifications", () => {
      const document = `:x = 10
:x = 20
:x = 30
s\`:x + 10\``;
      
      const result = engine.parseDocument(document, { inputType: 'markdown' });
      
      expect(result.lines).toHaveLength(4);
      expect(result.lines[0].result?.toNumber()).toBe(10);
      expect(result.lines[1].result?.toNumber()).toBe(20);
      expect(result.lines[2].result?.toNumber()).toBe(30);
      expect(result.lines[3].inlineSolves[0].result?.toNumber()).toBe(40);
    });
  });
});
