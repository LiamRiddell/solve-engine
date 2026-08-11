/**
 * Named precedence levels for the Pratt parser, from loosest (`Lowest`) to
 * tightest (`Call`) binding. A custom infix parselet compares its own
 * binding power against the current expression's to decide whether to
 * consume the next operator (higher power binds tighter, e.g. `*` over `+`).
 *
 * Package authors reference these when registering an infix parselet via
 * `IPackageRegistry.registerInfixParselet`. See the built-in packages for
 * examples of picking an appropriate level (e.g. arithmetic `+`/`-` use
 * `Sum`, `*`/`/` use `Product`).
 */
export const BindingPower = {
  Lowest: 0,
  Assignment: 10,
  LogicalOr: 12,   // `or`, `||` — loosest of the boolean-logic operators
  LogicalAnd: 14,  // `&&` — binds tighter than `or` ("a or b and c" = "a or (b and c)")
  // The word "and" (`AND_CONJ`), which is both arithmetic addition ("5 and 3"
  // is 8) and boolean conjunction ("true and false"). A phrase parselet
  // collecting a list ("average of X, Y and Z") parses each argument at this
  // level, and an argument stops at any operator whose power is <= the level it
  // was parsed at, so putting "and" here is what makes it end an argument
  // rather than be consumed as the addition it also is. Everything an argument
  // should keep binds tighter, including a genuine "+" (`Sum`).
  //
  // It sits BELOW `Conditional` because the boolean reading needs comparisons
  // to be its operands: at 28, "5 > 3 and 2 > 1" parsed as "5 > (3 and 2) > 1"
  // and answered false. Above `LogicalAnd` so that "and" is still the tighter
  // of the two conjunctions, and two steps off each neighbour to leave room.
  Conjunction: 16,
  // The bitwise trio and the shifts, ordered exactly as C and JavaScript order
  // them, which is the order every language that borrowed these operators from
  // C uses: `|` looser than `xor`, `xor` looser than `&`, all three looser than
  // comparison, and the shifts tighter than comparison but looser than `+`.
  // They used to share one level (35) between `Sum` and `Product`, so
  // "1 + 2 << 3" answered 17 where JavaScript answers 24 and "4 & 3 + 1"
  // answered 1 where JavaScript answers 4. Each has its own level now because
  // a shared level makes "4 | 6 & 3" group left instead of letting `&` win.
  //
  // They stay TIGHTER than `Conjunction` so that a phrase argument parsed at
  // that level ("average of 5 | 3, 2 and 4") keeps its bitwise operators
  // instead of stopping at the first one.
  BitwiseOr: 18,   // `|`
  BitwiseXor: 20,  // the `xor` keyword (`BIT_XOR`), not the `^` exponent token
  BitwiseAnd: 22,  // `&`
  Conditional: 24, // comparisons (`==`, `<`, `>=`, ...), tighter than the bitwise trio, looser than the shifts
  Shift: 27,       // `<<`, `>>`, `>>>`
  Sum: 30,
  Product: 40,
  // `^`, RIGHT-associative: "2 ^ 3 ^ 2" is 2^(3^2) = 512, as in mathematics,
  // Python, Ruby and JavaScript's `**`. See PrecedenceParser.parseExpression
  // and BinaryOpParselet for the two places that associativity is implemented.
  Exponent: 50,
  Prefix: 60,
  Postfix: 70,
  Call: 80,
} as const;

/**
 * Set the binding power of a named operator.
 *
 * Binding power is what decides precedence in the Pratt parser: a higher number
 * binds tighter, so `*` outranks `+`. Changing one changes how every existing
 * expression using that operator parses, which is why packages should allocate
 * a new name rather than adjust a built-in.
 *
 * @param name - Operator name.
 * @param power - Higher binds tighter.
 */
export function setBindingPower(name: string, power: number): void {
  (BindingPower as Record<string, number>)[name] = power;
}

/**
 * Read the binding power of a named operator.
 *
 * @param name - Operator name.
 * @returns Its binding power, or 0 when the name is unknown, which makes an
 * unregistered operator terminate an expression rather than swallow the rest
 * of it.
 */
export function getBindingPower(name: string): number {
  return (BindingPower as Record<string, number>)[name] ?? 0;
}

