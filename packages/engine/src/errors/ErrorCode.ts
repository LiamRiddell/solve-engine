/**
 * The built-in error-code catalog, one typed const object per domain
 * unioned together here for autocomplete/exhaustiveness in core engine
 * code. Deliberately NOT one central enum: `IEnginePackage` is documented
 * public SDK surface for third-party packages (see `api/PackageRegistry.ts`),
 * and a closed enum would block an external package author from defining
 * their own codes without editing this file. `EngineError.code`'s runtime
 * type stays `string` for exactly that reason. This catalog is for the
 * codes THIS repo owns and wants collision/typo checking on (see
 * `__tests__/errors/ErrorCodeCatalog.spec.ts`), not a hard runtime
 * whitelist.
 *
 * As each package migrates to `Result<void, EngineError>` (see this
 * session's error-handling-refactor plan, Phase 5), it should export its
 * own small `XxxErrorCodes` const object co-located with its parselets
 * exactly like `CoreErrorCodes` below, just scoped to one domain, and get
 * unioned into `ErrorCode` here. Until a package migrates, its existing
 * free-string codes keep working (ErrorFactory accepts any string); they
 * just aren't caught by the catalog's uniqueness/orphan checks yet.
 */

/**
 * Codes used directly by the parser/VM/engine/errors layers themselves
 * confirmed against the current source, not aspirational. Grouped by
 * pipeline stage via the comments, not a naming prefix (these predate any
 * naming convention and renaming them is out of scope for introducing the
 * catalog, only NEW codes need to follow a scoped/prefixed style, see
 * `STACK_UNDERFLOW` etc. below).
 */
