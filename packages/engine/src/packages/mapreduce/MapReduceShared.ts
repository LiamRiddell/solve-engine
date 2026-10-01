import { Parser } from "@solve-js/parser/Parser";
import { BytecodeBuilder, type BytecodeProgram } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { builtinNameToIndex } from "@solve-js/packages/function/parselets/FunctionCallParselet";
import type { Token } from "@solve-js/lexer/Token";
import { textOf } from "@solve-js/engine/ColonLabel";

/**
 * A resolved `map`/`reduce` transform, the first argument to either call.
 * `kind` matches the `MAP_INVOKE`/`REDUCE_INVOKE` opcode's own operand
 * (see `vm/VM.ts`'s handlers): 0 = an inline anonymous body (compiled to
 * its own independent `BytecodeProgram`, registered via
 * `BytecodeBuilder.emitAnonymousBody()`), 1 = a builtin function (resolved
 * at PARSE time against `FunctionCallParselet`'s own name table), 2 = a
 * user-defined function (deferred to RUNTIME, resolved dynamically via
 * `vm.getUserFunction()`, since it may be defined later in the document,
 * mirroring `CALL_USER_FUNCTION`'s own forward-reference philosophy).
 */
export type TransformSpec =
  | { kind: 0; program: BytecodeProgram }
  | { kind: 1; builtinIdx: number }
  | { kind: 2; name: string };

/**
 * Parses `map`/`reduce`'s first argument, the "transform", disambiguating
 * a bare function-name reference from a genuine inline expression.
 *
 * SCOPE NOTE: a bare single identifier immediately followed by a comma is
 * ALWAYS interpreted as a function-name reference (builtin if known,
 * otherwise deferred as a user-defined-function reference), NEVER as the
 * trivial "identity" inline expression that's just that one variable.
 * Every spec example uses a genuine multi-token expression (`10*x`,
 * `acc+x`) for the inline form, so this keeps the two cases unambiguous
 * with no fuzzy runtime fallback heuristics needed. The one real cost:
 * you can't write `map(x, [1,2,3])` to mean an identity map, a vanishingly
 * rare thing to want (why not just use the array directly?), and not
 * something any spec example shows.
 */
export function parseTransform(parser: Parser, builder: BytecodeBuilder): TransformSpec {
  const next = parser.peek();
  const afterNext = parser.peekAt(1);
  if (next && (next.type === "IDENT" || next.type === "UNIT" || next.type === "FUNC") && afterNext?.type === "COMMA") {
    parser.consume();
    const name = next.value;
    const builtinIdx = Object.prototype.hasOwnProperty.call(builtinNameToIndex, name.toLowerCase()) ? builtinNameToIndex[name.toLowerCase()] : undefined;
    if (builtinIdx !== undefined) {
      return { kind: 1, builtinIdx };
    }
    return { kind: 2, name };
  }

  // Genuine inline expression, compiled into its OWN independent
  // BytecodeProgram, exactly like a user-defined function's body
  // (PrecedenceParser.ts's parseUserFunctionDefinition): parseExpression()
  // sets `this.builder` to the isolated builder with NO automatic
  // restore, so setBuilder(builder) explicitly restores it afterward.
  const transformBuilder = new BytecodeBuilder(builder.pluginIndexMap);
  parser.parseExpression(BindingPower.Lowest, transformBuilder);
  parser.setBuilder(builder);
  const program = transformBuilder.build();
  if (program.hasAsync) {
    throw ErrorFactory.parsing(
      "MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS",
      `map/reduce transform expressions must be synchronous (no weather/stocks/currency calls).`,
    );
  }
  return { kind: 0, program };
}

/** Whether the upcoming argument uses the explicit zipped `name=collection` form (peek-only, nothing consumed). */
export function isZippedCollectionForm(parser: Parser): boolean {
  const next = parser.peek();
  const afterNext = parser.peekAt(1);
  return !!next && (next.type === "IDENT" || next.type === "UNIT") && afterNext?.type === "EQUALS";
}

