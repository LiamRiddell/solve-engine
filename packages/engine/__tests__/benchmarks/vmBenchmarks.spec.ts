/**
 * VM Execution Benchmarks - Jest compatible
 * Measures bytecode execution performance using pre-built bytecodes.
 * This isolates VM performance from parsing overhead.
 *
 * NOTE: The benchmark reuses a single VM instance across iterations
 * (reset() instead of createVM() each time) to eliminate allocation
 * and GC noise from the measurement. This reflects the production
 * usage pattern where ExpressionEngine keeps a persistent VM.
 */

import { describe, expect, test, afterAll } from "@jest/globals";
import { createVM, executeBytecode, unwrapEvalResult } from "@solve-js/vm/VM";
import { OpCode } from "@solve-js/parser/OpCode";
import { sharedOpRegistry } from "@solve-js/vm/OpRegistry";
import { recordSample, writeBenchmarkResults, BenchmarkResults } from "@tools/benchmarkIO";
import { benchmarkFn } from "@tools/testUtils";

interface BytecodeProgram {
  opcodes: Uint8Array;
  numbers: Float64Array;
  strings: string[];
}

function makeBytecode(opcodes: number[], numbers: number[] = [], strings: string[] = []): BytecodeProgram {
  return {
    opcodes: new Uint8Array(opcodes),
    numbers: new Float64Array(numbers),
    strings,
  };
}

const programs: Array<{ name: string; bytecode: BytecodeProgram }> = [
  // Simple: 1 + 2 → PUSH 1, PUSH 2, ADD, HALT
  {
    name: "simple_add",
    bytecode: makeBytecode([OpCode.PUSH_NUMBER, 0, OpCode.PUSH_NUMBER, 1, OpCode.ADD, OpCode.HALT], [1, 2]),
  },
  // Variable: STORE + LOAD + ADD
  {
    name: "variable_access",
    bytecode: makeBytecode(
      [OpCode.PUSH_NUMBER, 0, OpCode.STORE_VAR, 0, OpCode.PUSH_NUMBER, 1, OpCode.LOAD_VAR, 0, OpCode.ADD, OpCode.HALT],
      [42, 0],
      ["x"]
    ),
  },
  // Vector: vec3(1, 2, 3)
  {
    name: "vector_creation",
    bytecode: makeBytecode(
      [OpCode.PUSH_NUMBER, 0, OpCode.PUSH_NUMBER, 1, OpCode.PUSH_NUMBER, 2, OpCode.MAT_NEW, 1, 3, OpCode.HALT],
      [1, 2, 3]
    ),
  },
  // Unit conversion: 100 cm to m
  {
    name: "unit_conversion",
    bytecode: makeBytecode(
      [OpCode.PUSH_NUMBER, 0, OpCode.PUSH_STRING, 0, OpCode.PUSH_STRING, 1, OpCode.UOM_CONVERT_TO, OpCode.HALT],
      [100],
      ["cm", "m"]
    ),
  },
  // Dice: roll(1, 6)
  {
    name: "dice_roll",
    bytecode: makeBytecode([OpCode.PUSH_NUMBER, 0, OpCode.PUSH_NUMBER, 1, OpCode.CALL_BUILTIN, 37, 2, OpCode.HALT], [1, 6]),
  },
  // Percentage: 50% of 200
  {
    name: "percentage",
    bytecode: makeBytecode(
      [OpCode.PUSH_NUMBER, 0, OpCode.TO_PERCENTAGE, OpCode.PUSH_NUMBER, 1, OpCode.MUL, OpCode.HALT],
      [50, 200]
    ),
  },
];

describe("VM Benchmarks", () => {
  const results: BenchmarkResults = {};

  afterAll(() => {
    writeBenchmarkResults("vm", results, "ms");
  });

  for (const { name, bytecode } of programs) {
    test(`executes "${name}" efficiently`, async () => {
      // Reuse a single VM across all iterations — matches production pattern
      // where ExpressionEngine keeps a persistent VM. Eliminates allocation
      // and GC noise from the measurement.
      const vm = createVM(sharedOpRegistry);

      // Time a BATCH of executions rather than each one.
      //
      // A single VM execution here takes a fraction of a microsecond, which is
      // at or below the resolution of performance.now(). Recording that number
      // put every case in this suite under the comparison harness's five
      // microsecond noise floor, so the comparator excluded all of them and the
      // VM suite contributed no regression signal at all. That is the wrong
      // suite to lose: the dispatch loop is exactly where a change to the hot
      // path would show up.
      //
      // Timing a batch puts the measured span comfortably above timer
      // resolution, and benchmarkFn's median across batches is then a figure
      // worth comparing. The recorded value is per batch, not per operation, so
      // it is only ever compared against another run of the same batch size.
      const perBatch = 2000;
      const stats = await benchmarkFn(() => {
        for (let i = 0; i < perBatch; i++) {
          vm.reset();
          executeBytecode(bytecode, vm);
        }
      }, 20, 3);

      recordSample(results, name, stats);

      // Per-operation, for the assertion. Simple VM ops stay well under 500µs.
      const perOpUs = (stats.medianMs / perBatch) * 1000;
      expect(perOpUs).toBeLessThan(500);
    });
  }
});
