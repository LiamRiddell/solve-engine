# Resource guards: what the limits actually bound

Why an engine with seven safety limits could still be killed by twenty-four characters of
input, and what the allocation counter added for 1.0.0 does about it.

This is a design note, not a plan. It describes the shape of the hole, the fix, and what is
still outside the fix.

## The problem in one sentence

Every limit the engine had counted work that happens **between** opcodes, so nothing counted
what happens **inside** one.

## The limits, and what each one can see

| Limit | Where enforced | What it counts |
| --- | --- | --- |
| `validation.maxExpressionLength` | `engine/ExpressionEngineSafety.ts`, before lexing | characters of source |
| `validation.maxComplexity` | same, after lexing | tokens + function calls x5 + paren depth x10 |
| `validation.maxNestingDepth` | `parser/PrecedenceParser.ts` | recursive-descent depth |
| `NORMALIZED_TOKEN_LIMIT_EXCEEDED` | `normalizer/TokenNormalizer.ts` | tokens a normalizer rule may emit |
| `TOO_MANY_NUMERIC_CONSTANTS` and siblings | `parser/BytecodeBuilder.ts` | entries in a bytecode side-table |
| `vm.maxInstructions` | `vm/VM.ts` dispatch loop | opcodes executed |
| `vm.maxStackDepth` | same | value-stack slots |
| `maxFunctionRecursionDepth` | `VM.pushCallFrame()` | nested user-function calls |
| `vm.maxCollectionSize` | `vm/MatrixOps.ts`'s `collectionToValues()` | elements in **one** expanded collection |
| `vm.maxFunctionCalls` | `chargeFunctionCall()`, from `CALL_USER_FUNCTION` | user-function calls in **total**, across reentry |
| `performance.maxDocumentLines` | `parseDocument()`, `DocumentModel.setDocument()` | lines in a document |
| `date.maxOffsetYears` / `minOffsetYears` | `vm/VM.ts`'s `addBusinessDays()` | how far the one date offset that WALKS may reach |
| `MAX_EXACT_POW_BITS` / `MAX_EXACT_SHIFT_BITS` | `vm/VM.ts`'s `exactPowFits()` / `bigIntShift()` | bits in a bigint built by `^` or `<<` |
| `MAX_DISPLAYED_BIGINT_DIGITS` | `format/FormatEngine.ts`'s `formatBigInt()` | decimal digits rendered |
| `MAX_SIMPLIFY_DEPTH` / `MAX_FORMAT_DEPTH` | `symbolic/Simplify.ts`, `symbolic/SymbolicFormat.ts` | levels of a symbolic tree walked recursively |

The bottom seven were added by the 1.0.0 denial-of-service pass. Four of them (the
document and date rows) enforce fields that were declared in `constants/Configuration.ts`
and read nowhere, which is worse than a missing limit rather than equivalent to one: a
host that configures it believes it has protection it does not have. The four fields in
that same file with no bound to enforce (`parseTimeoutMs`, `executionTimeoutMs`,
`date.defaultOffsetDays`, and the whole `dice` section) were deleted for the same reason.

The first five bound the **input**. They are the reason a hostile document cannot make the
parser do unbounded work, and they are sound.

The next three bound **execution**, and every one of them is a per-opcode check:

```ts
while (ip < opcodes.length) {
  if (++localInstructionCount > maxInstructions) throw ...   // between opcodes
  if (stack.length > maxStackDepth) throw ...                // between opcodes
  const op = opcodes[ip++];
  switch (op) { ... }                                        // unbounded work lives here
}
```

An opcode that loops a hundred million times inside its own `case` runs to completion without
the loop condition being evaluated once. The counter is not slow to notice; it cannot notice.
The value stack cannot notice either, because the elements never reach it: they go into an
array that one opcode owns.

That is the whole gap. Everything below follows from it.

## What escaped, by category

**1. Materialising a lazy value.** A `Range` is stored as two numbers. `map`, `reduce`, `sum`
and `prod` turn it into one `Value` per element. `sum(x, 1:100000000)` is twenty characters
and a hundred million `Value` objects, allocated inside a single `REDUCE_INVOKE`. V8 aborts
the process with "Reached heap limit", and a process abort is not something `try`/`catch` can
contain, so a host embedding the engine in an editor loses the editor. Closed by
`vm.maxCollectionSize` (a separate piece of work; see `collectionToValues()`).

**2. A result whose size is the product of two legal inputs.** This is the one a per-site cap
cannot close, and the reason a cumulative counter had to exist. Three lines, each of which
passes every limit in the table above:

```
:a = map(1*x, 0:20000)     20,001 elements, a fifth of maxCollectionSize
:b = transpose(a)          20,001 again
b * a                      20,001 x 20,001 = 400,040,001 cells
```

Measured before the fix: `FATAL ERROR: JavaScript heap out of memory`, process gone. No
operand is anywhere near a limit. A cap on collection size, a cap on matrix size, a cap on
anything **per site** passes all three lines, because the fatal quantity is not any input, it
is the product.