/** Consumes a zipped-form collection name (`name` in `name=collection`). */
export function consumeCollectionName(parser: Parser): string {
  const token = parser.peek();
  if (token && (token.type === "IDENT" || token.type === "UNIT")) {
    parser.consume();
    return token.value;
  }
  throw ErrorFactory.parsing(
    "MAP_REDUCE_EXPECTED_COLLECTION_NAME",
    `Expected a collection name (e.g. "x" in "x=[1,2,3]") but got ${token ? `"${token.value}"` : "end of input"}.`,
  );
}

/**
 * Parses one "collection" argument, a plain expression, or `expr : expr`
 * for a bare Range (`map(f, 0:3)`'s own spec example), hand-consuming the
 * `:` locally exactly like `MatrixIndexParselet` does, for the same
 * reason: a general infix COLON operator would break the shipped
 * labeled-line fallback feature (see that parselet's own doc comment for
 * the full explanation).
 */
export function parseCollectionExpr(parser: Parser, builder: BytecodeBuilder): void {
  const first = parser.peek();
  parser.parseExpression(0, builder);
  if (parser.match("COLON")) {
    // The first side ends on the token before the colon just matched.
    const minSide = tokensBack(parser, first, 2);
    const secondFirst = parser.peek();
    parser.parseExpression(0, builder);
    emitRange(builder, minSide, tokensBack(parser, secondFirst, 1));
  }
}

/** The most tokens of one range side whose text a refusal keeps. */
export const MAX_WRITTEN_TOKENS = 64;

/**
 * The tokens of one side of a range, read back from the parser's position to
 * the side's first token, in line order.
 *
 * @param parser - The parser, just past the side (and `skip - 1` tokens more).
 * @param first - The side's first token, as `peek()` gave it before the side was parsed.
 * @param skip - How far back the side's last token is: 1 for the token just consumed.
 * @returns The side's tokens, or null when `first` is not found within
 *   {@link MAX_WRITTEN_TOKENS} tokens (a side too long to quote).
 */
export function tokensBack(parser: Parser, first: Token | undefined, skip: number): Token[] | null {
  if (first === undefined) return null;
  const side: Token[] = [];
  for (let i = skip; i < skip + MAX_WRITTEN_TOKENS; i++) {
    const token = parser.peekAt(-i);
    if (token === undefined) return null;
    side.push(token);
    if (token === first) return side.reverse();
  }
  return null;
}

/**
 * Whether a side is written as one plain whole number, `5`, the way the
 * refusal's number already says it, its thousands grouped or not (`1,000` is
 * the number 1000, as `1000` is). `05` and `5.0` are not: the refusal quotes
 * them as written.
 *
 * @param side - The side's tokens, or null when not kept.
 * @returns `true` for a single token written `0` or a whole number with no leading zero.
 */
export function isPlainNumber(side: readonly Token[] | null): boolean {
  return side !== null && side.length === 1 && side[0].type === "NUMBER" && /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(side[0].text);
}

/**
 * Emits the range of the two sides on the stack: `RANGE_NEW` when both are
 * written as plain whole numbers (`1:5`), otherwise `RANGE_NEW_WRITTEN` with
 * each side's text, so a refusal names the bounds the way the reader wrote
 * them (`1 + 24:00`) rather than only as the numbers they came to.
 *
 * @param builder - The builder to emit into.
 * @param minSide - The first side's tokens, or null when not kept.
 * @param maxSide - The second side's tokens, or null when not kept.
 */
export function emitRange(builder: BytecodeBuilder, minSide: readonly Token[] | null, maxSide: readonly Token[] | null): void {
  if (isPlainNumber(minSide) && isPlainNumber(maxSide)) {
    builder.emitOpcode(OpCode.RANGE_NEW);
    return;
  }
  builder.emitOpcode(OpCode.RANGE_NEW_WRITTEN);
  builder.emitString(minSide === null ? "" : textOf(minSide) ?? "");
  builder.emitString(maxSide === null ? "" : textOf(maxSide) ?? "");
}

