import type { IEnginePackage } from "@solve-js/api/PackageRegistry";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ComparisonParselet } from "./parselets/ComparisonParselet";
import { LogicalParselet } from "./parselets/LogicalParselet";
import { BooleanLiteralParselet } from "./parselets/BooleanLiteralParselet";
import { IfThenElseParselet } from "./parselets/IfThenElseParselet";
import { checkParselet } from "./parselets/CheckParselet";
import { checkLineNormalizerRule, approxOperatorNormalizerRule } from "./normalizer/CheckNormalizerRules";
import { checkComparison } from "./CheckFunctions";
import { notWordParselet, bangParselet } from "./parselets/NotParselet";
import { notWordNormalizerRule } from "./normalizer/NotNormalizerRule";
import { logicalNot } from "./NotFunctions";

/**
 * Comparisons (`==`, `!=`, `<`, `>`, `<=`, `>=`), boolean logic (`true`/
 * `false`, `and`/`or`/`&&`/`||`), and `if <cond> then <val> else <val>`
 * eager-ternary conditionals.
 *
 * The `and`/`or` split is deliberate, not an oversight: this package does
 * not register "and" at all. The word lexes as its own token, `AND_CONJ`
 * (`en.ts`: `and: "AND_CONJ"`, see the comment on it in `lexer/Token.ts`),
 * and the arithmetic package registers it as an infix `OpCode.ADD`, because
 * "5 and 3" is 8. Which meaning applies is a property of the operands, so
 * `OpCode.ADD`'s VM handler special-cases `Boolean + Boolean` as the
 * conjunction (see `vm/VM.ts`). "or"/"&&"/"||" have no such collision and
 * are handled here via `LogicalParselet`.
 *
 * GROUPING: `AND_CONJ` binds at `BindingPower.Conjunction`
 * (`parser/BindingPower.ts`), looser than `Conditional`, so an
 * unparenthesised `X >= Y and Z < W` parses as `(X >= Y) and (Z < W)`,
 * the same grouping `&&` gets at `LogicalAnd`. Both comparisons produce
 * booleans, so the ADD handler answers the conjunction. Between two plain
 * numbers the word is still addition ("2 and 3" is 5), and with a number
 * on one side and a comparison on the other it adds the boolean as 1 or 0
 * ("2 and 3 > 1" is 3). Both readings are pinned by
 * `hardening/ArithmeticConditionals.spec.ts` and the mathphrases
 * `AndAsListSeparator.spec.ts`.
 *
 * TRIGGER-WORD COLLISION: `not` (#751) is ordinary English and was a free
 * name, so it is not a lexer keyword. The normaliser fuses it to NOT only
 * where it stands in front of a value (the start of a line, or after `if`,
 * `then`, `else`, a bracket, a comma, `and`/`or` or a comparison) and a
 * condition follows it. `not = 3` and `not + 1` keep the variable, and a
 * sentence that starts with the word stays a non-answer. See
 * NotNormalizerRule.ts. A prefix `!` needs no such care: after a value it is
 * the factorial (an infix parselet in the function package), and anywhere
 * else it was an error.
 *
 * SCOPE DECISION: SoulverCore-style postfix `Y if X` / `Y unless X` (a
 * ternary with no explicit else-branch) is deliberately NOT implemented.
 * This VM's `Value` has no "empty"/"void" representation for the
 * false-branch case (every expression must produce a concrete typed
 * result), building it properly would mean adding a new sentinel
 * `ValueType` and deciding how every consumer (formatting, DAG
 * propagation, UOM/arithmetic ops) treats it, which is a bigger call than
 * this package should make implicitly. `if X then Y else Z` (both
 * branches required) covers the same need unambiguously today.
 */
export const CONDITIONALS_PACKAGE: IEnginePackage = {
  name: "solve-conditionals",
  prefixParselets: {
    TRUE: new BooleanLiteralParselet(true),
    FALSE: new BooleanLiteralParselet(false),
    IF: new IfThenElseParselet(),
    // `check <a> <comparison> <b>` (#506); see CheckParselet.ts.
    CHECK: checkParselet,
    // `not <condition>` and `!<value>`, logical negation (#751); see NotParselet.ts.
    NOT: notWordParselet,
    BANG: bangParselet,
  },
  // `within` and `≈` only mean something in a check. As phrases they are
  // single tokens before implicit multiplication can read `0.5 within` as a
  // product.
  phrases: {
    within: "WITHIN",
    "≈": "APPROX",
  },
  normalizerRules: [checkLineNormalizerRule(), approxOperatorNormalizerRule(), notWordNormalizerRule()],
  pluginFunctions: {
    checkComparison,
    logicalNot,
  },
  tokenCategories: {
    CHECK: "keyword",
    NOT: "keyword",
    WITHIN: "keyword",
    APPROX: "operator",
  },
  infixParselets: {
    EQUALITY: new ComparisonParselet(OpCode.EQ),
    NEQ: new ComparisonParselet(OpCode.NEQ),
    LT: new ComparisonParselet(OpCode.LT),
    GT: new ComparisonParselet(OpCode.GT),
    LTE: new ComparisonParselet(OpCode.LTE),
    GTE: new ComparisonParselet(OpCode.GTE),
    OR: new LogicalParselet(OpCode.LOGICAL_OR, BindingPower.LogicalOr),
    LOGICAL_AND: new LogicalParselet(OpCode.LOGICAL_AND, BindingPower.LogicalAnd),
    LOGICAL_OR: new LogicalParselet(OpCode.LOGICAL_OR, BindingPower.LogicalOr),
  },
};