export const CoreErrorCodes = {
  // ── Parser (parser/PrecedenceParser.ts, parser/BytecodeBuilder.ts, parser/PhrasePattern.ts) ──
  INVALID_NUMBER_LITERAL: "INVALID_NUMBER_LITERAL",
  /** A `"` that never meets its closing partner (`lexer/ExpressionLexer.ts`'s `tokenizeString()`). Previously the tokenizer ran off the end of the input and returned what it had, so `"abc` lexed to an ordinary String and an unterminated literal was indistinguishable from a terminated one. */
  UNTERMINATED_STRING: "UNTERMINATED_STRING",
  NO_PREFIX_PARSELET: "NO_PREFIX_PARSELET",
  UNEXPECTED_END_OF_INPUT: "UNEXPECTED_END_OF_INPUT",
  UNEXPECTED_TOKEN_TYPE: "UNEXPECTED_TOKEN_TYPE",
  NESTING_DEPTH_EXCEEDED: "NESTING_DEPTH_EXCEEDED",
  UNEXPECTED_END: "UNEXPECTED_END",
  UNEXPECTED_TRAILING_TOKEN: "UNEXPECTED_TRAILING_TOKEN",
  PARSE_ERROR: "PARSE_ERROR",
  TOO_MANY_NUMERIC_CONSTANTS: "TOO_MANY_NUMERIC_CONSTANTS",
  TOO_MANY_STRING_CONSTANTS: "TOO_MANY_STRING_CONSTANTS",
  NO_MATCHING_PHRASE_ALTERNATIVE: "NO_MATCHING_PHRASE_ALTERNATIVE",
  INVALID_PHRASE_PATTERN: "INVALID_PHRASE_PATTERN",
  PHRASE_KEYWORD_MISMATCH: "PHRASE_KEYWORD_MISMATCH",
  /** User-defined-function definition parsing (`f(x, y) = ...`), an invalid token where a parameter name was expected. */
  USER_FUNCTION_INVALID_PARAM_NAME: "USER_FUNCTION_INVALID_PARAM_NAME",
  /** `f() = ...` with zero parameters, indistinguishable from a plain no-arg function call, so rejected at definition time. */
  USER_FUNCTION_NO_PARAMS: "USER_FUNCTION_NO_PARAMS",
  /** A user-defined function body calling an async plugin (weather/stocks/currency/...), rejected at definition time; v1 scope excludes async function bodies. */
  FUNCTION_BODY_MUST_BE_SYNCHRONOUS: "FUNCTION_BODY_MUST_BE_SYNCHRONOUS",
  /** `BytecodeBuilder`'s `userFunctionBodies` side-table exceeding its capacity. Same class as `TOO_MANY_NUMERIC_CONSTANTS`/`TOO_MANY_STRING_CONSTANTS` below. */
  TOO_MANY_FUNCTION_DEFINITIONS: "TOO_MANY_FUNCTION_DEFINITIONS",
  /** `BytecodeBuilder`'s `anonymousBodies` side-table (map/reduce inline transform bodies) exceeding its capacity. Same class as `TOO_MANY_FUNCTION_DEFINITIONS` above. */
  TOO_MANY_ANONYMOUS_BODIES: "TOO_MANY_ANONYMOUS_BODIES",

  // ── VM (vm/VM.ts, vm/OpRegistry.ts, vm/VMBuiltins.ts) ──
  EVALUATION_ERROR: "EVALUATION_ERROR",
  INSTRUCTION_LIMIT_EXCEEDED: "INSTRUCTION_LIMIT_EXCEEDED",
  STACK_LIMIT_EXCEEDED: "STACK_LIMIT_EXCEEDED",
  /** One evaluation asking for more elements (collection Values, matrix cells) than `vm.maxAllocatedElements` allows. The counter the two limits above cannot be: both are checked between opcodes, so neither can see what a single opcode allocates inside a loop of its own. See `vm/AllocationBudget.ts`. Recoverable, since it describes this expression rather than the engine. */
  ALLOCATION_LIMIT_EXCEEDED: "ALLOCATION_LIMIT_EXCEEDED",
  /** New this phase. See `VM.ts`'s `safePop()`: a stack-underflow (corrupted bytecode, a buggy plugin) is now a controlled EngineError instead of a raw TypeError. Category INTERNAL, since it is an engine or plugin fault rather than a typed line, but recoverable: it happened on one line and the engine is still usable. */
  STACK_UNDERFLOW: "STACK_UNDERFLOW",
  UNDEFINED_VARIABLE: "UNDEFINED_VARIABLE",
  /** New this phase, the Tier-2/`LOAD_GLOBAL_VAR` hardening: a global variable read before its async preflight resolved, surfaced as a controlled error instead of pushing `undefined`. */
  GLOBAL_VARIABLE_NOT_RESOLVED: "GLOBAL_VARIABLE_NOT_RESOLVED",
  UNKNOWN_FUNCTION: "UNKNOWN_FUNCTION",
  /** `unwrapEvalResult()`'s pending-when-expecting-value case, a caller-contract violation, not user-input. */
  UNEXPECTED_PENDING_RESULT: "UNEXPECTED_PENDING_RESULT",
  /** User-defined-function call/definition errors (`CALL_USER_FUNCTION`/`DEFINE_USER_FUNCTION` opcodes), calling a name with no matching definition, calling with the wrong argument count, and the deliberate v1 restriction that a function body can't itself contain async work. */
  UNDEFINED_FUNCTION: "UNDEFINED_FUNCTION",
  FUNCTION_ARITY_MISMATCH: "FUNCTION_ARITY_MISMATCH",
  /** The same mistake against a BUILT-IN rather than a user-defined function (`sqrt()`, `atan2(1)`, `sqrt(1,2,3)`). Separate from `FUNCTION_ARITY_MISMATCH` above because the two are raised by different opcodes and a host may want to word them differently. Checked at the `CALL_BUILTIN` dispatch against `vm/VMBuiltinArity.ts`; recoverable, since it is a typo in the line, not an engine fault. */
  BUILTIN_ARITY_MISMATCH: "BUILTIN_ARITY_MISMATCH",
  USER_FUNCTION_ASYNC_UNSUPPORTED: "USER_FUNCTION_ASYNC_UNSUPPORTED",
  /** A map/reduce transform body (inline expression or user-defined function) calling an async plugin. Same v1 scope restriction as `USER_FUNCTION_ASYNC_UNSUPPORTED` above, enforced both at parse time (`MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS`, packages/mapreduce/) and as a defense-in-depth runtime backstop here. */
  MAP_REDUCE_ASYNC_UNSUPPORTED: "MAP_REDUCE_ASYNC_UNSUPPORTED",
  /** An algebra verb's expression argument (`BIND_UNKNOWN`'s body) calling an async plugin. Same v1 scope restriction as the two above, and likewise refused at parse time first (`SYMBOLIC_ARGUMENT_MUST_BE_SYNCHRONOUS`, packages/symbolic/). */
  SYMBOLIC_ASYNC_UNSUPPORTED: "SYMBOLIC_ASYNC_UNSUPPORTED",
  /** `pushCallFrame()`'s recursion guard, a nested `CALL_USER_FUNCTION` re-enters `executeBytecode()`, so `maxInstructions` alone can't catch e.g. `f(x) = f(x)`; this is the dedicated backstop. `recoverable: true` (the default for `.execution()`), ordinary user-written infinite recursion, not an engine bug; the guard exists precisely so it surfaces as a clear error instead of overflowing the native call stack uncatchably. */
  FUNCTION_RECURSION_LIMIT_EXCEEDED: "FUNCTION_RECURSION_LIMIT_EXCEEDED",
  /** The companion to the code above, and the half it could never see: how MANY user-defined-function calls one evaluation makes, rather than how deeply they nest. A twenty-two-line doubling chain nests twenty-two deep (legal) and makes two million calls (a fatal heap abort). Counted in `vm/AllocationBudget.ts`, because the tally has to survive `executeBytecode()` re-entering itself. Recoverable. */
  FUNCTION_CALL_LIMIT_EXCEEDED: "FUNCTION_CALL_LIMIT_EXCEEDED",
  /** A `<date> + N workdays` offset outside `date.maxOffsetYears`/`minOffsetYears`. Workdays are the one date offset that walks the calendar a day at a time, so the one whose cost is the offset; every other one moves a Date field once. Recoverable. */
  DATE_OFFSET_LIMIT_EXCEEDED: "DATE_OFFSET_LIMIT_EXCEEDED",
  /** The anchor of `N working days after/before/from <expr>` was not a date (e.g. `5 working days after 3`). The grammar guarantees the count is a number, so this only fires on the anchor. Emitted as a recoverable Error value, not thrown, matching the datetime package's other type guards. See `vm/VM.ts`'s `DATE_WORKDAY_OFFSET` case. */
  WORKDAY_OFFSET_EXPECTED_DATE: "WORKDAY_OFFSET_EXPECTED_DATE",
  /** An endpoint of `working days between <expr> and <expr>` was not a date. Recoverable Error value. See `vm/VM.ts`'s `DATE_WORKDAYS_BETWEEN` case. */
  WORKDAYS_BETWEEN_EXPECTED_DATES: "WORKDAYS_BETWEEN_EXPECTED_DATES",
  /** The two endpoints of `working days between <expr> and <expr>` are further apart than `date.maxOffsetYears`/`minOffsetYears` allow the count's calendar walk to run. Recoverable Error value, the between-count's equivalent of `DATE_OFFSET_LIMIT_EXCEEDED`. See `vm/VM.ts`'s `DATE_WORKDAYS_BETWEEN` case. */
  WORKDAYS_BETWEEN_RANGE_TOO_LARGE: "WORKDAYS_BETWEEN_RANGE_TOO_LARGE",
  /** A `<<`/`>>` with a bigint operand whose exact result would pass `MAX_EXACT_SHIFT_BITS`, whichever operand is the bigint. Both spellings refuse as of 1.0.0: a bigint on the left used to fall through to `x * 2^n` in doubles and report a 19,870-digit integer as Infinity. See `vm/VM.ts`'s `bigIntShift()`. Recoverable. */
  BIGINT_SHIFT_LIMIT_EXCEEDED: "BIGINT_SHIFT_LIMIT_EXCEEDED",
  /** The same ceiling for `^`, the operator it was written for: `2n ^ 100000` asks for the same 100,001-bit integer `1n << 100000` does, so the two spellings answer the same way. Also new in 1.0.0, and for the same reason: this used to fall through to the double path and answer Infinity. A fractional or negative exponent (`4n ^ 0.5`, `2n ^ -1`) has no exact answer to bound and still uses the double path. See `vm/VM.ts`'s `MAX_EXACT_POW_BITS`. Recoverable. */
  BIGINT_POW_LIMIT_EXCEEDED: "BIGINT_POW_LIMIT_EXCEEDED",
  /** An operand with no whole-number form (a fraction, an infinity, a NaN) meeting a bigint: `1n + 0.5`, `1n & 1.5`, `5n/pi`. `BigInt()` answers those with a raw RangeError, which the VM relabelled UNEXPECTED_ERROR, so a typo in the line was reported as an engine fault. Recoverable; see `vm/VMConversion.ts`'s `toBigIntOperand()`. */
  BIGINT_INEXACT_OPERAND: "BIGINT_INEXACT_OPERAND",
  /** `10n / 0n` and `10n mod 0n`. Deliberately NOT what `1 / 0` does, which is Infinity: a bigint division is exact integer division (`7n / 2n` is 3n), and integer division by zero has no answer, exactly as it has none in C, Java, Python or JavaScript's own BigInt. Previously V8's own RangeError, relabelled UNEXPECTED_ERROR. Recoverable; see `vm/VMConversion.ts`'s `bigIntDivisionByZero()`. */
  BIGINT_DIVISION_BY_ZERO: "BIGINT_DIVISION_BY_ZERO",
  /** `DEFINE_USER_FUNCTION`'s body-index lookup failing, a compiler/VM invariant violation (the opcode stream referenced a `userFunctionBodies` slot that doesn't exist), never a user-input error. */
  INTERNAL_MISSING_FUNCTION_BODY: "INTERNAL_MISSING_FUNCTION_BODY",
  /** `MAP_INVOKE`/`REDUCE_INVOKE`'s anonymous-body-index lookup failing. Same class as `INTERNAL_MISSING_FUNCTION_BODY` above, for the `anonymousBodies` side-table instead of `userFunctionBodies`. */
  INTERNAL_MISSING_ANONYMOUS_BODY: "INTERNAL_MISSING_ANONYMOUS_BODY",

  // ── Malformed bytecode on the public `./vm` surface (vm/VM.ts) ──
  //
  // `executeBytecode` is exported, so a bytecode program is caller input in
  // the same sense an expression string is, and these five say so. They are
  // VALIDATION rather than INTERNAL for exactly that reason: before they
  // existed, every one of these cases reached a raw TypeError (`BigInt(undefined)`,
  // `code.toUpperCase()` on a boolean, destructuring a program that was not
  // there), which normalised to UNEXPECTED_ERROR and told the caller the
  // engine was broken when their eleven bytes were. Reachable from ordinary
  // source only through a compiler bug, which is why the messages name the
  // opcode and the operand rather than the user's line.
  /** An operand byte read past the end of the stream: the program ends in the middle of an instruction. */
  MALFORMED_BYTECODE_TRUNCATED: "MALFORMED_BYTECODE_TRUNCATED",
  /** A constant-pool operand indexing a `numbers`/`strings` entry that does not exist, or that is not of the pool's type. */
  MALFORMED_BYTECODE_CONSTANT_INDEX: "MALFORMED_BYTECODE_CONSTANT_INDEX",
  /** A unit or converter name read off the value stack that is not a string. Distinct from the pool case above: the operand is a Value another opcode pushed, not a pool entry. */
  MALFORMED_BYTECODE_OPERAND_TYPE: "MALFORMED_BYTECODE_OPERAND_TYPE",
  /** `MAP_INVOKE`/`REDUCE_INVOKE` carrying a body kind other than 0/1/2. Used to fall through every arm with no body and recurse into `executeBytecode(undefined)`. */
  MALFORMED_BYTECODE_BODY_KIND: "MALFORMED_BYTECODE_BODY_KIND",
  /** A `PUSH_BIGINT` pool entry that is not a whole number, e.g. `"1.000"`. `BigInt()` answers that with a raw SyntaxError. */
  MALFORMED_BYTECODE_BIGINT_LITERAL: "MALFORMED_BYTECODE_BIGINT_LITERAL",
  /** `executeBytecode()` called with something that is not a runnable program at all. Checked before the destructure that used to throw outside the function's own try/catch. */
  MALFORMED_BYTECODE_PROGRAM: "MALFORMED_BYTECODE_PROGRAM",

  // ── Symbolic algebra (symbolic/, vm/SymbolicOps.ts) ──
  /** A coefficient grew past `RATIONAL_MAX_BITS`, e.g. repeated exact elimination multiplying denominators together. */
  SYMBOLIC_RATIONAL_OVERFLOW: "SYMBOLIC_RATIONAL_OVERFLOW",
  /** `NaN` or `±Infinity` reaching a symbolic expression, neither of which has an exact rational value. */
  SYMBOLIC_NONFINITE_OPERAND: "SYMBOLIC_NONFINITE_OPERAND",
  /** Division by an exactly-zero rational. Exact, unlike the double comparison it replaced, which could not distinguish a true zero from `5.551e-17`. */
  SYMBOLIC_DIVISION_BY_ZERO: "SYMBOLIC_DIVISION_BY_ZERO",
  /** A tree exceeding `SYMBOLIC_MAX_NODES` entering the simplifier. */
  SYMBOLIC_NODE_LIMIT_EXCEEDED: "SYMBOLIC_NODE_LIMIT_EXCEEDED",
  /** A builtin with no symbolic reading (`min`, `random`, the finance block, ...) applied to an expression still containing an unknown. Returned rather than computing against `toNumber()`'s placeholder zero. */
  SYMBOLIC_UNSUPPORTED_FUNCTION: "SYMBOLIC_UNSUPPORTED_FUNCTION",
  /** The rational-root search exceeding `FACTOR_MAX_ROOT_CANDIDATES`. The candidate set is the product of two divisor sets, so a highly-composite coefficient escapes quickly. */
  SYMBOLIC_FACTOR_LIMIT_EXCEEDED: "SYMBOLIC_FACTOR_LIMIT_EXCEEDED",
  /** An equation outside what the solver attempts: not a polynomial, above the degree ceiling, or non-linear in the unknown while another unknown is present. */
  SYMBOLIC_SOLVE_UNSUPPORTED: "SYMBOLIC_SOLVE_UNSUPPORTED",
  /** Some but not all of an equation's roots were found. Reported rather than returned, because a partial list of roots looks exactly like a complete one. */
  SYMBOLIC_SOLVE_INCOMPLETE: "SYMBOLIC_SOLVE_INCOMPLETE",
  /** `solve`'s second argument not being a bare name. */
  SOLVE_REQUIRES_VARIABLE_NAME: "SOLVE_REQUIRES_VARIABLE_NAME",
  /** A derivative order outside 0..`DERIVATIVE_MAX_ORDER`. */
  SYMBOLIC_DERIVATIVE_ORDER_LIMIT: "SYMBOLIC_DERIVATIVE_ORDER_LIMIT",
  /** An expression with no known elementary antiderivative. Reported rather than approximated, since a wrong integral is indistinguishable from a right one at the point of use. */
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
  EXPRESSION_TOO_LONG: "EXPRESSION_TOO_LONG",
  EXPRESSION_TOO_COMPLEX: "EXPRESSION_TOO_COMPLEX",
  /** A document with more lines than `performance.maxDocumentLines`. The per-line limits above bound what one line may ask for and say nothing about how many lines there are; two hundred thousand of `1 + 1` exhausted the heap on the line records alone. Recoverable. */
  DOCUMENT_TOO_LARGE: "DOCUMENT_TOO_LARGE",
  NORMALIZED_TOKEN_LIMIT_EXCEEDED: "NORMALIZED_TOKEN_LIMIT_EXCEEDED",
  /** `"=>"` with nothing before it, needs an expression or variable name to solve/simplify. */
  THEREFORE_REQUIRES_EXPRESSION: "THEREFORE_REQUIRES_EXPRESSION",
  /** A `"=>"`-triggered expression called an async plugin (weather/stocks/currency). Same v1 scope restriction as user-function/map-reduce bodies. */
  THEREFORE_ASYNC_UNSUPPORTED: "THEREFORE_ASYNC_UNSUPPORTED",
  /** Colon-separated numbers that are not a time any clock can show ("24:00", "9:60", "100:5"). Raised by the labeled-line fallback, which used to answer them with whatever stood after the colon. */
  INVALID_TIME_LITERAL: "INVALID_TIME_LITERAL",

  // ── Config (constants/Configuration.ts) ──
  CONFIG_PATH_NOT_FOUND: "CONFIG_PATH_NOT_FOUND",
  INVALID_CONFIG_PATH: "INVALID_CONFIG_PATH",
  CONFIG_SECTION_NOT_FOUND: "CONFIG_SECTION_NOT_FOUND",
  CONFIG_PROPERTY_NOT_FOUND: "CONFIG_PROPERTY_NOT_FOUND",

  // ── Package/lexer registration-time collisions (lexer/ExpressionLexer.ts) ──
  PLUGIN_OPERATOR_COLLISION: "PLUGIN_OPERATOR_COLLISION",
  PLUGIN_KEYWORD_COLLISION: "PLUGIN_KEYWORD_COLLISION",
  PLUGIN_UNIT_COLLISION: "PLUGIN_UNIT_COLLISION",
  /** A package's declared `IEnginePackage.engineVersion` semver range doesn't satisfy the running engine's ENGINE_VERSION. See api/EngineVersionCompatibility.ts. */
  PACKAGE_ENGINE_VERSION_MISMATCH: "PACKAGE_ENGINE_VERSION_MISMATCH",
  /** A package's declared `IEnginePackage.engineVersion` isn't a parseable semver range at all (a typo in the package's own descriptor). */
  PACKAGE_ENGINE_VERSION_INVALID_RANGE: "PACKAGE_ENGINE_VERSION_INVALID_RANGE",
  /** `OpRegistry.allocateOpcode()`'s dynamic opcode pool (started at 201) exhausted, too many packages calling it. */
  OPCODE_POOL_EXHAUSTED: "OPCODE_POOL_EXHAUSTED",
  /** `VMBuiltins.allocatePluginFunctionIndex()`'s 0-255 index pool (a single opcode-stream byte) exhausted. */
  PLUGIN_FUNCTION_INDEX_POOL_EXHAUSTED: "PLUGIN_FUNCTION_INDEX_POOL_EXHAUSTED",

  // ── vm/Value.ts caller-contract violations (check isRateUnit()/isTimecodeUnit() first) ──
  INVALID_RATE_UNIT: "INVALID_RATE_UNIT",
  INVALID_TIMECODE_UNIT: "INVALID_TIMECODE_UNIT",

  // ── errors/EngineError.ts's own fallback normalization ──
  UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

/** Every error code the engine's own layers can produce, from {@link CoreErrorCodes}. */
export type CoreErrorCode = (typeof CoreErrorCodes)[keyof typeof CoreErrorCodes];

/**
 * The aggregated catalog type. Currently just `CoreErrorCode`, union in
 * each package's own code-object type here as Phase 5 converts it, e.g.
 * `CoreErrorCode | WeatherErrorCode | StocksErrorCode | ...`.
 */
export type ErrorCode = CoreErrorCode;