// ── Built-in Infix Operator Binding Power Table ──────────────────────────────
// Pre-computed Uint8Array lookup indexed by token typeId.
// value > 0  → built-in infix operator with that binding power
// value = 0  → not a built-in infix, fall through to Tier 2 parselet registry
//
// Built at module load via buildBindingPowerTable(). The table is sparse
// most entries are 0 since only ~15 of 80+ token types are infix operators.
//
// Performance: Uint8Array[typeId] is a single typed array load, no Map.get()
// no string hashing, no property chain. V8 eliminates bounds checks when typeId
// is known to be within array length.

import { TokenTypes } from "@solve-js/lexer/Token";
import { tokenTypeId } from "@solve-js/lexer/Token";

/**
 * Mapping of token type names → binding powers for built-in infix operators.
 * Only operators listed here get the Tier 1 fast path in PrecedenceParser.
 * All other infix tokens use the Tier 2 parselet registry fallback.
 */
const BUILTIN_INFIX_BP: Record<string, number> = {
  // Arithmetic (infix, left-associative)
  [TokenTypes.PLUS]:     BindingPower.Sum,
  [TokenTypes.MINUS]:    BindingPower.Sum,
  [TokenTypes.STAR]:     BindingPower.Product,
  [TokenTypes.SLASH]:    BindingPower.Product,
  [TokenTypes.MOD]:      BindingPower.Product,

  // Arithmetic (infix, RIGHT-associative, PrecedenceParser handles this specially)
  [TokenTypes.CARET]:    BindingPower.Exponent,

  // Bitwise and shift (infix, left-associative), one level each, ordered as C
  // and JavaScript order them. `>>>` used to be missing from this table
  // entirely, which left it running at its Tier 2 parselet level while `>>`
  // ran at the Tier 1 one, so "16 >> 3 & 1" and "16 >>> 3 & 1" grouped
  // differently and answered 0 and 8.
  [TokenTypes.BIT_OR]:   BindingPower.BitwiseOr,
  [TokenTypes.BIT_XOR]:  BindingPower.BitwiseXor,
  [TokenTypes.BIT_AND]:  BindingPower.BitwiseAnd,
  [TokenTypes.LSHIFT]:   BindingPower.Shift,
  [TokenTypes.RSHIFT]:   BindingPower.Shift,
  [TokenTypes.URSHIFT]:  BindingPower.Shift,

  // Postfix (no right operand, PrecedenceParser handles this specially)
  [TokenTypes.PERCENT]:  BindingPower.Postfix,

  // Percentage keyword (infix, left-associative: "50% of 200" → MUL)
  [TokenTypes.OF]:       BindingPower.Product,
};

// Note: These token types are intentionally NOT in the BP_TABLE, they stay in
// the Tier 2 parselet registry because they require complex handling:
//   IN, TO    → UoM conversion parselets (peek at target unit token, complex logic)
//   DOT       → Property access (chained OBJ_GET, needs left-token tracking)
//   EQUALS    → Assignment (VariableParselet handles :var = expr pattern)
//   EQUALITY, NEQ, GTE, LTE → Comparison ops (need dedicated VM opcodes, task 2.15a)
//   COMMA     → Argument separator (function calls, array/object literals)

/** Cached BP_TABLE, built once at module load, immutable thereafter. */
let _bpTable: Uint8Array | null = null;

/**
 * Build the Uint8Array binding power table indexed by token typeId.
 * Idempotent, returns cached table on subsequent calls.
 *
 * Must be called after all token types are registered (via registerAllTokenTypes())
 * and after plugin providers have registered their token types.
 */
export function buildBindingPowerTable(): Uint8Array {
  if (_bpTable) return _bpTable;

  // Size to the largest registered typeId + 1
  let maxId = 0;
  for (const name of Object.keys(BUILTIN_INFIX_BP)) {
    const id = tokenTypeId(name);
    if (id > maxId) maxId = id;
  }
  // Also scan all TokenTypes to ensure table covers all registered IDs
  for (const name of Object.values(TokenTypes)) {
    const id = tokenTypeId(name);
    if (id > maxId) maxId = id;
  }

  const table = new Uint8Array(maxId + 1);
  for (const [name, bp] of Object.entries(BUILTIN_INFIX_BP)) {
    const id = tokenTypeId(name);
    table[id] = bp;
  }

  _bpTable = table;
  return table;
}

/**
 * Invalidate the cached BP table, call when plugins register new token types
 * that should participate in the built-in fast path.
 */
export function invalidateBindingPowerTable(): void {
  _bpTable = null;
}