/** The token kinds that open and close a nesting level inside a call's brackets. */
const OPENERS = new Set(["LPAREN", "LBRACKET"]);
const CLOSERS = new Set(["RPAREN", "RBRACKET"]);

/**
 * Whether the call whose `(` was just consumed has a comma of its own, at its
 * own nesting level, before its closing bracket. Peek-only: nothing is consumed.
 *
 * `sum(x, 1:3)` has one and `sum(1:3)` has none; a comma inside a list or a
 * nested call (`sum([1, 2])`, `sum(max(1, 2), [3])`) belongs to that and is not
 * counted. The scan stops at the call's own `)` or at the end of the line, so
 * it reads each token of the call at most once.
 *
 * @param parser - The parser, positioned just after the call's `(`.
 * @returns True when the call has two or more arguments.
 */
export function callHasOwnComma(parser: Parser): boolean {
  let depth = 0;
  for (let i = 0; ; i++) {
    const token = parser.peekAt(i);
    if (token === undefined) return false;
    if (OPENERS.has(token.type)) depth++;
    else if (CLOSERS.has(token.type)) {
      if (depth === 0) return false;
      depth--;
    } else if (depth === 0 && token.type === "COMMA") return true;
  }
}

/**
 * The one-argument fold, `sum(1:3)` or `prod([2, 3, 4])`: the elements of the
 * collection themselves, added or multiplied, as `sum(x, 1:3)` and
 * `prod(x, [2, 3, 4])` are. The `(` is already consumed; this parses the
 * collection (a range, a list or a name holding one), the `)`, the seed and the
 * fold.
 *
 * @param parser - The parser, positioned just after the call's `(`.
 * @param builder - The builder the call is emitted into.
 * @param combine - `ADD` for `sum`, `MUL` for `prod`.
 * @param seed - The identity the fold starts from: 0 for `sum`, 1 for `prod`.
 * @param form - `ReduceForm.sum` or `ReduceForm.prod`, so a refusal names the word typed.
 */
export function parseElementFold(parser: Parser, builder: BytecodeBuilder, combine: OpCode.ADD | OpCode.MUL, seed: number, form: number): void {
  const body = new BytecodeBuilder(builder.pluginIndexMap);
  body.emitOpcode(OpCode.LOAD_VAR);
  body.emitString("acc");
  body.emitOpcode(OpCode.LOAD_VAR);
  body.emitString("x");
  body.emitOpcode(combine);
  const program = body.build();
  parseCollectionExpr(parser, builder);
  parser.consume("RPAREN");
  builder.emitOpcode(OpCode.PUSH_NUMBER);
  builder.emitNumber(seed);
  emitInvoke(builder, OpCode.REDUCE_INVOKE, { kind: 0, program }, ["acc", "x"], form);
}

/**
 * Emits a resolved transform + its `MAP_INVOKE`/`REDUCE_INVOKE` opcode
 * `kind`/`ref` are common to both opcodes; `thirdOperand` is
 * `collectionCount` for `MAP_INVOKE` or the `ReduceForm` for
 * `REDUCE_INVOKE`. Registers an inline (kind 0) body into `builder`'s own
 * `anonymousBodies` side-table only NOW, after every collection argument
 * has already been parsed, so `paramNames` (fixed `["acc","x"]` for
 * reduce, or the zipped-form's declared names for map) is fully known.
 */
export function emitInvoke(
  builder: BytecodeBuilder,
  opcode: OpCode.MAP_INVOKE | OpCode.REDUCE_INVOKE,
  transform: TransformSpec,
  paramNames: string[],
  thirdOperand: number,
): void {
  builder.emitOpcode(opcode);
  builder.emitIndex(transform.kind);
  if (transform.kind === 0) {
    const idx = builder.emitAnonymousBody(paramNames, transform.program);
    builder.emitIndex(idx);
  } else if (transform.kind === 1) {
    builder.emitIndex(transform.builtinIdx);
  } else {
    builder.emitString(transform.name);
  }
  builder.emitIndex(thirdOperand);
}
