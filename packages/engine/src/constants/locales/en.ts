/** What a locale supplies: keywords, units, and number formatting conventions. */
export interface ILocale {
  code: string;
  label: string;
  /**
   * Every word this locale reads as a keyword, lower-cased, to its token type.
   * A pack other than English holds the English words too, with its own beside
   * them (see {@link withEnglishKeywords}), so an English
   * line reads the same under every pack.
   */
  keywordMap: Record<string, string>;
  /**
   * The pack's own names for built-in functions, each to the English name it
   * stands for (`wurzel` to `sqrt`). A name listed here is also a `FUNC` word
   * in {@link keywordMap}, which is what makes the lexer read it as a call;
   * this table is what the call then runs. Absent for English, whose names are
   * the built-ins' own.
   */
  functionNames?: Readonly<Record<string, string>>;
  display: {
    resultPrefix: string;
    dateFormat: string;
    decimalSeparator: string;
    thousandsSeparator: string;
    vectorFormat: string;
    percentageSuffix: string;
  };
}

/** English keywords, units and number formatting. The default and the fallback. */
export const enLocale: ILocale = {
  code: "en",
  label: "English",
  keywordMap: {
    pi: "PI", e: "E",
    plus: "PLUS", add: "PLUS", and: "AND_CONJ", with: "PLUS",
    minus: "MINUS", subtract: "MINUS", remove: "MINUS", take: "MINUS",
    without: "MINUS",
    // `mul`, `exponent` and `prime` were once aliases for `*` and `^` here. A
    // keyword cannot be a name, not even with a colon, and `prime` claimed the
    // word a reader uses to ask whether a number is prime, so they were
    // retired rather than kept as operators nobody guessed (#829).
    times: "STAR", multiply: "STAR",
    divide: "SLASH",
    modulo: "MOD", mod: "MOD",
    xor: "BIT_XOR",
    of: "OF",
    now: "NOW", today: "TODAY", tomorrow: "TOMORROW", yesterday: "YESTERDAY",
    roll: "ROLL",
    sqrt: "FUNC", abs: "FUNC", sin: "FUNC", cos: "FUNC", tan: "FUNC",
    log: "FUNC", ceil: "FUNC", floor: "FUNC", round: "FUNC", min: "FUNC", max: "FUNC",
    asin: "FUNC", acos: "FUNC", atan: "FUNC", atan2: "FUNC",
    // Long-form aliases for asin/acos/atan (Numi/older-calculator naming
    // convention). Same FunctionCallParselet indices, not new behavior.
    arcsin: "FUNC", arccos: "FUNC", arctan: "FUNC",
    sinh: "FUNC", cosh: "FUNC", tanh: "FUNC",
    asinh: "FUNC", acosh: "FUNC", atanh: "FUNC",
    cbrt: "FUNC", clz32: "FUNC", expm1: "FUNC", exp: "FUNC",
    // root(n, x) -- n-th root; fact/factorial(n) -- factorial. Bare FUNC
    // keywords, matching gcd/lcm/cbrt's precedent above (technical,
    // call-syntax-only names, not plausible :variableName choices).
    root: "FUNC", fact: "FUNC", factorial: "FUNC",
    fround: "FUNC", hypot: "FUNC", imul: "FUNC",
    sind: "FUNC", cosd: "FUNC", tand: "FUNC",
    asind: "FUNC", acosd: "FUNC", atand: "FUNC",
    log10: "FUNC", log1p: "FUNC", log2: "FUNC",
    pow: "FUNC", random: "FUNC", sign: "FUNC", trunc: "FUNC",
    degtorad: "FUNC", radtodeg: "FUNC",
    gcd: "FUNC", lcm: "FUNC", permutation: "FUNC", combination: "FUNC",
    // Number theory (#514), and the other names combination goes by.
    isprime: "FUNC", nextprime: "FUNC", modpow: "FUNC", powmod: "FUNC", modinv: "FUNC",
    ncr: "FUNC", nCr: "FUNC", binomial: "FUNC",
    // hex/bin double as CONVERTER_NAME below ("255 as hex") AND as FUNC
    // call-syntax ("hex(255)"), a word can only have one lexer token
    // type, so these win FUNC (removed from the CONVERTER_NAME list
    // below) and AsConverterParselet.ts's "as <name>" check was widened
    // to also accept a FUNC-typed token, preserving "as hex"/"as bin"
    // unchanged. See AsConverterParselet.ts's class doc for the full
    // reasoning.
    hex: "FUNC", bin: "FUNC", int: "FUNC",
    // Finance (packages/finance/) function-call forms. Bare keywords, not
    // phrase-fused, these are camelCase call-only names (e.g.
    // "compoundInterest(...)"), not natural-language words a user would
    // plausibly choose as a variable name, so the bare-keyword collision
    // risk that blocks "interest"/"tax"/"principal" etc. doesn't apply here
    // (matches "gcd"/"lcm"/... above, not "clamp" below).
    compoundinterest: "FUNC", interestearned: "FUNC",
    compoundinterestrate: "FUNC", compoundinterestyears: "FUNC",
    loanrepayment: "FUNC", loaninterest: "FUNC", monthlypayment: "FUNC",
    taxadd: "FUNC", taxremove: "FUNC",
    // Inflation-adjusted value function-call form (packages/finance/).
    inflationadjust: "FUNC",
    // Matrix (packages/matrix/) function-call forms -- also reachable via
    // `^T`/`^-1` operator syntax and `|a|` (see FunctionCallParselet.ts's
    // builtinNameToIndex comment for indices 63-66).
    transpose: "FUNC", det: "FUNC", inv: "FUNC", dot: "FUNC",
    // map/reduce/sum/prod (packages/mapreduce/) are NOT bare keywordMap
    // entries. See packages/mapreduce/normalizer/MapReduceCallNormalizerRule.ts
    // which fuses them ONLY when immediately followed by "(" (same
    // "conditional-on-LPAREN" pattern as packages/lines/'s own
    // sum(/total(/average( fusion), so `:map = [...]`/`:sum = 100`/etc.
    // keep working as ordinary variable names.
    clamp: "CLAMP",
    // `into` is a third spelling of the conversion operator, alongside `to` and
    // `in`. It reads better before a unit than either ("300 cm into m"), and
    // costs nothing: it is not a plausible variable name and has no other
    // meaning in the grammar.
    convert: "CONVERT", to: "TO", best: "BEST", in: "IN", into: "IN",
    next: "NEXT", last: "LAST", until: "UNTIL", since: "SINCE",
    sunday: "SUNDAY", monday: "MONDAY", tuesday: "TUESDAY", wednesday: "WEDNESDAY",
    thursday: "THURSDAY", friday: "FRIDAY", saturday: "SATURDAY",
    between: "BETWEEN", from: "FROM",
    increase: "INCREASE", decrease: "DECREASE",
    // Finance (packages/finance/) phrase-grammar connectors. Bare
    // prepositions, same accepted-risk category as "between"/"from" above
    // see Token.ts's OVER/RATE_AT doc comment.
    over: "OVER", at: "RATE_AT",
    // Only "rounded". Bare "round" is already the round(x) function above.
    rounded: "ROUNDED",
    is: "IS",
    // The investment grammar (packages/finance/). See Token.ts.
    after: "AFTER", for: "FOR_DURATION", compounding: "COMPOUNDING",
    invested: "INVESTED", returned: "RETURNED",
    by: "BY",
    vec2: "VEC2", vec3: "VEC3", vec4: "VEC4",
     float: "FLOAT",
    global: "GLOBAL",
    or: "OR",
    true: "TRUE", false: "FALSE",
    if: "IF", then: "THEN", else: "ELSE",
    as: "AS",
    percent: "CONVERTER_NAME", percentage: "CONVERTER_NAME",
    decimal: "CONVERTER_NAME", dec: "CONVERTER_NAME", number: "CONVERTER_NAME",
    fraction: "CONVERTER_NAME",
    multiplier: "CONVERTER_NAME",
    sci: "CONVERTER_NAME", scientific: "CONVERTER_NAME",
    // hex/bin are FUNC (see above), not CONVERTER_NAME, "as hex"/"as bin"
    // still work via AsConverterParselet.ts's widened token-type check.
    binary: "CONVERTER_NAME",
    octal: "CONVERTER_NAME", oct: "CONVERTER_NAME",
  },
  display: {
    resultPrefix: "= ",
    dateFormat: "default",
    decimalSeparator: ".",
    thousandsSeparator: ",",
    vectorFormat: "[{values}]",
    percentageSuffix: "%",
  },
};

/**
 * A language pack's keyword table: every English keyword, with the pack's own
 * words beside them.
 *
 * A pack used to replace the English table, so a German engine read `mal` and
 * no longer read `times`, `of`, `sqrt`, `true` or `if`, and a French engine had
 * no word for a conversion at all (#833). A pack now adds to English. Where the
 * pack spells one of its own words the same as an English keyword, the pack's
 * meaning is kept, since that is the word its reader writes; the packs'
 * specs list each such word.
 *
 * @param own - The pack's own words, to their token types.
 * @returns A new table; neither argument is changed.
 */
export function withEnglishKeywords(own: Readonly<Record<string, string>>): Record<string, string> {
  return { ...enLocale.keywordMap, ...own };
}