**3. Repetition within one expression.** Twenty-five `sum(x, 1:100000)` terms fit inside
`maxExpressionLength` and `maxComplexity` and materialise 2.5 million `Value`s in 1.3 seconds.
Each collection is legal; nothing added them up. Same shape as the above: per-site caps do not
compose.

**4. Repetition through reentrancy.** `executeBytecode()` re-enters itself for user-defined
function bodies, `map`/`reduce` transform bodies and algebra verbs' bound-unknown bodies. Each
reentrant call gets a **fresh** `localInstructionCount`, which is why `f(x) = f(x)` needed
`maxFunctionRecursionDepth` as a dedicated guard rather than being caught by
`maxInstructions`. Any per-call resource allowance inherits exactly the same defect.

## The fix: one tally per evaluation

`vm/AllocationBudget.ts`. A single counter of **elements** (one `Value` in an expanded
collection, one cell in a matrix) that an evaluation is allowed to materialise, configured by
`vm.maxAllocatedElements` (default 2,000,000) through the same `EngineConfig` mechanism as
every other limit.

Three properties, each answering one of the categories above:

- **It is a total, not a per-site cap.** Category 3 is bounded because the second collection
  is charged on top of the first.
- **It is consulted before allocating, at the sites where the size is knowable in advance.** A
  matrix product works out `rows x cols` from the shapes alone and is refused before
  `matrixMultiply()` runs, so category 2 is refused rather than survived.
- **It is reset only by the outermost `executeBytecode()` entry.** Nested calls keep spending
  the same allowance, so category 4 cannot refresh its own budget the way it refreshes the
  instruction counter.

Checking and charging are separate operations, and the distinction is what keeps the
arithmetic honest:

- `chargeAllocation(count, what)` **records**. It runs exactly once per thing, where the thing
  comes into existence.
- `checkAllocation(count, what)` **refuses without recording**. It runs where a size is known
  ahead of the allocation whose result will be charged on birth.

Doing both at a matrix product would bill every matrix twice and silently halve the ceiling a
host configured, which is the kind of error that surfaces as "the limit seems too low" rather
than as a failure.

The counter is module state, made current by `beginEvaluation()` and released in a `finally`.
Ambient rather than threaded through signatures for two reasons: a helper five frames down
(`collectionToValues()`) can charge without four intermediate functions growing a parameter,
and a charge stays an add and a compare rather than an object dispatch. This is the same
pattern, and rests on the same fact, as the value arena in `vm/Value.ts`: `executeBytecode()`
is synchronous, so exactly one evaluation is ever in flight in a realm.

The refusal is `ALLOCATION_LIMIT_EXCEEDED`, category `EXECUTION`, **recoverable**. It names
the number requested, what was being made, and the ceiling:

```
error[ALLOCATION_LIMIT_EXCEEDED]: Evaluating this expression would materialise 400,040,001
matrix cells, past the limit of 2,000,000 elements for one evaluation
  expected: at most 2,000,000 elements materialised while evaluating one expression
  found: a request for 400,040,001 more matrix cells, on top of 40,002 already materialised
  suggestion: use a smaller collection or matrix, or raise the engine's vm.maxAllocatedElements setting
```

### Where it is charged

| Site | Operation | Why there |
| --- | --- | --- |
| `matrixValue()` | charge | every matrix in the engine is born there, so this counts anything the rest of this table misses, including opcodes not yet written |
| `MAP_INVOKE` / `REDUCE_INVOKE` collections | charge, after expanding | `maxCollectionSize` has already bounded each expansion; the tally is what stops the second one |
| `matrixMultiply()` | check, before, via `checkedArray()` | the same product reached through `dot()`, `abs`, `det`, `inv` and `pow` rather than through the operator, which used to open with a bare `new Array(rows * cols)` and abort the process on four hundred million cells while the `*` spelling refused it in 18ms |
| `MUL`, matrix x matrix | check, before | the product shape is known from the operands, and it is the only arithmetic result larger than both inputs |
| `POW`, matrix ^ n | check, before | repeated squaring allocates a full matrix per step, so a hopeless exponent should be refused before the first one rather than partway through |
| `MAT_NEW`, `MAT_SLICE`, `MAP_INVOKE` result | check, before, via `checkedArray()` | the length is an operand, and the array becomes a matrix that charges on birth |

`checkedArray(count, what)` is the intended way to allocate a user-sized array inside the VM
whose contents end up in a Value that charges: it asks, then allocates. "Ask before you take"
becomes a property of the allocator rather than something each new opcode has to be told.

### Cost

A charge is an integer add and a compare, and only at the sites listed. The always-on cost is
two module-level calls per `executeBytecode()` invocation. Measured A/B on the `vm` benchmark
suite, which is the one that isolates the dispatch loop (identical source except those two
calls, three runs each way, same machine minutes apart): per-case ratios 1.02x to 1.07x, suite
geometric mean 1.035x, against a 1.25x per-case and 1.15x suite warning line in
`benchmarks/thresholds.json`. Run-to-run noise on the same machine is 4 to 7 percent, so this
sits at the edge of what the harness can resolve. Nothing at the pipeline level moved.

