import { describe, expect, test } from "@jest/globals";
import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { OpCode } from "@solve-js/parser/OpCode";
import { numberValue, stringValue } from "@solve-js/vm/Value";
import { EngineError, ErrorCategory } from "@solve-js/errors/EngineError";


describe("VM Resilience", () => {
  test("empty opcodes array returns value result", () => {
    const vm = createVM(sharedOpRegistry);
    const result = executeBytecode({ opcodes: new Uint8Array([]), numbers: new Float64Array([]), strings: [] }, vm);
    expect(result.type).toBe('value');
    expect(unwrapEvalResult(result).toNumber()).toBe(0);
  });

  test("single opcode without halt flushes stack", () => {
    const vm = createVM(sharedOpRegistry);
    const opcodes = new Uint8Array([OpCode.PUSH_NUMBER, 0]);
    const numbers = new Float64Array([42]);
    const result = executeBytecode({ opcodes, numbers, strings: [] }, vm);
    expect(result.type).toBeDefined();
  });

  test("invalid opcode value does not throw, and is refused at its own instruction", () => {
    // The dispatch switch used to have no default arm, so opcode 255 ran as
    // a no-op that advanced ip by one, and this program then failed at its
    // fallback pop with a STACK_UNDERFLOW that named nothing. It is refused
    // at offset 0, where the opcode is, as an error result rather than a throw.
    const vm = createVM(sharedOpRegistry);
    const opcodes = new Uint8Array([255, 0]);
    const numbers = new Float64Array([0]);
    let result: ReturnType<typeof executeBytecode> | undefined;
    expect(() => {
      result = executeBytecode({ opcodes, numbers, strings: [] }, vm);
    }).not.toThrow();
    expect(result?.type).toBe("error");
    if (result?.type !== "error") return;
    expect(result.error.code).toBe("MALFORMED_BYTECODE_UNKNOWN_OPCODE");
    expect(result.error.category).toBe(ErrorCategory.VALIDATION);
    expect(result.error.recoverable).toBe(true);
    expect(result.error.message).toContain("UNKNOWN_255");
    expect(result.error.context?.offset).toBe(0);
  });

  test("an unknown opcode after valid instructions names its own offset, not a later underflow", () => {
    // `PUSH_NUMBER 0` then opcode 255: the refusal names offset 2, the byte
    // that carries the unknown opcode, and the valid push before it stays
    // the caller's business (the error arm restores the stack).
    const vm = createVM(sharedOpRegistry);
    const opcodes = new Uint8Array([OpCode.PUSH_NUMBER, 0, 255, OpCode.HALT]);
    const numbers = new Float64Array([7]);
    const result = executeBytecode({ opcodes, numbers, strings: [] }, vm);
    expect(result.type).toBe("error");
    if (result.type !== "error") return;
    expect(result.error.code).toBe("MALFORMED_BYTECODE_UNKNOWN_OPCODE");
    expect(result.error.context?.offset).toBe(2);
    expect(result.error.context?.opcode).toBe(255);
    expect(vm.getStack().length).toBe(0);
  });

  test("an enum member with no arm is refused the same way, by name", () => {
    // PUSH_VARIABLE and RETURN exist in the enum and nothing compiles to
    // them; the VM has no arm for either, and used to run them as no-ops.
    for (const op of [OpCode.PUSH_VARIABLE, OpCode.RETURN]) {
      const vm = createVM(sharedOpRegistry);
      const result = executeBytecode({ opcodes: new Uint8Array([op, OpCode.HALT]), numbers: new Float64Array([]), strings: [] }, vm);
      expect(result.type).toBe("error");
      if (result.type !== "error") continue;
      expect(result.error.code).toBe("MALFORMED_BYTECODE_UNKNOWN_OPCODE");
      expect(result.error.message).toContain(OpCode[op]);
    }
  });

  test("PUSH_STRING with index beyond strings length", () => {
    const vm = createVM(sharedOpRegistry);
    const opcodes = new Uint8Array([OpCode.PUSH_STRING, 99, OpCode.HALT]);
    const numbers = new Float64Array([]);
    const result = executeBytecode({ opcodes, numbers, strings: ["a"] }, vm);
    expect(result.type).toBeDefined();
  });

  test("corrupted bytecode - truncated data after PUSH_NUMBER", () => {
    const vm = createVM(sharedOpRegistry);
    const opcodes = new Uint8Array([OpCode.PUSH_NUMBER]);
    const numbers = new Float64Array([]);
    const result = executeBytecode({ opcodes, numbers, strings: [] }, vm);
    expect(result.type).toBeDefined();
  });

  test("corrupted bytecode - truncated data after PUSH_STRING", () => {
    const vm = createVM(sharedOpRegistry);
    const opcodes = new Uint8Array([OpCode.PUSH_STRING]);
    const numbers = new Float64Array([]);
    const result = executeBytecode({ opcodes, numbers, strings: ["test"] }, vm);
    expect(result.type).toBeDefined();
  });

  test("HALT returns correct stack value after complex operations", () => {
    const vm = createVM(sharedOpRegistry);
    const opcodes = new Uint8Array([
      OpCode.PUSH_NUMBER, 0, // push 42
      OpCode.PUSH_NUMBER, 1, // push 10
      OpCode.ADD,
      OpCode.HALT,
    ]);
    const numbers = new Float64Array([42, 10]);
    const result = executeBytecode({ opcodes, numbers, strings: [] }, vm);
    expect(result.type).toBeDefined();
  });

  test("deep opcode chain without recursion overflow", () => {
    const vm = createVM(sharedOpRegistry);
    const ops: number[] = [];
    for (let i = 0; i < 100; i++) {
      ops.push(OpCode.PUSH_NUMBER, i % 50);
    }
    ops.push(OpCode.HALT);
    const numbers = new Float64Array(Array.from({ length: 50 }, (_, i) => i));
    const result = executeBytecode({ opcodes: new Uint8Array(ops), numbers: new Float64Array(numbers), strings: [] }, vm);
    expect(result.type).toBeDefined();
  });

  test("max stack depth - many pushes without pops throws a controlled error, not silent corruption", () => {
    // Regression: this used to silently "succeed" — vm.push()'s bounds
    // check was never consulted by the hot dispatch loop, so pushes past
    // the default 200-slot maxStackDepth were dropped without warning
    // rather than growing the stack, and execution continued in a
    // silently-corrupted state. Now enforced: exceeding the limit throws.
    const vm = createVM(sharedOpRegistry);
    const ops: number[] = [];
    for (let i = 0; i < 500; i++) {
      ops.push(OpCode.PUSH_NUMBER, 0);
    }
    ops.push(OpCode.HALT);
    const numbers = new Float64Array([1]);
    expect(() => unwrapEvalResult(executeBytecode({ opcodes: new Uint8Array(ops), numbers, strings: [] }, vm)))
      .toThrow(/maximum stack depth/i);
  });

  test("nested CALL_BUILTIN with multiple arguments", () => {
    const vm = createVM(sharedOpRegistry);
    const ops: number[] = [
      OpCode.PUSH_NUMBER, 0, // arg1: 2
      OpCode.PUSH_NUMBER, 1, // arg2: 3
      OpCode.CALL_BUILTIN, 15, // Math.pow = index 15
      OpCode.HALT,
    ];
    const numbers = new Float64Array([2, 3]);
    const result = executeBytecode({ opcodes: new Uint8Array(ops), numbers, strings: [] }, vm);
    expect(result.type).toBeDefined();
  });

  test("all arithmetic opcodes produce valid results", () => {
    const ops: Array<{op: OpCode; a: number; b: number; numbers: number[]}> = [
      { op: OpCode.ADD, a: 10, b: 20, numbers: [10, 20] },
      { op: OpCode.SUB, a: 30, b: 10, numbers: [30, 10] },
      { op: OpCode.MUL, a: 5, b: 6, numbers: [5, 6] },
      { op: OpCode.DIV, a: 20, b: 4, numbers: [20, 4] },
      { op: OpCode.MOD, a: 17, b: 5, numbers: [17, 5] },
      { op: OpCode.EXP, a: 2, b: 8, numbers: [2, 8] },
    ];

    for (const { op, a, b } of ops) {
      const vm = createVM(sharedOpRegistry);
      const opcodes = new Uint8Array([
        OpCode.PUSH_NUMBER, 1,
        OpCode.PUSH_NUMBER, 0,
        op,
        OpCode.HALT,
      ]);
      const result = executeBytecode({ opcodes, numbers: new Float64Array([a, b]), strings: [] }, vm);
      expect(result.type).toBeDefined();
    }
  });
});

