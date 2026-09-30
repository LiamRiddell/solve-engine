/**
 * The engine's own error codes, one typed const object per layer.
 *
 * An error code is the stable name a host branches on when a line fails; the
 * message beside it is prose for the reader, and may be reworded in any
 * release. A code a host can receive keeps its name, so an entry here is
 * never renamed or removed: `__tests__/errors/ErrorCodeCatalogueSnapshot.spec.ts`
 * fails when one is, and `npm run lint:error-codes` fails when a code is
 * raised that no catalogue lists.
 *
 * Deliberately not one closed enum: `IEnginePackage` is public SDK surface, and
 * a third-party package defines codes of its own without editing this file,
 * which is why `EngineError.code` stays a `string`. Each built-in package keeps
 * its codes in a catalogue of its own, beside its parselets, and
 * `packages/ErrorCodeCatalogue.ts` gathers them all. The doc comment on each
 * entry is the sentence the error code reference prints for it, so it says
 * when the code arises, and what a host can do where that is more than show
 * the message.
 */

/**
 * The codes the engine's own layers raise: the lexer, the parser, the VM, the
 * engine and the document passes, and the errors layer's own fallbacks. They
 * are grouped by stage in the comments; the names predate any convention and
 * keep their spellings, so a new code follows a scoped, prefixed style such
 * as `STACK_UNDERFLOW`.
 */