Two things were needed to get there. The tally is module state read through plain numbers
rather than an object on the VM, because an object dispatch per charge was measurable on the
smallest programs. And `VM.reset()` deliberately does not touch it: the benchmark calls
`reset()` in its inner loop, and there is nothing to reset, since the outermost
`beginEvaluation()` zeroes the tally on the way in.

## What is still not bounded, and why that is acceptable

**Element-wise matrix arithmetic** (`a + b` on two matrices, `binaryOp()` in
`vm/VMConversion.ts`) allocates a result the size of its inputs. It is charged by
`matrixValue()` rather than before the allocation. Since the output cannot be larger than an
input, the first such allocation is never the fatal one, and the tally refuses the next. A
pre-charge would mean editing `VMConversion.ts`, which was not in this change's scope.

**Builtins that return a matrix** (`transpose`, `inv`, `det`) are in the same position
and for the same reason: output bounded by input, charged on the way out by `matrixValue()`.
`dot()` was on this list and did not belong on it: its output is the PRODUCT of its inputs,
which is category 2 above, and it is now checked inside `matrixMultiply()` itself so that
every route to that function inherits the check rather than each caller remembering it.

**Symbolic trees** have their own guards (`SYMBOLIC_MAX_NODES`, `RATIONAL_MAX_BITS`,
`FACTOR_MAX_ROOT_CANDIDATES`, the derivative and Taylor degree ceilings). They count nodes
rather than elements, so they are not part of this tally. Every one of them bounds a tree's
SIZE, and size and depth are the same number for a chain, so the recursive printer and
simplifier now carry depth guards of their own: the node ceiling admits ten thousand nodes
and the native stack ran out at about 1,170 levels in the printer and 1,757 in the
simplifier, which left a band of trees the engine called legal and then died on.

**BigInt** growth from repeated multiplication (`x * x * x ...`) is bounded by V8's own
maximum BigInt size, which raises a catchable `RangeError` rather than aborting. `^` and
`<<`/`>>` are bounded by us, since both can ask for an arbitrarily large integer from a
short line: they share one ceiling, and `formatBigInt()` carries a digit ceiling of its own
because rendering a large bigint in decimal costs more than building it (8.5 seconds for
`1n << 100000000`, against milliseconds to construct it).

**Strings** are not user-scalable: nothing in `src/` calls `String.prototype.repeat`, and the
only `padStart` with a variable width takes it from host settings, not from input.

**Document-level memory** (the line cache, which has no size limit of its own) is a different
axis: it grows with document size rather than with one line, and no single line can drive it.
The document itself is now bounded by `performance.maxDocumentLines`, set at 100,000: twice
the largest document the repo measures (the throughput benchmark parses 50,000 lines, the
paging spec evaluates 20,000), and half the 200,000 that aborts the process on the line
records alone.

**The value arena** (`vm/Value.ts`) is outside the tally because it outlives the evaluation
the tally is scoped to, and that is what made an unbounded call count fatal rather than
merely slow. It grew to its high-water mark and stayed there for the life of the process:
one legal `map(x*1, 1:100000)` left 300,004 Values, about 24MB, still resident after `1 + 1`.
`reset()` now gives the block back on the first cycle that does not need it, keeping twice
what the last cycle used and only when it is holding four times that, so a steady scroll
never trips it.

## The rule this leaves behind

A new opcode that allocates in proportion to user input must either allocate through
`checkedArray()` or produce its result through a constructor that charges. If its output can
be **larger than its inputs**, it must call `checkAllocation()` **before** allocating, because
the tally cannot refuse an allocation that has already happened. Everything else is caught by
the backstop in `matrixValue()`.

## Related: what `isFatal()` means

`EngineError.recoverable` and the `INTERNAL` category answer two different questions, and used
to answer the same one:

- **category** `INTERNAL`: whose fault is this? The engine's. Worth reporting as a bug.
- **recoverable**: is this engine instance still usable? Almost always yes.

`normalizeUnknownError()` marked everything it caught as `INTERNAL` **and**
`recoverable: false`, so `isFatal()` returned true for any unanticipated error on any line. A
host that honours the name would tear a document down over one bad line, and the engine
demonstrably survives:
`__tests__/hardening/RobustnessEngineLifecycle.spec.ts` alternates a throwing line with a good
one five hundred times and every answer stays correct.

Unknown errors are recoverable now, and so is `ErrorFactory.internal()` by default: every one
of its call sites is an invariant that failed on one line (a stack underflow from a buggy
plugin, a missing bytecode side-table entry, an "impossible" state), and none of them leaves
the engine unusable. `ErrorFactory.config()` is the one factory that still defaults to
`recoverable: false`, and it is the right one: a configuration or package-registration failure
is the case where there genuinely is no working engine to carry on with. A site that has
looked at its own case and concluded otherwise can still pass `recoverable: false` explicitly.