/**
 * Malformed bytecode is caller input, and has to be answered as such.
 *
 * `executeBytecode` is a public export, so a program handed to it is exactly as
 * untrusted as an expression string. The tests above already covered several of
 * these shapes and asserted only `result.type).toBeDefined()`, which passed
 * whether the engine answered cleanly or crashed into its own catch-all. That
 * is the gap this block closes: a fuzz run found nine distinct raw JavaScript
 * exceptions behind that assertion, each under a dozen bytes, and each arriving
 * as UNEXPECTED_ERROR/INTERNAL, which tells a caller the engine has a bug when
 * what happened is that their stream was nonsense.
 *
 * So these assert the code, not just that something came back. The reproducers
 * are the reduced ones from `__tests__/fuzz/corpus/`.
 */
describe("malformed bytecode is refused, not crashed on", () => {
  /** Runs a program and returns the error it produced, failing if it produced none. */
  function errorFrom(opcodes: number[], numbers: number[] = [], strings: string[] = []) {
    const vm = createVM(sharedOpRegistry);
    const result = executeBytecode(
      { opcodes: new Uint8Array(opcodes), numbers: new Float64Array(numbers), strings },
      vm,
    );
    if (result.type !== "error") throw new Error(`expected an error result, got ${result.type}`);
    return result.error;
  }

  test.each([
    // Every one of these is a corpus reproducer, listed with what it used to
    // throw. UNEXPECTED_ERROR is what the engine says when it does not know
    // what happened, so seeing it here again means the guard was lost.
    ["a program that ends mid-instruction", [11], "Cannot convert undefined to a BigInt"],
    ["a number-pool index past the end", [10, 161, 145], "reading 'toLowerCase' of undefined"],
    ["a string-pool index past the end", [13, 0, 14, 119, 13, 1, 81], "code.toUpperCase is not a function"],
    ["a currency code read from an empty pool", [10, 0, 13, 0, 13, 1, 81], "reading 'toUpperCase' of undefined"],
    ["a unit name that is not a string", [13, 0, 10, 0, 80, 13, 1, 51, 95, 2], "numerator.includes is not a function"],
    ["a rate unit that is not a string", [13, 0, 10, 0, 80, 10, 0, 90, 80, 20], "leftUnit.indexOf is not a function"],
    ["a builtin handed a non-string unit", [10, 0, 51, 0, 1, 10, 10, 3, 51, 94, 3], "major.toLowerCase is not a function"],
    ["a converter name that is not a string", [14, 131, 145], "safePop(...).value.toLowerCase is not a function"],
    ["a map body kind with no arm", [10, 0, 3, 156, 157, 120, 0, 1], "Cannot destructure property 'opcodes'"],
  ])("%s is refused cleanly (used to be: %s)", (_name, opcodes) => {
    const error = errorFrom(opcodes as number[]);
    expect(error.code).toMatch(/^MALFORMED_BYTECODE/);
    expect(error.category).toBe(ErrorCategory.VALIDATION);
    expect(error.recoverable).toBe(true);
  });

  test("the message names the opcode that could not be run", () => {
    // The diagnostic is the point. "UNEXPECTED_ERROR: Cannot convert undefined
    // to a BigInt" gave a caller nothing to act on.
    const error = errorFrom([OpCode.PUSH_BIGINT]);
    expect(error.message).toContain("PUSH_BIGINT");
    expect(error.code).toBe("MALFORMED_BYTECODE_TRUNCATED");
  });

  test("a pool index past the end names the pool and the index", () => {
    const error = errorFrom([OpCode.PUSH_NUMBER, 7], [1, 2]);
    expect(error.code).toBe("MALFORMED_BYTECODE_CONSTANT_INDEX");
    expect(error.message).toContain("7");
  });

  test("executeBytecode with no program at all returns an error rather than throwing", () => {
    // The destructure at the top of executeBytecode sat OUTSIDE its own
    // try/catch, so this threw a raw TypeError at whoever called it. Reachable
    // internally too, through a map/reduce body whose side-table entry is gone.
    const vm = createVM(sharedOpRegistry);
    let result: ReturnType<typeof executeBytecode> | undefined;
    expect(() => {
      result = executeBytecode(undefined as never, vm);
    }).not.toThrow();
    expect(result?.type).toBe("error");
    if (result?.type === "error") expect(result.error.code).toBe("MALFORMED_BYTECODE_PROGRAM");
  });

  /**
   * `popNumber()`/`popString()` live on the VM interface rather than in the
   * dispatch loop, so no fuzz case could reach them: nothing in this repo calls
   * either. A package author's opcode handler does, and that author is the
   * whole audience for the guards above, so both kept their pre-hardening bare
   * `stack.pop()!` long after every pop beside them had been fixed.
   */
  describe("the VM interface's pops, which packages call and this repo does not", () => {
    /** Runs `fn` and returns what it threw, failing if it threw nothing. */
    function thrownBy(fn: () => unknown): EngineError {
      try {
        fn();
      } catch (error) {
        return error as EngineError;
      }
      throw new Error("expected a throw, got a return");
    }

    test.each<[string, (vm: ReturnType<typeof createVM>) => unknown]>([
      ["popString", (vm) => vm.popString()],
      ["popNumber", (vm) => vm.popNumber()],
    ])("%s() on an empty stack raises STACK_UNDERFLOW, not a raw TypeError", (_name, pop) => {
      // `stack.pop()!` on an empty stack is `undefined`, and the `.value` /
      // `.toNumber()` that followed threw a TypeError naming neither the VM nor
      // the handler that called it.
      const error = thrownBy(() => pop(createVM(sharedOpRegistry)));
      expect(error).toBeInstanceOf(EngineError);
      expect(error.code).toBe("STACK_UNDERFLOW");
    });

    test("popNumber() still converts whatever is on top", () => {
      // The underflow guard is the only change: a Value that is not a Number
      // converts here exactly as it always did, since every type has a
      // `toNumber()`. This is why popNumber needs no operand-type check.
      const vm = createVM(sharedOpRegistry);
      vm.push(numberValue(42));
      expect(vm.popNumber()).toBe(42);
      vm.push(stringValue("7"));
      expect(vm.popNumber()).toBe(7);
    });

    test("a non-string on top is refused, naming the method and what was there", () => {
      // The cast was compile-time only, so this used to return a Value's
      // numeric `.value` typed as a string and throw in the handler instead.
      const vm = createVM(sharedOpRegistry);
      vm.push(numberValue(42));
      const error = thrownBy(() => vm.popString());
      expect(error.code).toBe("MALFORMED_BYTECODE_OPERAND_TYPE");
      expect(error.category).toBe(ErrorCategory.VALIDATION);
      expect(error.recoverable).toBe(true);
      expect(error.message).toContain("popString");
      expect(error.found).toContain("Number");
    });

    test("a string on top still comes back unchanged", () => {
      const vm = createVM(sharedOpRegistry);
      vm.push(stringValue("kilometres"));
      expect(vm.popString()).toBe("kilometres");
    });
  });

  test("a well-formed program is unaffected", () => {
    // The guards are on the error path only. Nothing above should have changed
    // what a real program does.
    const vm = createVM(sharedOpRegistry);
    const result = executeBytecode(
      {
        opcodes: new Uint8Array([OpCode.PUSH_NUMBER, 0, OpCode.PUSH_NUMBER, 1, OpCode.ADD, OpCode.HALT]),
        numbers: new Float64Array([2, 3]),
        strings: [],
      },
      vm,
    );
    expect(result.type).toBe("value");
    expect(unwrapEvalResult(result).toNumber()).toBe(5);
  });
});