export const CoreErrorCodes = {
  // ── Parser (parser/PrecedenceParser.ts, parser/BytecodeBuilder.ts, parser/PhrasePattern.ts) ──
  /** A number written in a form that does not read as one: a hex, binary or octal literal with a digit its base lacks (`0xZZ`), or thousands groups that are not three digits long. The reader fixes the digits. */
  INVALID_NUMBER_LITERAL: "INVALID_NUMBER_LITERAL",
  /** A `"` that is never closed, as in `"abc`. Raised by the lexer; the reader closes the text. */
  UNTERMINATED_STRING: "UNTERMINATED_STRING",
  /** A line has something where a value should start that cannot start one: the `*` in `2 + * 3`, the `)` in `round(3.14, )`, the `>` in `(5 km) -> miles`. Thrown with a span on the character and, where there is an obvious next step, a `suggestion`. */
  NO_PREFIX_PARSELET: "NO_PREFIX_PARSELET",
  /** A line stops before its expression does: `5 +`, `(2 + 3`, `sqrt(`. Thrown with an empty span just after the last character, where an editor puts the caret, and a `suggestion`. */
  UNEXPECTED_END_OF_INPUT: "UNEXPECTED_END_OF_INPUT",
  /** A form needed one particular thing next and found another: a `)` where a `,` stands, or dice notation (`roll 1d6`) where a range was expected. Thrown with a span and a `suggestion`. */
  UNEXPECTED_TOKEN_TYPE: "UNEXPECTED_TOKEN_TYPE",
  /** Brackets, or other nested forms, deeper than the parser allows (`validation.maxNestingDepth`, 50 by default). A safety limit against input built to exhaust the stack; the reader flattens the line. */
  NESTING_DEPTH_EXCEEDED: "NESTING_DEPTH_EXCEEDED",
  /** The same as `UNEXPECTED_END_OF_INPUT`, raised where a line ends before an expression starts at all. */
  UNEXPECTED_END: "UNEXPECTED_END",
  /** A complete expression followed by more that is not part of it: the `,` in `1,5 + 1`, the `3pm` in `February 2026 3pm`. Thrown rather than answered with the first half, which would be a wrong answer. */
  UNEXPECTED_TRAILING_TOKEN: "UNEXPECTED_TRAILING_TOKEN",
  /** The generic parse failure, kept for a caller that wraps one without a more specific code. */
  PARSE_ERROR: "PARSE_ERROR",
  /** One line with more distinct number literals than a compiled program can index. A safety limit; the reader splits the line. */
  TOO_MANY_NUMERIC_CONSTANTS: "TOO_MANY_NUMERIC_CONSTANTS",
  /** A compiled operand outside 0 to 255, or a jump outside the program. A package-authoring fault, reported at compile time rather than letting the program read the wrong constant. */
  BYTECODE_OPERAND_OUT_OF_RANGE: "BYTECODE_OPERAND_OUT_OF_RANGE",
  /** One line with more distinct text literals than a compiled program can index. A safety limit; the reader splits the line. */
  TOO_MANY_STRING_CONSTANTS: "TOO_MANY_STRING_CONSTANTS",
  /** A phrase that starts a form (`roll`, `clamp`) followed by none of the words that continue it. The message names the words that may come next. */
  NO_MATCHING_PHRASE_ALTERNATIVE: "NO_MATCHING_PHRASE_ALTERNATIVE",
  /** A package declared a phrase pattern whose alternative does not begin with a keyword. An authoring fault, raised when the pattern is built. */
  INVALID_PHRASE_PATTERN: "INVALID_PHRASE_PATTERN",
  /** A phrase form missing one of its words part-way through (`roll between 1 6`, with no `and`). The message names the word expected. */
  PHRASE_KEYWORD_MISMATCH: "PHRASE_KEYWORD_MISMATCH",
  /** A function definition (`f(x, y) = ...`) with something other than a name where a parameter goes. */
  USER_FUNCTION_INVALID_PARAM_NAME: "USER_FUNCTION_INVALID_PARAM_NAME",
  /** A function definition with no parameters, `f() = ...`, which would read the same as a call. A definition needs at least one. */
  USER_FUNCTION_NO_PARAMS: "USER_FUNCTION_NO_PARAMS",
  /** A function definition whose body reaches live data (weather, stocks, a currency rate). Refused when it is defined, since a function body must be synchronous. */
  FUNCTION_BODY_MUST_BE_SYNCHRONOUS: "FUNCTION_BODY_MUST_BE_SYNCHRONOUS",
  /** One line defining more functions than a compiled program can index. A safety limit, of the same kind as `TOO_MANY_NUMERIC_CONSTANTS`. */
  TOO_MANY_FUNCTION_DEFINITIONS: "TOO_MANY_FUNCTION_DEFINITIONS",
  /** One line with more `map` or `reduce` bodies than a compiled program can index. A safety limit, of the same kind as `TOO_MANY_FUNCTION_DEFINITIONS`. */
  TOO_MANY_ANONYMOUS_BODIES: "TOO_MANY_ANONYMOUS_BODIES",
  /** A parselet emitted a call to a plugin function by a name no registered package declares, or before its package registered. A package-authoring or registration fault, not the reader's line. */
  UNKNOWN_PLUGIN_FUNCTION: "UNKNOWN_PLUGIN_FUNCTION",
  /** A plugin function's promise was rejected. The line reports the rejection's message rather than waiting again. */
  PLUGIN_CALL_FAILED: "PLUGIN_CALL_FAILED",
  /** A plugin function's promise resolved to something that is not a Value. An authoring fault, reported on the line. */
  PLUGIN_RESULT_NOT_A_VALUE: "PLUGIN_RESULT_NOT_A_VALUE",

  // ── VM (vm/VM.ts, vm/OpRegistry.ts, vm/VMBuiltins.ts) ──
  /** A line failed and no more specific code was kept for it. A fallback; the message says what happened. */
  EVALUATION_ERROR: "EVALUATION_ERROR",
  /** One evaluation ran more VM instructions than `vm.maxInstructions` allows. A safety limit against a line that would run too long; the host may raise the limit. */
  INSTRUCTION_LIMIT_EXCEEDED: "INSTRUCTION_LIMIT_EXCEEDED",
  /** One evaluation grew the VM stack past `vm.maxStackDepth`. A safety limit; the reader simplifies the line. */
  STACK_LIMIT_EXCEEDED: "STACK_LIMIT_EXCEEDED",
  /** One evaluation asking for more elements (list cells, matrix cells) than `vm.maxAllocatedElements` allows, even inside a single operation. A safety limit that describes this line; the host may raise it. */
  ALLOCATION_LIMIT_EXCEEDED: "ALLOCATION_LIMIT_EXCEEDED",
  /** The VM read more values than its stack held: corrupted bytecode or a faulty plugin. Worth reporting; the engine stays usable and only this line fails. */
  STACK_UNDERFLOW: "STACK_UNDERFLOW",
  /** A line reads a name no line above defines. Thrown with no span, and with the nearest defined names in `suggestion` and `context.didYouMean` when there are any. */
  UNDEFINED_VARIABLE: "UNDEFINED_VARIABLE",
  /** A `global :name` read before its value arrived from the shared store. It resolves on a later evaluation. */
  GLOBAL_VARIABLE_NOT_RESOLVED: "GLOBAL_VARIABLE_NOT_RESOLVED",
  /** A call to a name that is not a function the engine or a package provides. The nearest names are offered where there are any. */
  UNKNOWN_FUNCTION: "UNKNOWN_FUNCTION",
  /** A caller that asked for a settled value was handed one still waiting on live data. A caller-contract fault inside the engine, worth reporting. */
  UNEXPECTED_PENDING_RESULT: "UNEXPECTED_PENDING_RESULT",
  /** A call to a function of the reader's own that no line defines, or a definition the VM could not complete. */
  UNDEFINED_FUNCTION: "UNDEFINED_FUNCTION",
  /** A function of the reader's own called with a different number of arguments than it was defined with. */
  FUNCTION_ARITY_MISMATCH: "FUNCTION_ARITY_MISMATCH",
  /** A built-in function called with the wrong number of arguments: `sqrt()`, `atan2(1)`, `sqrt(1, 2, 3)`. Separate from `FUNCTION_ARITY_MISMATCH`, so a host can word the two differently. */
  BUILTIN_ARITY_MISMATCH: "BUILTIN_ARITY_MISMATCH",
  /** A function of the reader's own whose body reaches live data (weather, stocks, a currency rate). Function bodies must be synchronous. */
  USER_FUNCTION_ASYNC_UNSUPPORTED: "USER_FUNCTION_ASYNC_UNSUPPORTED",
  /** A `map` or `reduce` body that reaches live data while it runs. Refused at parse time first (`MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS`); this is the run-time guard. */
  MAP_REDUCE_ASYNC_UNSUPPORTED: "MAP_REDUCE_ASYNC_UNSUPPORTED",
  /** An algebra verb's expression that reaches live data while it runs. Refused at parse time first (`SYMBOLIC_ARGUMENT_MUST_BE_SYNCHRONOUS`); this is the run-time guard. */
  SYMBOLIC_ASYNC_UNSUPPORTED: "SYMBOLIC_ASYNC_UNSUPPORTED",
  /** `explainLine()` asked to derive a line that resolves data asynchronously (a live-data or async-plugin line). A derivation is a sequence of settled intermediate values, which a pending result has none of, so the line is refused rather than explained with a hole in it. */
  EXPLAIN_ASYNC_UNSUPPORTED: "EXPLAIN_ASYNC_UNSUPPORTED",
  /** `traceLine()` called with no document to read: the engine has no attached document model and no `parseDocument` result was passed as `options.document`. A trace follows one line into the lines above it, so without a document there is nothing to follow. */
  TRACE_NO_DOCUMENT: "TRACE_NO_DOCUMENT",
  /** `traceLine()` asked for a line number the document does not have (below 1, past the last line, or not a whole number). */
  TRACE_NO_SUCH_LINE: "TRACE_NO_SUCH_LINE",
  /** A function of the reader's own that calls itself too deeply, as `f(x) = f(x)` does. Refused by name rather than overflowing the native stack. */
  FUNCTION_RECURSION_LIMIT_EXCEEDED: "FUNCTION_RECURSION_LIMIT_EXCEEDED",
  /** One evaluation making more calls to functions of the reader's own than the budget allows, however shallow each call is. A safety limit against a chain of functions that multiplies its calls. */
  FUNCTION_CALL_LIMIT_EXCEEDED: "FUNCTION_CALL_LIMIT_EXCEEDED",
  /** A `<date> + N workdays` offset outside `date.maxOffsetYears` and `date.minOffsetYears`. Workdays walk the calendar a day at a time, so their cost is the offset. */
  DATE_OFFSET_LIMIT_EXCEEDED: "DATE_OFFSET_LIMIT_EXCEEDED",
  /** `N working days after <x>` (or `before`, `from`) where `<x>` is not a date, as in `5 working days after 3`. */
  WORKDAY_OFFSET_EXPECTED_DATE: "WORKDAY_OFFSET_EXPECTED_DATE",
  /** `working days between <a> and <b>` where one end is not a date. */
  WORKDAYS_BETWEEN_EXPECTED_DATES: "WORKDAYS_BETWEEN_EXPECTED_DATES",
  /** `working days between` two dates further apart than `date.maxOffsetYears` and `date.minOffsetYears` allow the count to walk. */
  WORKDAYS_BETWEEN_RANGE_TOO_LARGE: "WORKDAYS_BETWEEN_RANGE_TOO_LARGE",
  /** A `<<` or `>>` on a big integer whose exact result would be too large to compute. Refused rather than answered in doubles as Infinity. */
  BIGINT_SHIFT_LIMIT_EXCEEDED: "BIGINT_SHIFT_LIMIT_EXCEEDED",
  /** A `^` on a big integer whose exact result would be too large to compute (`2n ^ 100000`). Refused rather than answered as Infinity; a fractional or negative exponent uses doubles instead. */
  BIGINT_POW_LIMIT_EXCEEDED: "BIGINT_POW_LIMIT_EXCEEDED",
  /** A value with no whole-number form (a fraction, an infinity) meeting a big integer: `1n + 0.5`, `5n / pi`. */
  BIGINT_INEXACT_OPERAND: "BIGINT_INEXACT_OPERAND",
  /** `10n / 0n` or `10n mod 0n`. A big-integer division is exact, and an exact division by zero has no answer, unlike `1 / 0`, which is Infinity. */
  BIGINT_DIVISION_BY_ZERO: "BIGINT_DIVISION_BY_ZERO",
  /** A compiled program naming a function body it does not carry. A compiler or VM fault, worth reporting. */
  INTERNAL_MISSING_FUNCTION_BODY: "INTERNAL_MISSING_FUNCTION_BODY",
  /** A compiled program naming a `map` or `reduce` body it does not carry. A compiler or VM fault, worth reporting. */
  INTERNAL_MISSING_ANONYMOUS_BODY: "INTERNAL_MISSING_ANONYMOUS_BODY",
  /** A compiled call to a built-in function at an index none is registered at. Reachable only through a compiler or snapshot fault; worth reporting. */
  UNKNOWN_BUILTIN_FUNCTION: "UNKNOWN_BUILTIN_FUNCTION",

  // ── Malformed bytecode (vm/VM.ts) ──
  //
  // `executeBytecode` is exported from `./vm`, so a bytecode program is caller
  // input in the same sense an expression string is, and these say so: they
  // are validation errors rather than internal ones, and they name the opcode
  // and the operand rather than a line. Reachable from ordinary source only
  // through a compiler fault.
  /** An operand byte read past the end of the stream: the program ends in the middle of an instruction. */
  MALFORMED_BYTECODE_TRUNCATED: "MALFORMED_BYTECODE_TRUNCATED",
  /** A constant-pool operand indexing a `numbers`/`strings` entry that does not exist, or that is not of the pool's type. */
  MALFORMED_BYTECODE_CONSTANT_INDEX: "MALFORMED_BYTECODE_CONSTANT_INDEX",
  /** A unit or converter name read off the value stack that is not a string. Distinct from the pool case above: the operand is a Value another opcode pushed, not a pool entry. */
  MALFORMED_BYTECODE_OPERAND_TYPE: "MALFORMED_BYTECODE_OPERAND_TYPE",
  /** A `map` or `reduce` instruction carrying a body kind other than 0, 1 or 2. */
  MALFORMED_BYTECODE_BODY_KIND: "MALFORMED_BYTECODE_BODY_KIND",
  /** A big-integer constant in the program that is not a whole number, such as `"1.000"`. */
  MALFORMED_BYTECODE_BIGINT_LITERAL: "MALFORMED_BYTECODE_BIGINT_LITERAL",
  /** `executeBytecode` called with something that is not a runnable program at all. */
  MALFORMED_BYTECODE_PROGRAM: "MALFORMED_BYTECODE_PROGRAM",
  /** An instruction the VM does not have, refused at the offset that carries it (in the error's context). */
  MALFORMED_BYTECODE_UNKNOWN_OPCODE: "MALFORMED_BYTECODE_UNKNOWN_OPCODE",

  // ── Symbolic algebra (symbolic/, vm/SymbolicOps.ts) ──
  /** A coefficient grew past `RATIONAL_MAX_BITS`, e.g. repeated exact elimination multiplying denominators together. */
  SYMBOLIC_RATIONAL_OVERFLOW: "SYMBOLIC_RATIONAL_OVERFLOW",
  /** `NaN` or `±Infinity` reaching a symbolic expression, neither of which has an exact rational value. */
  SYMBOLIC_NONFINITE_OPERAND: "SYMBOLIC_NONFINITE_OPERAND",
  /** An exact symbolic division by zero, such as `expand((x+1)/0)`: refused where the quotient is written, as a value, and thrown from the rational arithmetic beneath. The zero is exact, so a very small number is not mistaken for one. */
  SYMBOLIC_DIVISION_BY_ZERO: "SYMBOLIC_DIVISION_BY_ZERO",
  /** A tree exceeding `SYMBOLIC_MAX_NODES` entering the simplifier. */
  SYMBOLIC_NODE_LIMIT_EXCEEDED: "SYMBOLIC_NODE_LIMIT_EXCEEDED",
  /** A name holding a formula written before one of its unknowns had a value (`y = x + 1` above `x = $5`), read after that unknown was given money, a quantity in a unit, a date or text, which the formula cannot take. Returned by the read rather than a formula mixing the value with the unknown (#732). */
  SYMBOLIC_FORMULA_VALUE_UNSUPPORTED: "SYMBOLIC_FORMULA_VALUE_UNSUPPORTED",
  /** A builtin with no symbolic reading (`min`, `random`, the finance block, ...) applied to an expression still containing an unknown. Returned rather than computing against `toNumber()`'s placeholder zero. */
  SYMBOLIC_UNSUPPORTED_FUNCTION: "SYMBOLIC_UNSUPPORTED_FUNCTION",
  /** The rational-root search exceeding `FACTOR_MAX_ROOT_CANDIDATES`. The candidate set is the product of two divisor sets, so a highly-composite coefficient escapes quickly. */
  SYMBOLIC_FACTOR_LIMIT_EXCEEDED: "SYMBOLIC_FACTOR_LIMIT_EXCEEDED",
  /** An equation outside what the solver attempts: above the degree ceiling, non-linear in the unknown while another unknown is present, or not a polynomial and not evaluable numerically either (another unknown in it, an imaginary constant, a function with no numeric form). A non-polynomial equation in one unknown is solved numerically instead (see `symbolic/NumericSolve.ts`). */
  SYMBOLIC_SOLVE_UNSUPPORTED: "SYMBOLIC_SOLVE_UNSUPPORTED",
  /** Some but not all of an equation's roots were found. Reported rather than returned, because a partial list of roots looks exactly like a complete one. */
  SYMBOLIC_SOLVE_INCOMPLETE: "SYMBOLIC_SOLVE_INCOMPLETE",
  /** A numerically solved equation whose two sides never cross in the range searched. Not "no solution": a search that found nothing has not shown there is nothing, and the message names the range and what the search cannot see. */
  SYMBOLIC_SOLVE_NO_ROOT_FOUND: "SYMBOLIC_SOLVE_NO_ROOT_FOUND",
  /** A numerically solved equation with more roots in the range than `NUMERIC_ROOTS_MAX`, as a periodic one has, or whose two sides compare equal across a whole stretch. Declined rather than listed, because a list cut off at the edge of the search would read as complete. */
  SYMBOLIC_SOLVE_TOO_MANY_ROOTS: "SYMBOLIC_SOLVE_TOO_MANY_ROOTS",
  /** A bound of `integral`, an end of `solve`'s search range, or `limit`'s point that is not a plain finite number: it carries a unit, still contains an unknown, is not a number, or (for `solve` and `limit`) is infinite. */
  SYMBOLIC_BOUND_INVALID: "SYMBOLIC_BOUND_INVALID",
  /** `integral(f, x, a)` or `solve(eq, x, a)`: one number after the unknown where the form takes two. A parse error naming the form, rather than a missing closing parenthesis. */
  SYMBOLIC_REQUIRES_BOTH_BOUNDS: "SYMBOLIC_REQUIRES_BOTH_BOUNDS",
  /** `limit(f, x)` with no point for the unknown to approach. */
  SYMBOLIC_REQUIRES_LIMIT_POINT: "SYMBOLIC_REQUIRES_LIMIT_POINT",
  /** A definite integral with an infinite bound, or whose integrand has no finite value somewhere in the range (`1/x` from 0 to 1). Improper integrals are refused by name rather than evaluated. */
  SYMBOLIC_INTEGRAL_IMPROPER: "SYMBOLIC_INTEGRAL_IMPROPER",
  /** A definite integral whose numeric estimate did not settle within the quadrature's budget, which is what an integrand growing without bound inside the range, and so a diverging integral, looks like. */
  SYMBOLIC_INTEGRAL_UNSETTLED: "SYMBOLIC_INTEGRAL_UNSETTLED",
  /** A limit where the expression grows without bound (`1/x^2` at 0). */
  SYMBOLIC_LIMIT_DIVERGES: "SYMBOLIC_LIMIT_DIVERGES",
  /** A limit whose left and right sides settle on different values (`abs(x)/x` at 0). The message names both. */
  SYMBOLIC_LIMIT_SIDES_DISAGREE: "SYMBOLIC_LIMIT_SIDES_DISAGREE",
  /** A limit whose values never settle on one number (`sin(1/x)` at 0). */
  SYMBOLIC_LIMIT_UNSETTLED: "SYMBOLIC_LIMIT_UNSETTLED",
  /** A limit of an expression with no real value near the point on either side. */
  SYMBOLIC_LIMIT_UNDEFINED: "SYMBOLIC_LIMIT_UNDEFINED",
  /** A limit of an expression that cannot be evaluated numerically: another unknown in it, an imaginary constant, or a function with no numeric form. */
  SYMBOLIC_LIMIT_UNSUPPORTED: "SYMBOLIC_LIMIT_UNSUPPORTED",
  /** `solve`'s second argument not being a bare name. */
  SOLVE_REQUIRES_VARIABLE_NAME: "SOLVE_REQUIRES_VARIABLE_NAME",
  /** A derivative order outside 0..`DERIVATIVE_MAX_ORDER`. */
  SYMBOLIC_DERIVATIVE_ORDER_LIMIT: "SYMBOLIC_DERIVATIVE_ORDER_LIMIT",
  /** An indefinite integral with no known elementary antiderivative, reported rather than approximated, since a wrong integral is indistinguishable from a right one at the point of use. For a definite integral, one with no antiderivative that also cannot be evaluated numerically (another unknown in it, or a function with no numeric form). */
  SYMBOLIC_INTEGRAL_UNSUPPORTED: "SYMBOLIC_INTEGRAL_UNSUPPORTED",
  /** A Taylor degree outside 0..`TAYLOR_MAX_DEGREE`. */
  SYMBOLIC_TAYLOR_DEGREE_LIMIT: "SYMBOLIC_TAYLOR_DEGREE_LIMIT",
  /** A Taylor coefficient that does not reduce to an exact number at the expansion point. */
  SYMBOLIC_TAYLOR_INEXACT: "SYMBOLIC_TAYLOR_INEXACT",
  /** An algebra verb's variable-name argument not being a bare name. */
  SYMBOLIC_REQUIRES_VARIABLE_NAME: "SYMBOLIC_REQUIRES_VARIABLE_NAME",
  /** `jacobian` called with expressions containing no unknown to differentiate against. */
  SYMBOLIC_JACOBIAN_NO_VARIABLES: "SYMBOLIC_JACOBIAN_NO_VARIABLES",
  /** A finite number whose decimal form could not be read back, which the regex covering every `Number.prototype.toString` output should make unreachable. */
  INTERNAL_RATIONAL_PARSE: "INTERNAL_RATIONAL_PARSE",

  // ── Engine (engine/ExpressionEngine.ts, engine/ExpressionEngineSafety.ts, engine/AsyncResolutionBatcher.ts) ──
  /** A line longer than `validation.maxExpressionLength` characters. Refused before it is read; the host may raise the limit. */
  EXPRESSION_TOO_LONG: "EXPRESSION_TOO_LONG",
  /** A line whose complexity score passes `validation.maxComplexity`. Refused before it is read; the host may raise the limit. */
  EXPRESSION_TOO_COMPLEX: "EXPRESSION_TOO_COMPLEX",
  /** A document with more lines than `performance.maxDocumentLines`. The per-line limits above bound what one line may ask for and say nothing about how many lines there are; two hundred thousand of `1 + 1` exhausted the heap on the line records alone. Recoverable. */
  DOCUMENT_TOO_LARGE: "DOCUMENT_TOO_LARGE",
  /** The normaliser grew a line's tokens past its safety limit. A guard against a rule that expands without end. */
  NORMALIZED_TOKEN_LIMIT_EXCEEDED: "NORMALIZED_TOKEN_LIMIT_EXCEEDED",
  /** The normaliser was still changing the token stream after its pass budget (`maxPasses`, 100 by default): a rule chain that never settles. Reported rather than returning whatever the last pass left. Recoverable. */
  NORMALIZER_PASS_LIMIT_EXCEEDED: "NORMALIZER_PASS_LIMIT_EXCEEDED",
  /** `"=>"` with nothing before it, needs an expression or variable name to solve/simplify. */
  THEREFORE_REQUIRES_EXPRESSION: "THEREFORE_REQUIRES_EXPRESSION",
  /** A `"=>"`-triggered expression called an async plugin (weather/stocks/currency). Same v1 scope restriction as user-function/map-reduce bodies. */
  THEREFORE_ASYNC_UNSUPPORTED: "THEREFORE_ASYNC_UNSUPPORTED",
  /** A compound assignment (`name += expr` / `name -= expr`) with nothing on the right, a line half-typed on the way to `total += 5`. */
  COMPOUND_ASSIGN_REQUIRES_EXPRESSION: "COMPOUND_ASSIGN_REQUIRES_EXPRESSION",
  /** A running total (`+= / -=`) whose right-hand side calls an async plugin (weather/stocks/currency). The same v1 scope restriction as the `"=>"` and user-function bodies. */
  COMPOUND_ASSIGN_ASYNC_UNSUPPORTED: "COMPOUND_ASSIGN_ASYNC_UNSUPPORTED",
  /** A savings-goal contribution period that is not one of daily/weekly/monthly/yearly (`how long to save $X at $Y <period>`). Names the accepted set. */
  UNKNOWN_SAVINGS_PERIOD: "UNKNOWN_SAVINGS_PERIOD",
  /** Colon-separated numbers that are not a time any clock can show ("24:00", "9:60", "100:5"). Raised by the labeled-line fallback, which used to answer them with whatever stood after the colon. */
  INVALID_TIME_LITERAL: "INVALID_TIME_LITERAL",
  /** A live-data form evaluated on an engine whose host switched the network off (`network.enabled: false`, see `constants/Configuration.ts`'s `NetworkConfig`). A recoverable Error value, raised by the VM for a currency conversion with no primed rate and for a plugin function that returned a promise, and by `createQueryResolver`'s plugin function when its preflight was skipped. Names the setting, so the reader knows it is policy rather than an outage. */
  NETWORK_DISABLED: "NETWORK_DISABLED",

  // ── What-if (engine/ExpressionEngine.ts's `whatIf`, engine/WhatIfRun.ts) ──
  /** `engine.whatIf(text, overrides)` was given an override whose name is not a variable name, or whose value is not a finite number, text that evaluates on its own, or a `Value`. Thrown, since it is the host's argument that is wrong rather than a line of the note. */
  WHAT_IF_OVERRIDE_INVALID: "WHAT_IF_OVERRIDE_INVALID",
  /** A what-if overrides a name no line it re-runs mentions, which cannot change any answer and is almost always a misspelling. Thrown by `engine.whatIf`; returned as an Error value by the `line N with ...` and sweep forms. */
  WHAT_IF_INPUT_NOT_USED: "WHAT_IF_INPUT_NOT_USED",
  /** A what-if would re-run a line that sets a `global :name`. A global is shared with every other document in the process, so the scenario's value would reach them; refused rather than re-run. Thrown by `engine.whatIf`; returned as an Error value by the line forms. */
  WHAT_IF_WRITES_GLOBAL: "WHAT_IF_WRITES_GLOBAL",
  // ── Frozen answers (engine/FrozenSuffix.ts, vm/VM.ts, vm/FrozenValues.ts) ──
  /** A line ending `frozen on <day>` whose engine holds no value frozen that day, and the day is not today. A recoverable Error value, raised by the VM in place of running the line: a frozen answer is never fetched again, so the line is refused rather than frozen at today's figure. The message names the day, and the day of the value that is stored when there is one. */
  FROZEN_VALUE_MISSING: "FROZEN_VALUE_MISSING",
  /** `frozen` on a line with no single answer to keep: a function definition, a global cell write, or a definition part-way through the line. Raised at compile time, naming the shape. */
  FROZEN_UNSUPPORTED: "FROZEN_UNSUPPORTED",
  /** `frozen on` followed by something that is not a single date at the end of the line (`frozen on tuesday`, a bare `frozen on`). Raised at compile time, with an example of the form. A day that does not exist (`frozen on 2026-02-30`) reports the date literal's own error instead. */
  FROZEN_DATE_EXPECTED: "FROZEN_DATE_EXPECTED",

  // ── Temporal calendar backend (temporal/TemporalCalendar.ts) ──
  /** `createTemporalCalendar()` was handed something that is not a usable `Temporal` implementation: no `Now.instant`, `Now.timeZoneId`, `Instant.fromEpochMilliseconds` or `PlainDateTime.from`. Raised at construction, naming the missing member, rather than letting the first date computation fail on it obscurely. */
  TEMPORAL_IMPLEMENTATION_INVALID: "TEMPORAL_IMPLEMENTATION_INVALID",
  /** The `timeZone` given to `createTemporalCalendar()` is not one the `Temporal` implementation knows. Raised at construction, so a misspelt zone is a configuration error the host sees once, not a `RangeError` from inside every date the engine computes. */
  TEMPORAL_TIME_ZONE_UNKNOWN: "TEMPORAL_TIME_ZONE_UNKNOWN",

  // ── Calendar backend clocks (calendar/Clock.ts) ──
  /** The clock a host gave a calendar backend (`dateCalendarInZone(zone, { now })`, `createTemporalCalendar(Temporal, { now })`) is not a function, answered something that is not a moment `Date` can hold (`NaN`, an infinity, a number past 8.64e15, not a number), or threw. Not a function is refused when the backend is built; a bad reading is refused on the line that read the clock (`today`, `now`), and the rest of the document goes on (#721, #826). */
  DATE_CLOCK_INVALID: "DATE_CLOCK_INVALID",

  // ── Snapshot / restore (engine/EngineSnapshot.ts, engine/ExpressionEngine.ts) ──
  /** `fromJSON()` handed an object that is not a snapshot at all, or whose serialised-shape version does not match this engine's reader. The versioning gate that refuses an incompatible snapshot clearly rather than restoring it wrongly. See `engine/EngineSnapshot.ts`'s `assertRestorable()`. */
  SNAPSHOT_VERSION_MISMATCH: "SNAPSHOT_VERSION_MISMATCH",
  /** A snapshot with the right envelope but internally inconsistent contents (an unrecognised number sentinel, an unknown value tag). Distinct from a version mismatch: the format is right, the payload is not. */
  SNAPSHOT_MALFORMED: "SNAPSHOT_MALFORMED",
  /** A value the snapshot format cannot yet represent (a symbolic value or matrix cell, a colour, a split, a chart, an IP subnet). `toJSON` catches it and leaves the value out (#665). */
  SNAPSHOT_UNSUPPORTED_VALUE: "SNAPSHOT_UNSUPPORTED_VALUE",
  /** A snapshot calls a plugin function that no package registered on the restoring engine provides. Refused rather than restored, since the call would run whatever sits at its old index (#658). */
  SNAPSHOT_PACKAGE_MISSING: "SNAPSHOT_PACKAGE_MISSING",

  // ── Config (constants/Configuration.ts) ──
  /** A configuration read or write named a path that does not exist. A host configuration fault. */
  CONFIG_PATH_NOT_FOUND: "CONFIG_PATH_NOT_FOUND",
  /** A configuration path not in the `section.property` form. A host configuration fault. */
  INVALID_CONFIG_PATH: "INVALID_CONFIG_PATH",
  /** A configuration path whose section does not exist. A host configuration fault. */
  CONFIG_SECTION_NOT_FOUND: "CONFIG_SECTION_NOT_FOUND",
  /** A configuration path whose property does not exist in its section. A host configuration fault. */
  CONFIG_PROPERTY_NOT_FOUND: "CONFIG_PROPERTY_NOT_FOUND",

  // ── Forms and settings without a catalogue of their own (engine/ExpressionEngine.ts, packages/travel/, packages/web/) ──
  /** `calendar: "temporal"` was asked for on a runtime with no `Temporal`. Refused rather than silently computing on `Date`, because a host that named Temporal did so to be sure what it was computing on. Recoverable. */
  CALENDAR_TEMPORAL_UNAVAILABLE: "CALENDAR_TEMPORAL_UNAVAILABLE",
  /** A trip form (`cost to drive ...`) was written without the `at` that separates its parts. Recoverable. */
  TRIP_EXPECTED_AT: "TRIP_EXPECTED_AT",
  /** A width and a height were written with nothing asked of the pair (`1920x1080` on its own). Recoverable. */
  DIMENSIONS_EXPECTED_FORM: "DIMENSIONS_EXPECTED_FORM",
  /** A `resize` was written without one of its parts: the dimensions, the `to`, the size, or the side it names. Recoverable. */
  RESIZE_EXPECTED_SHAPE: "RESIZE_EXPECTED_SHAPE",

  // ── Registering a package (lexer/ExpressionLexer.ts, api/EngineVersionCompatibility.ts, vm/OpRegistry.ts, vm/VMBuiltins.ts) ──
  /** A package registered an operator the engine already has. Refused at registration, since a built-in operator cannot be overridden. */
  PLUGIN_OPERATOR_COLLISION: "PLUGIN_OPERATOR_COLLISION",
  /** A package registered an operator the scanner cannot read: not exactly two characters, or a first character the scanner does not class as an operator. Refused at registration rather than left to never fire. */
  PLUGIN_OPERATOR_UNSUPPORTED: "PLUGIN_OPERATOR_UNSUPPORTED",
  /** A package registered a keyword the engine already has. Refused at registration, since a built-in keyword cannot be overridden. */
  PLUGIN_KEYWORD_COLLISION: "PLUGIN_KEYWORD_COLLISION",
  /** A package's `callFusions` names a word the engine already reads as something other than a plain word (a keyword, a built-in function, a unit), so the call could never fire. Refused at registration. */
  PLUGIN_CALL_FUSION_UNREACHABLE: "PLUGIN_CALL_FUSION_UNREACHABLE",
  /** A package's `unitAliases` names a word the engine already reads as something other than a plain word (a unit, a keyword, a function), so the alias could never be read. Refused at registration (#762). */
  PLUGIN_UNIT_ALIAS_UNREACHABLE: "PLUGIN_UNIT_ALIAS_UNREACHABLE",
  /** A package's `unitAliases` maps a word to something that is not a single unit the engine reads (`mile`, `days`), so the alias would have nothing to mean. Refused at registration (#762). */
  PLUGIN_UNIT_ALIAS_TARGET_UNKNOWN: "PLUGIN_UNIT_ALIAS_TARGET_UNKNOWN",
  /** A package registered a unit spelling the engine already has. Refused at registration, since a built-in unit cannot be overridden. */
  PLUGIN_UNIT_COLLISION: "PLUGIN_UNIT_COLLISION",
  /** A package's declared `IEnginePackage.engineVersion` semver range doesn't satisfy the running engine's ENGINE_VERSION. See api/EngineVersionCompatibility.ts. */
  PACKAGE_ENGINE_VERSION_MISMATCH: "PACKAGE_ENGINE_VERSION_MISMATCH",
  /** A package's declared `IEnginePackage.engineVersion` isn't a parseable semver range at all (a typo in the package's own descriptor). */
  PACKAGE_ENGINE_VERSION_INVALID_RANGE: "PACKAGE_ENGINE_VERSION_INVALID_RANGE",
  /** A package was registered with no `name`, or an empty one, so nothing could name it to unregister it or report on it (#719). */
  PACKAGE_NAME_MISSING: "PACKAGE_NAME_MISSING",
  /** A package's `createQueryResolver` watches for a plugin function the package does not declare, or was built for another package, so the call it waits for would never come (#719). */
  PACKAGE_RESOLVER_FUNCTION_MISSING: "PACKAGE_RESOLVER_FUNCTION_MISSING",
  /** More packages asked for opcodes of their own than the dynamic opcode range holds. A registration fault. */
  OPCODE_POOL_EXHAUSTED: "OPCODE_POOL_EXHAUSTED",
  /** More plugin functions registered than a compiled call can index (65,536). A registration fault. */
  PLUGIN_FUNCTION_INDEX_POOL_EXHAUSTED: "PLUGIN_FUNCTION_INDEX_POOL_EXHAUSTED",
  /** A plugin function's index past the largest a compiled call can hold (65,535). A registration fault. */
  PLUGIN_FUNCTION_INDEX_TOO_LARGE: "PLUGIN_FUNCTION_INDEX_TOO_LARGE",

  // ── Value contracts: a caller checks isRateUnit() or isTimecodeUnit() first (vm/Value.ts) ──
  /** A rate unit read or built from parts that do not make one: a caller-contract fault inside the engine or a package, or `x/y` where `x` is already a rate. */
  INVALID_RATE_UNIT: "INVALID_RATE_UNIT",
  /** A timecode unit read from a string that is not one. A caller-contract fault inside the engine or a package. */
  INVALID_TIMECODE_UNIT: "INVALID_TIMECODE_UNIT",

  // ── Exact decimals (decimal/Decimal.ts) ──
  /** Text read as an exact decimal that is not one. Raised while a number literal is compiled; the reader fixes the digits. */
  INVALID_DECIMAL_LITERAL: "INVALID_DECIMAL_LITERAL",
  /** An exact decimal division reached the decimal layer with a zero divisor. An engine invariant: the operators refuse a zero divisor first, so this is worth reporting. */
  DECIMAL_DIVISION_BY_ZERO: "DECIMAL_DIVISION_BY_ZERO",
  /** An exact decimal built with a negative or fractional scale. An engine invariant, worth reporting. */
  DECIMAL_INVALID_SCALE: "DECIMAL_INVALID_SCALE",
  /** A power of ten asked for with a negative exponent inside the decimal layer. An engine invariant, worth reporting. */
  DECIMAL_NEGATIVE_POWER: "DECIMAL_NEGATIVE_POWER",

  // ── Units and quantities (vm/VM.ts, vm/VMConversion.ts, vm/UnitAlgebra.ts, vm/QuantityPowers.ts) ──
  /** Two quantities that do not measure the same thing met where they must: `5 kg + 3 m`, `5 kg to m`. The message names both measures. */
  INCOMPATIBLE_UNITS: "INCOMPATIBLE_UNITS",
  /** A conversion or a unit named something that is not a unit (`5 km in mies`). The message offers the nearest spellings where there are any. */
  UNKNOWN_UNIT: "UNKNOWN_UNIT",
  /** A quantity followed by a second unit, as in `5 kg m`: two units side by side are not a unit. The message suggests `in` for a conversion. */
  UNIT_AFTER_UNIT: "UNIT_AFTER_UNIT",
  /** An exponent carrying a unit, as in `2^(3 m)`. The message shows where the unit goes instead. */
  UNIT_IN_EXPONENT: "UNIT_IN_EXPONENT",
  /** A quantity raised to a power that has no unit, as in `2s^2`, or a unit written with a power the table does not spell. Only a length squared or cubed has one. */
  UNIT_POWER_UNSUPPORTED: "UNIT_POWER_UNSUPPORTED",
  /** A square or cube root of a quantity whose root has no unit, as in `sqrt(4 m)`, or of a negative area. */
  UNIT_ROOT_UNSUPPORTED: "UNIT_ROOT_UNSUPPORTED",
  /** Two quantities multiplied into something that is not a unit, as in `$5 * $3`. Lengths multiply into an area or a volume. */
  UNIT_PRODUCT_UNSUPPORTED: "UNIT_PRODUCT_UNSUPPORTED",
  /** Two quantities divided into something that is not a unit: nothing cancels and the result would be a rate of a rate. */
  UNIT_QUOTIENT_UNSUPPORTED: "UNIT_QUOTIENT_UNSUPPORTED",
  /** A number divided by a quantity with no reciprocal unit, such as a temperature. */
  UNIT_RECIPROCAL_UNSUPPORTED: "UNIT_RECIPROCAL_UNSUPPORTED",
  /** Something with no single amount (a list, text, a date) converted to a unit. */
  CONVERT_NON_NUMERIC: "CONVERT_NON_NUMERIC",
  /** Something with no single amount combined with a quantity, as in a list plus `5 m`. */
  QUANTITY_NON_NUMERIC: "QUANTITY_NON_NUMERIC",
  /** A physical constant whose unit the engine cannot spell yet, converted or combined with a quantity. The constant stays a plain number. */
  CONSTANT_UNIT_UNSUPPORTED: "CONSTANT_UNIT_UNSUPPORTED",
  /** A conversion between two currencies with no exchange rate available for the pair. A host with live data may prime a rate and evaluate again. */
  CURRENCY_RATE_UNAVAILABLE: "CURRENCY_RATE_UNAVAILABLE",
  /** A rate built with `/` whose right-hand side has no unit to be per. */
  RATE_MISSING_DENOMINATOR_UNIT: "RATE_MISSING_DENOMINATOR_UNIT",
  /** A rate multiplication whose left-hand side is not a rate. */
  RATE_MUL_LEFT_NOT_A_RATE: "RATE_MUL_LEFT_NOT_A_RATE",
  /** A rate multiplied by a value with no unit matching what the rate is per. */
  RATE_MUL_RIGHT_MISSING_UNIT: "RATE_MUL_RIGHT_MISSING_UNIT",
  /** A rate multiplied by a quantity that measures something else than what the rate is per (`$50/week * 3 kg`). */
  RATE_MUL_MEASURE_MISMATCH: "RATE_MUL_MEASURE_MISMATCH",
  /** A conversion of a rate's denominator applied to a value that is not a rate. */
  RATE_CONVERT_NOT_A_RATE: "RATE_CONVERT_NOT_A_RATE",
  /** A rate's denominator converted to a unit that measures something else (`$50/week in kg`). */
  RATE_CONVERT_MEASURE_MISMATCH: "RATE_CONVERT_MEASURE_MISMATCH",
  /** A value with a tolerance (`5 m +/- 1 cm`) converted to a unit or combined with a quantity: a tolerance is read without its unit. */
  UNCERTAINTY_WITHOUT_UNIT: "UNCERTAINTY_WITHOUT_UNIT",
  /** A tolerance whose unit does not measure what its value does, or that has no rate to reach the value's currency. */
  UNCERTAINTY_UNIT_MISMATCH: "UNCERTAINTY_UNIT_MISMATCH",

  // ── Arithmetic and functions (vm/VM.ts, vm/VMBuiltins.ts, vm/ExactDecimals.ts) ──
  /** Text used in arithmetic with a number, or given to a numeric function (`sqrt("abc")`). The message points at `as number` for text that holds a number. */
  TEXT_ARITHMETIC: "TEXT_ARITHMETIC",
  /** A colour in arithmetic, a numeric function, an order or a conversion to a form of a number (`#ff0000 + 2`, `sqrt(#ff0000)`, `#ff0000 < 3`). A colour is three channels, not one number; the message points at reading a channel out, as in `red(#3366cc)`. */
  COLOUR_ARITHMETIC: "COLOUR_ARITHMETIC",
  /** An IPv6 address in arithmetic, a numeric function, a comparison with a number or a conversion with no whole-number reading (`fe80::1 + 2`). Its 128 bits are past what a number holds exactly; the message points at `as int`. */
  IPV6_ARITHMETIC: "IPV6_ARITHMETIC",
  /** `as number` or `int` given text that is not a number. */
  TEXT_NOT_A_NUMBER: "TEXT_NOT_A_NUMBER",
  /** A remainder with no value: `5 mod 0`, or the remainder of an infinite number. */
  REMAINDER_UNDEFINED: "REMAINDER_UNDEFINED",
  /** A division with no single answer: `0 / 0` (either zero signed), or an infinity over an infinity. `5 / 0` is ∞ and is not refused. */
  QUOTIENT_UNDEFINED: "QUOTIENT_UNDEFINED",
  /** A negative number to a fractional power with no real value, as in `(-1)^0.5`, or a negative number's root of even degree. */
  POWER_NO_REAL_VALUE: "POWER_NO_REAL_VALUE",
  /** A function called outside the numbers it is defined for, such as `ln(0)`. The message names the domain. */
  FUNCTION_DOMAIN: "FUNCTION_DOMAIN",
  /** A function that takes plain numbers given a quantity, as in `sin(1 m)`, or a mix of numbers and quantities. */
  FUNCTION_TAKES_NUMBER: "FUNCTION_TAKES_NUMBER",
  /** `tan` at an odd multiple of a right angle, where the tangent has no value. */
  TRIG_UNDEFINED: "TRIG_UNDEFINED",
  /** A function that counts whole things (`fact`, `nPr`) given a fraction. */
  NOT_WHOLE_NUMBER: "NOT_WHOLE_NUMBER",
  /** A factorial of a negative number or a fraction. */
  INVALID_FACTORIAL_INPUT: "INVALID_FACTORIAL_INPUT",
  /** A factorial past 170!, the largest a double can hold. */
  FACTORIAL_OVERFLOW: "FACTORIAL_OVERFLOW",
  /** A permutation count past the largest number a double can hold. */
  PERMUTATION_OVERFLOW: "PERMUTATION_OVERFLOW",
  /** A combination count past the largest number a double can hold. */
  COMBINATION_OVERFLOW: "COMBINATION_OVERFLOW",
  /** A range given backwards where order matters: a roll from 6 to 1, or a permutation or combination with more chosen than there are. */
  INVALID_RANGE: "INVALID_RANGE",
  /** `gcd` or `lcm` given a number with no whole value (an infinity, or nothing). */
  INVALID_INTEGER_OPERAND: "INVALID_INTEGER_OPERAND",
  /** A number theory function (`factor`, `isprime`, `modpow`) given something that is not a whole number. */
  NUMBER_THEORY_EXPECTED_INTEGER: "NUMBER_THEORY_EXPECTED_INTEGER",
  /** A number theory function given a whole number outside what it is defined for: `factor(0)`, a modulus below 1, a negative exponent. */
  NUMBER_THEORY_DOMAIN: "NUMBER_THEORY_DOMAIN",
  /** `modinv` of a number that shares a factor with the modulus, so no inverse exists. */
  NUMBER_THEORY_NO_INVERSE: "NUMBER_THEORY_NO_INVERSE",
  /** `factor` of a whole number past 2^64, which is refused rather than left to run. */
  FACTOR_TOO_LARGE: "FACTOR_TOO_LARGE",
  /** `proportion` whose first term is zero, so there is nothing to scale by. */
  PROPORTION_DIVIDE_BY_ZERO: "PROPORTION_DIVIDE_BY_ZERO",
  /** A weighted average whose weights add up to zero. */
  WEIGHTED_AVERAGE_ZERO_WEIGHT: "WEIGHTED_AVERAGE_ZERO_WEIGHT",
  /** A standard deviation or variance of a list holding an infinity. */
  STATISTIC_NOT_FINITE: "STATISTIC_NOT_FINITE",
  /** A list aggregate (`total of`, `average of`, a line range) meeting something that is not a number or a quantity. The message names what it found. */
  AGGREGATE_NON_NUMERIC: "AGGREGATE_NON_NUMERIC",
  /** A value written as a percentage that is not a proportion, such as a length. */
  PERCENTAGE_OF_QUANTITY: "PERCENTAGE_OF_QUANTITY",
  /** A value written as a percentage that is not a finite number, which is what a division by zero gives. */
  PERCENTAGE_NOT_FINITE: "PERCENTAGE_NOT_FINITE",
  /** A percentage change from zero, which no percentage reaches. The message suggests the difference instead. */
  PERCENT_CHANGE_FROM_ZERO: "PERCENT_CHANGE_FROM_ZERO",
  /** A percentage change from a negative base, which has two readings. The message shows how to write the one meant. */
  PERCENT_CHANGE_NEGATIVE_BASE: "PERCENT_CHANGE_NEGATIVE_BASE",
  /** A percentage change that could not be worked out from its two values. */
  PERCENT_CHANGE_FAILED: "PERCENT_CHANGE_FAILED",
  /** A rate of interest or inflation that cannot be used: not a percentage, not finite, or at or below -100%. */
  INVALID_RATE: "INVALID_RATE",
  /** A loan or savings term that is not a length of time. */
  INVALID_TERM: "INVALID_TERM",
  /** An inflation adjustment for a year outside the bundled price index. */
  INFLATION_YEAR_OUT_OF_RANGE: "INFLATION_YEAR_OUT_OF_RANGE",
  /** A date moved by a plain number, or by a quantity that is not a length of time, or `to` between a date and something that is not one. The message says what a date moves by. */
  INVALID_DATETIME_OP: "INVALID_DATETIME_OP",
  /** Two video timecodes at different frame rates added or subtracted. */
  TIMECODE_FPS_MISMATCH: "TIMECODE_FPS_MISMATCH",
  /** `as <name>` naming no converter any package registered. */
  UNKNOWN_AS_CONVERTER: "UNKNOWN_AS_CONVERTER",
  /** `float("hello")`, `float(5 km)`: `float` given something with no plain number, text that is not a number or a quantity with a unit. The reader passes a number (#828). */
  FLOAT_TAKES_NUMBER: "FLOAT_TAKES_NUMBER",
  /** `"hello" as multiplier`, `5 km as multiplier`: a multiplier asked of something that is not a plain number or a percentage. The reader converts a number (#829). */
  MULTIPLIER_TAKES_NUMBER: "MULTIPLIER_TAKES_NUMBER",
  /** `as mw`: the target, read regardless of case, could be two units whose prefixes differ only in case (`mW` and `MW`), so it is refused rather than guessed (#824). */
  AS_CONVERTER_AMBIGUOUS_CASE: "AS_CONVERTER_AMBIGUOUS_CASE",
  /** `as MV` when only `mV` is a unit: reading it regardless of case would turn a mega into a milli, so it is refused by name (#824). */
  AS_CONVERTER_PREFIX_CASE: "AS_CONVERTER_PREFIX_CASE",
  /** A plot's range whose ends are not finite numbers. */
  PLOT_INVALID_RANGE: "PLOT_INVALID_RANGE",

  // ── Lists, ranges and matrices (vm/VM.ts, vm/MatrixOps.ts) ──
  /** A range (`0:3`) whose bounds are not plain numbers. */
  INVALID_RANGE_BOUND: "INVALID_RANGE_BOUND",
  /** A range whose bounds are not whole numbers (`0.5:3`). */
  NON_INTEGER_RANGE_BOUND: "NON_INTEGER_RANGE_BOUND",
  /** A range whose first bound is above its second (`5:1`). The message suggests the other order. */
  DESCENDING_RANGE: "DESCENDING_RANGE",
  /** A list or range with more elements than `vm.maxCollectionSize` allows. A safety limit; the host may raise it. */
  COLLECTION_TOO_LARGE: "COLLECTION_TOO_LARGE",
  /** A list cell that is not a number or a quantity: a list inside a list, text, a date. */
  MATRIX_CELL_NON_NUMERIC: "MATRIX_CELL_NON_NUMERIC",
  /** A list whose cells are quantities of different measures (`[1 km, 2 kg]`), or money in two currencies with no rate between them: a list holds one unit. */
  MATRIX_CELL_UNITS_DIFFER: "MATRIX_CELL_UNITS_DIFFER",
  /** A list with a unit given a cell that has no amount in it: a true or false, a percentage or a formula beside a quantity (`[true, 1 km]`). */
  MATRIX_CELL_NO_UNIT: "MATRIX_CELL_NO_UNIT",
  /** A list with a unit in an operation its cells cannot take one by one: multiplied by another quantity, a number divided by it, or a percentage added. */
  MATRIX_UNIT_OPERATION_UNSUPPORTED: "MATRIX_UNIT_OPERATION_UNSUPPORTED",
  /** Matrix algebra on a list with a unit (`det([1 km, 2 km; 3 km, 4 km])`): a determinant, an inverse, a matrix product or power, or a dot product. */
  MATRIX_UNIT_ALGEBRA: "MATRIX_UNIT_ALGEBRA",
  /** Two matrices of shapes that do not fit the operation: added with different shapes, or multiplied where the columns of the first are not the rows of the second. */
  DIMENSION_MISMATCH: "DIMENSION_MISMATCH",
  /** `[...]` indexing or slicing applied to something that is not a matrix. */
  MATRIX_INDEX_NOT_A_MATRIX: "MATRIX_INDEX_NOT_A_MATRIX",
  /** An index or a slice past the edge of the matrix. */
  MATRIX_INDEX_OUT_OF_BOUNDS: "MATRIX_INDEX_OUT_OF_BOUNDS",
  /** A matrix slice whose bounds are not ranges. */
  INVALID_MATRIX_SLICE_BOUND: "INVALID_MATRIX_SLICE_BOUND",
  /** `det` of a matrix that is not square. */
  DETERMINANT_REQUIRES_SQUARE_MATRIX: "DETERMINANT_REQUIRES_SQUARE_MATRIX",
  /** `inv` of a matrix that is not square. */
  INVERSE_REQUIRES_SQUARE_MATRIX: "INVERSE_REQUIRES_SQUARE_MATRIX",
  /** `inv` of a matrix with no inverse: a zero, or nearly zero, pivot. */
  SINGULAR_MATRIX: "SINGULAR_MATRIX",
  /** A matrix raised to a power that is not square. */
  MATRIX_POWER_REQUIRES_SQUARE_MATRIX: "MATRIX_POWER_REQUIRES_SQUARE_MATRIX",
  /** A matrix raised to a power that is not a whole number of 0 or more. `^-1` is the inverse and `^T` the transpose. */
  MATRIX_POWER_REQUIRES_WHOLE_EXPONENT: "MATRIX_POWER_REQUIRES_WHOLE_EXPONENT",
  /** A matrix used as an exponent, or `^` between a matrix and something with no matrix reading. */
  MATRIX_POWER_UNSUPPORTED: "MATRIX_POWER_UNSUPPORTED",
  /** A symbolic matrix inverse larger than the size the symbolic elimination handles. */
  SYMBOLIC_INVERSE_DIMENSION_LIMIT: "SYMBOLIC_INVERSE_DIMENSION_LIMIT",
  /** A symbolic matrix inverse that meets a zero pivot, which the elimination does not reorder around. */
  SYMBOLIC_SINGULAR_OR_UNSUPPORTED_PIVOT: "SYMBOLIC_SINGULAR_OR_UNSUPPORTED_PIVOT",
  /** `map` or `reduce` over something that is not a list or a range. */
  MAP_REDUCE_REQUIRES_COLLECTION: "MAP_REDUCE_REQUIRES_COLLECTION",
  /** `map` over several lists of different lengths. */
  MAP_COLLECTION_LENGTH_MISMATCH: "MAP_COLLECTION_LENGTH_MISMATCH",
  /** `reduce` over an empty list with no starting value. */
  REDUCE_EMPTY_COLLECTION: "REDUCE_EMPTY_COLLECTION",

  // ── Reading other lines (vm/LineReads.ts, engine/ExpressionEngine.ts) ──
  /** A line reference, `total above` or another cross-line form evaluated with no document, as `evaluateExpression` is. Evaluate the line in a document instead. */
  LINE_REF_NO_DOCUMENT: "LINE_REF_NO_DOCUMENT",
  /** A reference to a line below the one reading it, or past the end of the document, which has no answer yet. */
  LINE_NOT_YET_EVALUATED: "LINE_NOT_YET_EVALUATED",
  /** A reference to a line whose own answer is an error. The referenced line is the one to fix. */
  LINE_RESULT_ERROR: "LINE_RESULT_ERROR",
  /** A reference to a line still waiting on live data. It resolves when the data arrives. */
  LINE_RESULT_PENDING: "LINE_RESULT_PENDING",
  /** A line read by another line in the batch pass, when it threw and no code was kept for it. A fallback: the code the line threw is used where there is one. */
  LINE_FAILED: "LINE_FAILED",

  // ── Solving equations for a matrix (engine/ExpressionEngine.ts) ──
  /** A matrix equation (`A * x = b`) naming a factor no line defines yet. */
  EQUATION_FACTOR_UNDEFINED: "EQUATION_FACTOR_UNDEFINED",
  /** A matrix equation whose factor is not a matrix. */
  EQUATION_FACTOR_NOT_MATRIX: "EQUATION_FACTOR_NOT_MATRIX",
  /** A matrix equation whose right-hand side is not a matrix. */
  EQUATION_RHS_NOT_MATRIX: "EQUATION_RHS_NOT_MATRIX",

  // ── Goal seek, as the engine runs it (engine/ExpressionEngine.ts) ──
  /** Goal seek with no document to re-run: the single-expression entry point, or the batch pass, which evaluates each line once. `evaluateDocument` and a live editor solve it. */
  GOAL_SEEK_NO_DOCUMENT: "GOAL_SEEK_NO_DOCUMENT",
  /** Goal seek run from inside another goal seek's re-run, or targeting its own line. Refused, since the re-runs would compound. */
  GOAL_SEEK_NESTED: "GOAL_SEEK_NESTED",
  /** Goal seek targeting a line with no evaluated expression: below it, past the end, or prose. */
  GOAL_SEEK_LINE_NOT_READY: "GOAL_SEEK_LINE_NOT_READY",
  /** Goal seek targeting the line that defines a variable, which a re-run would overwrite. The message says to target the line that uses it. */
  GOAL_SEEK_TARGET_IS_DEFINITION: "GOAL_SEEK_TARGET_IS_DEFINITION",
  /** Goal seek targeting a line that depends on live data, which a re-run cannot fetch. */
  GOAL_SEEK_ASYNC_UNSUPPORTED: "GOAL_SEEK_ASYNC_UNSUPPORTED",
  /** Goal seek whose target line failed while it was being re-run. The message is the line's own. */
  GOAL_SEEK_TARGET_ERROR: "GOAL_SEEK_TARGET_ERROR",

  // ── What-if and sweeps, re-running the document (engine/ExpressionEngine.ts, engine/WhatIfRun.ts) ──
  /** A what-if or a sweep naming a line the document does not have. */
  WHAT_IF_LINE_OUT_OF_RANGE: "WHAT_IF_LINE_OUT_OF_RANGE",
  /** A what-if or a sweep run from inside another one's re-run of the document. */
  WHAT_IF_NESTED: "WHAT_IF_NESTED",
  /** Goal seek targeting a line that holds a what-if or a sweep, whose every probe would re-run the document again. */
  WHAT_IF_IN_GOAL_SEEK: "WHAT_IF_IN_GOAL_SEEK",
  /** A what-if whose target line has no answer with the inputs given. The message is the line's own. */
  WHAT_IF_TARGET_ERROR: "WHAT_IF_TARGET_ERROR",
  /** A what-if targeting prose, a heading or a blank line, which has no answer to work out again. */
  WHAT_IF_TARGET_NOT_A_CALCULATION: "WHAT_IF_TARGET_NOT_A_CALCULATION",
  /** A what-if targeting a line with several inline answers, so there is no one answer to give. */
  WHAT_IF_TARGET_HAS_SEVERAL_ANSWERS: "WHAT_IF_TARGET_HAS_SEVERAL_ANSWERS",
  /** A what-if targeting a line that waits on live data, which a re-run does not fetch. */
  WHAT_IF_LIVE_DATA: "WHAT_IF_LIVE_DATA",

  // ── Live data (engine/ExpressionEngine.ts) ──
  /** A live value that failed to fetch several times in a row, reported rather than retried again. Editing the line tries again. */
  ASYNC_RESOLVER_FAILED: "ASYNC_RESOLVER_FAILED",
  /** `await engine.settle({ timeoutMs })` reached its deadline with live values still being fetched. Rejected rather than resolved, so a caller is never handed a Pending line as if it were settled; the context carries how many were in flight. Recoverable: the lines stay Pending and settle when their fetches land. */
  SETTLE_TIMEOUT: "SETTLE_TIMEOUT",
  /** `engine.settle` was given a `timeoutMs` that is not a finite number of zero or more (a negative, `NaN`, an infinity, text). Rejected, since it is the host's argument that is wrong. */
  SETTLE_TIMEOUT_INVALID: "SETTLE_TIMEOUT_INVALID",

  // ── Per-pass budgets (vm/PassWork.ts) ──
  /** A document pass whose cross-line forms together re-ran more lines than `vm.maxLineRunsPerPass` allows. The line that crossed the budget is refused by name; the host may raise it. */
  PASS_WORK_BUDGET_EXCEEDED: "PASS_WORK_BUDGET_EXCEEDED",
  /** A document whose answers together keep more elements than `vm.maxRetainedElements` allows. The line that crossed it is refused, and a name it assigned is let go. */
  DOCUMENT_ELEMENT_LIMIT_EXCEEDED: "DOCUMENT_ELEMENT_LIMIT_EXCEEDED",

  // ── Fallbacks for a thrown value that is not an EngineError (errors/EngineError.ts) ──
  /** Something other than an `EngineError` was thrown and normalised. Worth reporting: it is an engine or package fault rather than the reader's line. */
  UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
  /** A thrown value that was not an `Error` at all, normalised. Worth reporting, as `UNEXPECTED_ERROR` is. */
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

/** Every error code the engine's own layers can produce, from {@link CoreErrorCodes}. */
export type CoreErrorCode = (typeof CoreErrorCodes)[keyof typeof CoreErrorCodes];

/**
 * Codes for the datetime forms whose failure is raised OUTSIDE the datetime
 * package.
 *
 * These sit here rather than beside the datetime parselets, which is where a
 * package's own code object belongs, because the two sites that raise them are
 * `vm/VM.ts` (the `in <zone>` branch of the unit-conversion opcode) and
 * `calendar/DateCalendar.ts` (the zone-bound backend factory), and neither may
 * import from `packages/`. A code object in the datetime package would put the
 * name a core file needs on the wrong side of that line.
 */
export const DatetimeZoneErrorCodes = {
  /** `2026-04-03 in UTC+25`, `time in UTC-5:60`: a signed offset after `UTC` or `GMT` that no clock keeps (outside UTC-12 to UTC+14, sixty minutes or more, a fraction, or a time of day). An Error value from the VM's `in <zone>` branch, and a parse error from the time package's zone forms, each as that form refuses an unknown zone; both read the offset with `calendar/UtcOffset.ts`'s `tryReadUtcOffset` (#730). */
  TIME_ZONE_OFFSET_OUT_OF_RANGE: "TIME_ZONE_OFFSET_OUT_OF_RANGE",
  /** A date converted `in <name>` where the name is neither a time zone the engine knows nor a unit, as in `2026-04-03 in Atlantis`. The reader checks the zone's spelling. */
  DATETIME_ZONE_UNKNOWN: "DATETIME_ZONE_UNKNOWN",
  /** A date converted `in <unit>` where the name is a real unit that a date has no reading in, as in `2026-04-03 in furlongs`. Separate from `DATETIME_ZONE_UNKNOWN`, since the fix is different. */
  DATETIME_NOT_CONVERTIBLE: "DATETIME_NOT_CONVERTIBLE",
  /** `dateCalendarInZone` given a zone this runtime cannot compute in, as in `"Europe/Atlantis"`. Raised when the host builds the calendar, not per line. */
  DATE_ZONE_UNKNOWN: "DATE_ZONE_UNKNOWN",
  /** `date: { weekend: ["fri"] }`: `date.weekend` or `date.firstDayOfWeek` named something that is not a day of the week. Raised at construction, because a weekend quietly ignored is every working-day answer quietly wrong (#702). */
  DATE_WEEKDAY_INVALID: "DATE_WEEKDAY_INVALID",
} as const;

/** Every code from {@link DatetimeZoneErrorCodes}. */
export type DatetimeZoneErrorCode = (typeof DatetimeZoneErrorCodes)[keyof typeof DatetimeZoneErrorCodes];

/**
 * The aggregated catalog type. Currently `CoreErrorCode` and
 * `DatetimeZoneErrorCode`, union in each package's own code-object type here as
 * Phase 5 converts it, e.g. `CoreErrorCode | WeatherErrorCode | ...`.
 */
export type ErrorCode = CoreErrorCode | DatetimeZoneErrorCode;
