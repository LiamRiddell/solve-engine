/**
 * Lexer token produced by {@link ExpressionLexer} and consumed by parsers.
 *
 * Each token carries:
 * - `type`: string name (e.g. "NUMBER", "PLUS") for diagnostics and parselet lookup
 * - `typeId`: integer ID for O(1) comparison in parser hot paths
 * - `value`/`text`: the token's semantic value and raw source text
 * - `offset`/`line`/`col`: source position for error messages and highlighting
 */
export interface Token {
	/** String token type (e.g., "NUMBER", "PLUS", "IDENT"). Used by ParseletRegistry string-keyed maps and error messages. */
	type: string;
	/** Integer token type ID for fast comparison in Parser hot path.
	 * Populated by the Lexer via registerTokenType(). Use tokenTypeId(type) to get a type's ID. */
	typeId: number;
	value: string;
	text: string;
	offset: number;
	lineBreaks: number;
	line: number;
	col: number;
	/**
	 * End offset of the source text this token was fused from, exclusive.
	 *
	 * Only set on tokens the normalizer built by fusing several lexer tokens
	 * into one, and only there because those are the tokens whose `value` no
	 * longer describes the text they came from. `10 frames` fuses into a
	 * FRAME_COUNT whose value is `10`, so `offset + value.length` would cover
	 * two characters of a nine-character phrase.
	 *
	 * Evaluation never reads this. It exists so that a consumer painting a line
	 * (see `LanguageService.getSemanticTokens`) can highlight a fused phrase as
	 * the one thing the parser will see rather than as its parts.
	 */
	sourceEnd?: number;
}

/**
 * Canonical token type name constants.
 * All token types used by the lexer, parser, and VM are defined here.
 * Custom/plugin token types should be registered via {@link registerTokenType}.
 */
export const TokenTypes = {
  NUMBER: "NUMBER",
  BIGINT: "BIGINT",
  STRING: "STRING",
  IDENT: "IDENT",
  PLUS: "PLUS",
  MINUS: "MINUS",
  STAR: "STAR",
  SLASH: "SLASH",
  CARET: "CARET",
  PERCENT: "PERCENT",
  LSHIFT: "LSHIFT",
  RSHIFT: "RSHIFT",
  URSHIFT: "URSHIFT",
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  LBRACKET: "LBRACKET",
  RBRACKET: "RBRACKET",
  LBRACE: "LBRACE",
  RBRACE: "RBRACE",
  COMMA: "COMMA",
  DOT: "DOT",
  COLON: "COLON",
  SEMICOLON: "SEMICOLON",
  EQUALS: "EQUALS",
  DOLLAR: "DOLLAR",
  POUND: "POUND",
  EURO: "EURO",
  YEN: "YEN",
  RUBLE: "RUBLE",
  WON: "WON",
  QUESTION: "QUESTION",
  BANG: "BANG",
  BIT_AND: "BIT_AND",
  BIT_OR: "BIT_OR",
  BIT_NOT: "BIT_NOT",
  KEYWORD: "KEYWORD",
  EOF: "EOF",
  ERROR: "ERROR",
  WS: "WS",
  NEWLINE: "NEWLINE",
  DATETIME_LITERAL: "DATETIME_LITERAL",
  DURATION: "DURATION",
  UNIT: "UNIT",
  ROLL: "ROLL",
  PI: "PI",
  E: "E",
  MOD: "MOD",
  // The English word "and", which is NOT the same thing as "+" even though it
  // adds. It used to map straight onto PLUS in the locale keyword map, which
  // made "3 and 4" evaluate to 7 correctly and then quietly broke every phrase
  // that uses "and" as a list separator: "average of 36, 42, 19 and 81" parsed
  // its last argument as "19 + 81" and returned 178/3 rather than 178/4.
  //
  // Giving it its own type lets a parselet tell the two apart. It is still an
  // infix addition (see ArithmeticPackage.ts) so "3 and 4" is unchanged, but it
  // binds at BindingPower.Conjunction, one step looser than Sum, so a phrase
  // parselet can parse an argument at Conjunction and get "1 + 2" whole while
  // still stopping at "and".
  AND_CONJ: "AND_CONJ",
  OF: "OF",
  INCREASE_BY: "INCREASE_BY",
  DECREASE_BY: "DECREASE_BY",
  // Percentage solve-for-unknown (packages/percentage/), "N% of what is
  // X" solves N% * base = X for base. Fused as a full 3-word phrase (see
  // PercentagePackage.ts's `phrases` field) rather than a bare "what"
  // keyword, "what" is common enough as a variable name to be worth the
  // same phrase-fusion treatment this codebase gives "total"/"average"/etc.
  OF_WHAT_IS: "OF_WHAT_IS",
  // Sibling solve-for-unknown forms accounting for a +/-1 offset, "N% on
  // what is X" (increase) / "N% off what is X" (decrease). Same
  // phrase-fusion reasoning as OF_WHAT_IS above.
  ON_WHAT_IS: "ON_WHAT_IS",
  OFF_WHAT_IS: "OFF_WHAT_IS",
  NOW: "NOW",
  TODAY: "TODAY",
  TOMORROW: "TOMORROW",
  YESTERDAY: "YESTERDAY",
  DURATION_DAY: "DURATION_DAY",
  DURATION_WEEK: "DURATION_WEEK",
  DURATION_MONTH: "DURATION_MONTH",
  DURATION_YEAR: "DURATION_YEAR",
  DURATION_HOUR: "DURATION_HOUR",
  DURATION_MINUTE: "DURATION_MINUTE",
  DURATION_SECOND: "DURATION_SECOND",
  FUNC: "FUNC",
  CONVERT: "CONVERT",
  TO: "TO",
  BEST: "BEST",
  NEXT: "NEXT",
  LAST: "LAST",
  UNTIL: "UNTIL",
  SINCE: "SINCE",
  BETWEEN: "BETWEEN",
  FROM: "FROM",
  INCREASE: "INCREASE",
  DECREASE: "DECREASE",
  UNICODE_MATH: "UNICODE_MATH",
  TIMES_BY: "TIMES_BY",
  MULTIPLY_BY: "MULTIPLY_BY",
  DIVIDE_BY: "DIVIDE_BY",
  NEQ: "NEQ",
  IN: "IN",
  BIT_XOR: "BIT_XOR",
  EQUALITY: "EQUALITY",
  GTE: "GTE",
  LTE: "LTE",
  LT: "LT",
  GT: "GT",
  LOGICAL_AND: "LOGICAL_AND",
  LOGICAL_OR: "LOGICAL_OR",
  OR: "OR",
  TRUE: "TRUE",
  FALSE: "FALSE",
  IF: "IF",
  THEN: "THEN",
  ELSE: "ELSE",
  AS: "AS",
  CONVERTER_NAME: "CONVERTER_NAME",
  // Rounding (packages/converters/). "rounded" is a bare keyword: it is a
  // past participle with no plausible use as a :variableName, the same
  // accepted-risk category as "between"/"from". TO_NEAREST and
  // DECIMAL_PLACES are fused, since "to" already means percentage change.
  ROUNDED: "ROUNDED",
  TO_NEAREST: "TO_NEAREST",
  DECIMAL_PLACES: "DECIMAL_PLACES",
  // Fused two-word phrase tokens (see MathPhrasesPackage.ts's `phrases`
  // field), deliberately NOT bare single-word keywords: "average"
  // "total", "count", etc. are common variable names, and this codebase
  // has a tested policy that colon-prefixed variable names can't be
  // keyword-shaped words (see VariableParselet.ts's doc comment). Fusing
  // the full "<word> of"/"<word> between" phrase means the bare word
  // itself never becomes its own token type, so ":total = ..." keeps
  // working exactly as before.
  AVERAGE_OF: "AVERAGE_OF",
  MEDIAN_OF: "MEDIAN_OF",
  TOTAL_OF: "TOTAL_OF",
  COUNT_OF: "COUNT_OF",
  LARGER_OF: "LARGER_OF",
  SMALLER_OF: "SMALLER_OF",
  HALF_OF: "HALF_OF",
  MIDPOINT_BETWEEN: "MIDPOINT_BETWEEN",
  REMAINDER_OF: "REMAINDER_OF",
  NTH_ROOT: "NTH_ROOT",
  LOG_PHRASE: "LOG_PHRASE",
  LOG_BASE: "LOG_BASE",
  GCD_OF: "GCD_OF",
  LCM_OF: "LCM_OF",
  SQUARE_ROOT_OF: "SQUARE_ROOT_OF",
  CUBE_ROOT_OF: "CUBE_ROOT_OF",
  RANDOM_NUMBER: "RANDOM_NUMBER",
  IS_TO: "IS_TO",
  // Bare "is", the trigger for the solve-for-the-unknown percentage family
  // (packages/percentage/IsWhatParselet.ts). Safe as a bare keyword: it is a
  // verb, not a plausible :variableName, and the "is to" proportion phrase is
  // fused earlier so it still wins.
  IS: "IS",
  PCT_ON: "PCT_ON",
  PCT_OFF: "PCT_OFF",
  OF_WHAT: "OF_WHAT",
  OFF_WHAT: "OFF_WHAT",
  ON_WHAT: "ON_WHAT",
  // CLAMP stays a bare single-word keyword: "clamp X between Y and Z" has
  // the value X between the trigger and "between", so it can't be
  // phrase-fused like the others above (same structural reason
  // ClampParselet.ts is hand-written instead of PhrasePattern-based).
  // Matches this codebase's existing accepted risk for "between"/"from"/
  // "next"/"last"/"best", also bare, also can't be used as `:name`.
  CLAMP: "CLAMP",
  // map/reduce/sum/prod (packages/mapreduce/), bare single-word keywords
  // each with its own dedicated parselet (custom argument grammar: a bare
  // builtin/user-function name, an inline transform expression, or
  // `name=collection` zipped pairs, none of which fit the ordinary
  // FunctionCallParselet path, so these can't just reuse the generic FUNC
  // token type the way sqrt/abs/... do).
  MAP: "MAP",
  REDUCE: "REDUCE",
  SUM_FN: "SUM_FN",
  PROD_FN: "PROD_FN",
  // The algebra verbs (packages/symbolic/), fused from an ordinary IDENT only
  // when immediately followed by `(`, so `factor`/`solve`/`expand` stay usable
  // as variable names. Declared here rather than left to be minted on first use
  // by `tokenTypeId()`, which is what {@link registerAllTokenTypes} exists for:
  // a lazily-minted id depends on what else happened to be minted before it, so
  // in a single-process run the id a normalizer rule produces can stop matching
  // the id the parselet was registered under. Every token type a built-in
  // package relies on belongs in this table.
  EXPAND_FN: "EXPAND_FN",
  FACTOR_FN: "FACTOR_FN",
  SOLVE_FN: "SOLVE_FN",
  DER_FN: "DER_FN",
  INTEGRAL_FN: "INTEGRAL_FN",
  TAYLOR_FN: "TAYLOR_FN",
  JACOBIAN_FN: "JACOBIAN_FN",
  CONJ_FN: "CONJ_FN",
  RE_FN: "RE_FN",
  IM_FN: "IM_FN",
  CANCEL_FN: "CANCEL_FN",
  APART_FN: "APART_FN",
  // The imaginary-literal suffix, fused from a number followed immediately by
  // `i`. Same registration reasoning as the verbs above.
  IMAGINARY: "IMAGINARY",
  // `=>`, "therefore"/solve operator. The algebra itself lives in symbolic/;
  // packages/symbolic/ carries the grammar surface for the named operations.
  // A genuine 2-char lexer token (ExpressionLexer.ts's TWO_CHAR_OPS table),
  // same mechanism as ==/!=/>=/<=, not a normalizer-level fusion, "=" then
  // ">" is the opposite char order from GTE's ">=", so there's no collision.
  THEREFORE: "THEREFORE",
  // Timezone query phrases (see TimePackage.ts's `phrases` field). Same
  // phrase-fusion reasoning as above: "time"/"date"/"difference" are
  // common variable names, so the fused trigger is the full phrase.
  // CITY_NAME is the fused-token type for multi-word city/country names
  // (e.g. "new york"). See timezones/CityZones.ts's MULTI_WORD_CITY_ZONES.
  TIME_IN: "TIME_IN",
  DATE_IN: "DATE_IN",
  TIME_DIFFERENCE_BETWEEN: "TIME_DIFFERENCE_BETWEEN",
  CITY_NAME: "CITY_NAME",
  BACKTICK_OPEN: "BACKTICK_OPEN",
  INLINE_SOLVE_START: "INLINE_SOLVE_START",
  // Comment marker, `#` or `//` to end of line. Emitted by
  // ExpressionLexer.tokenizeComment()/tokenizeOperator() but never reaches
  // a parselet: ExpressionEngine.prepareExpression() filters COMMENT
  // tokens out of the stream before normalization/parsing (see
  // ExpressionEngine.ts's "Filter COMMENT tokens" comments). Listed here
  // for discoverability even though tokenTypeId() would lazily register
  // it anyway on first use.
  COMMENT: "COMMENT",
  // Vector types (referenced in locale keywordMap as vec2→VEC2, etc.)
  VEC2: "VEC2",
  VEC3: "VEC3",
  VEC4: "VEC4",
  FLOAT: "FLOAT",
  GLOBAL: "GLOBAL",
  // ── Finance (packages/finance/) ──
  // OVER/RATE_AT are bare single-word keywords (not phrase-fused): both are
  // prepositions with near-zero plausibility as a variable name (nobody
  // writes ":over = 5" or ":at = 3"), the same accepted-risk category as
  // this codebase's existing bare "between"/"from"/"next"/"last"/"best"
  // keywords (see VariableParselet.ts's doc comment). RATE_AT is deliberately
  // NOT named "AT", that name is already reserved (dormant) for a future
  // "@" symbol token in TokenNormalizer.NON_WORD_NAMES; reusing it here would
  // create an unintended coupling if "@" is ever wired up.
  OVER: "OVER",
  RATE_AT: "RATE_AT",
  // The investment grammar's connectives (packages/finance/), same
  // accepted-risk category as OVER/RATE_AT above. "after"/"for" are
  // prepositions; "compounding", "invested" and "returned" are participles,
  // and none is a plausible `:variableName`.
  //
  // "after" and "for" are the pivots Soulver's own documented syntax uses,
  // `$1,000 after 3 years at 7%` and `$1,000 for 3 years at 7% compounding
  // monthly`. This package originally substituted "over" for both and said so
  // in CompoundInterestParselet.ts's doc comment; the documented spellings now
  // work as well, and "over" is kept so nothing that already parsed stops.
  AFTER: "AFTER",
  PRESENT_VALUE_OF: "PRESENT_VALUE_OF",
  ANNUAL_RETURN_ON: "ANNUAL_RETURN_ON",
  FOR_DURATION: "FOR_DURATION",
  COMPOUNDING: "COMPOUNDING",
  INVESTED: "INVESTED",
  RETURNED: "RETURNED",
  // Fused phrase tokens (see FinancePackage.ts's `phrases` field)
  // deliberately NOT bare single-word keywords: "interest", "tax", "vat",
  // "repayment", "principal" etc. are all common, plausible variable names
  // (a shipped playground example uses ":total = :subtotal + :tax". See
  // MathPhrasesPackage.ts's doc comment for the regression this caused
  // once already). Fusing the full "<word> on"/"<word> off" phrase means
  // the bare leading word itself never becomes its own token type, so
  // ":tax = ..." keeps working exactly as before.
  COMPOUND_INTEREST_ON: "COMPOUND_INTEREST_ON",
  INTEREST_ON: "INTEREST_ON",
  DAILY_REPAYMENT_ON: "DAILY_REPAYMENT_ON",
  MONTHLY_REPAYMENT_ON: "MONTHLY_REPAYMENT_ON",
  ANNUAL_REPAYMENT_ON: "ANNUAL_REPAYMENT_ON",
  TOTAL_REPAYMENT_ON: "TOTAL_REPAYMENT_ON",
  DAILY_LOAN_INTEREST_ON: "DAILY_LOAN_INTEREST_ON",
  MONTHLY_LOAN_INTEREST_ON: "MONTHLY_LOAN_INTEREST_ON",
  ANNUAL_LOAN_INTEREST_ON: "ANNUAL_LOAN_INTEREST_ON",
  TOTAL_LOAN_INTEREST_ON: "TOTAL_LOAN_INTEREST_ON",
  TAX_ON: "TAX_ON",
  TAX_OFF: "TAX_OFF",
  TAX_IN_PHRASE: "TAX_IN_PHRASE",
  // Inflation-adjusted value (packages/finance/) -- fused phrase
  // tokens (see FinancePackage.ts's `phrases` field), same reasoning
  // as the tax/interest phrases above: "what"/"was"/"value"/"worth"
  // are all plausible variable names, so only the full phrases are
  // ever claimed as keywords, never the bare leading word.
  WHAT_IS: "WHAT_IS",
  WHAT_WAS: "WHAT_WAS",
  VALUE_OF: "VALUE_OF",
  WORTH_IN: "WORTH_IN",
  // Bare single-word keyword (not phrase-fused) -- "assuming" has
  // near-zero plausibility as a variable name, the same accepted-risk
  // category as this codebase's existing bare "over"/"at" keywords
  // (see the OVER/RATE_AT comment above). Registered so its bare word
  // is a recognized phrase-starter (`canStartPhrase`), which suppresses
  // implicit-multiply insertion between the futureYear NUMBER and this
  // word in "value of $X in <year> assuming N% inflation" -- without
  // this, "<year> assuming" was silently rewritten to "<year> *
  // assuming" before parsing ever ran.
  ASSUMING: "ASSUMING",
  // Fused by a custom NormalizerRule (not `phrases`), carrying the
  // year as its value -- see
  // finance/normalizer/InYearDollarsNormalizerRule.ts.
  IN_YEAR_DOLLARS: "IN_YEAR_DOLLARS",
  // Cooking/UoM (packages/uom/) -- fused ingredient name (single- or
  // multi-word, e.g. "butter"/"olive oil") carrying the matched name
  // as its value. NOT a bare-word phrase-trie keyword -- see
  // uom/normalizer/IngredientNameNormalizerRule.ts's doc comment for
  // why this is a context-sensitive NormalizerRule instead (so a bare
  // `:butter = 5` variable definition is completely unaffected).
  INGREDIENT_NAME: "INGREDIENT_NAME",
  // ── Datetime, workdays/weekdays/timestamps (packages/datetime/) ──
  // Fused phrase tokens (see DatetimePackage.ts's `phrases` field)
  // deliberately NOT bare single-word keywords: "workdays"/"weekday"/
  // "timestamp"/"date" are all plausible variable names, same
  // reasoning/regression risk as MathPhrasesPackage.ts's "total" note and
  // FinancePackage.ts's "tax" note above. Fusing the full phrase means the
  // bare leading word itself never becomes its own token type, so e.g.
  // ":timestamp = 5" keeps working.
  WORKDAYS_IN: "WORKDAYS_IN",
  WEEKDAY_ON: "WEEKDAY_ON",
  CURRENT_TIMESTAMP: "CURRENT_TIMESTAMP",
  TO_DATE: "TO_DATE",
  TO_TIMESTAMP: "TO_TIMESTAMP",
  // Natural-question forms over the same date fields, "what day is it in
  // 30 days", "what month is it on 25/12/2026", "what week is it". Each is
  // a fully-fused phrase for the same reason as WEEKDAY_ON above: claiming
  // bare "day"/"month"/"week" as keywords would break ":day = 5" and
  // collide with the UNIT tokens of the same name.
  WEEKDAY_IN: "WEEKDAY_IN",
  MONTH_ON: "MONTH_ON",
  MONTH_IN: "MONTH_IN",
  WEEK_ON: "WEEK_ON",
  DAYS_IN_PERIOD: "DAYS_IN_PERIOD",
  IN_TWO_UNITS: "IN_TWO_UNITS",
  WEEK_IN: "WEEK_IN",
  // `<unit> between <date> and <date>`, fused UNIT+BETWEEN, exactly like
  // UNTIL_UNIT/SINCE_UNIT above.
  BETWEEN_UNIT: "BETWEEN_UNIT",
  // Postfix day-type predicates, "<date> is a weekend" / "is a workday".
  IS_WEEKEND: "IS_WEEKEND",
  IS_WORKDAY: "IS_WORKDAY",
  // ── Time, video timecode (packages/time/) ──
  // Fused from a raw `HH:MM:SS:FF` token sequence (see
  // packages/time/normalizer/VideoTimecodeNormalizerRule.ts) and from
  // `NUMBER frames` (see FrameCountNormalizerRule.ts), not a bare-keyword
  // collision risk the way the datetime tokens above are, since neither
  // fusion claims a plain English word as its own token type.
  VIDEO_TIMECODE: "VIDEO_TIMECODE",
  FRAME_COUNT: "FRAME_COUNT",
  // "@". See ExpressionLexer.ts's OP_MAP entry for why this was
  // previously dormant/unproduced despite being anticipated by name here
  // and in TokenNormalizer.ts's NON_WORD_NAMES.
  AT: "AT",
  // Generic token for every currency symbol added AFTER the original
  // DOLLAR/POUND/EURO/YEN/RUBLE/WON set (each of which kept its own
  // specific token type for backward compatibility). See
  // uom/CurrencyAliases.ts's CURRENCY_SYMBOL_ALIASES and
  // ExpressionLexer.ts's dispatch for the full symbol list. One shared
  // type avoids needing a new TokenTypes entry + TokenCategoryMap entry +
  // CurrencyPackage.ts prefixParselets entry per additional symbol.
  CURRENCY_SYMBOL: "CURRENCY_SYMBOL",
  // ── Cross-line data access (packages/lines/) ──
  // "prev" -- bare keyword (nothing to phrase-fuse against, same shape as
  // CLAMP -- accepted collision risk per that package's own precedent).
  PREV: "PREV",
  // "line1" / "line 1" / "l1" -- fused by LineRefNormalizerRule (never a
  // bare lexer keyword, so ":line = 5"/":l = 5" stay untouched). Carries
  // the parsed line number as its .value.
  LINE_REF: "LINE_REF",
  // "sum(" / "total(" -- fused ONLY when immediately followed by LPAREN
  // (see LineRefNormalizerRule's lookahead guard), so ":sum = 100" and
  // MathPhrases' "total of X, Y" (no paren after "of") are unaffected.
  SUM_RANGE_CALL: "SUM_RANGE_CALL",
  AVERAGE_RANGE_CALL: "AVERAGE_RANGE_CALL",
  // "total above" / "sum above" / "average above" -- phrase-fused (see
  // LinesPackage.ts's `phrases` field), a deliberate departure from
  // Numi/Numbr's bare "total"/"sum" wording to avoid the exact bare-
  // keyword collision this codebase already regressed on once.
  TOTAL_ABOVE: "TOTAL_ABOVE",
  SUM_ABOVE: "SUM_ABOVE",
  AVERAGE_ABOVE: "AVERAGE_ABOVE",
} as const;

/**
 * A token's kind, as a string.
 *
 * Deliberately open rather than an enum: a package registers its own token
 * types at runtime, and a closed set would make that impossible.
 */
export type TokenType = (typeof TokenTypes)[keyof typeof TokenTypes];

// ── Integer Token Type ID System ──────────────────────────────────────────────
// Enables O(1) integer comparison in Parser hot path instead of string hashing.

/** Auto-incrementing integer ID for each token type. */
let _nextTokenTypeId = 0;

/** String → integer ID lookup. Populated lazily via registerTokenType(). */
const _tokenTypeNameToId = new Map<string, number>();

/** Integer ID → string lookup. For debug/error messages. */
const _tokenTypeIdToName = new Map<number, string>();

/**
 * Register a token type name and get back its integer ID.
 * Idempotent, returns existing ID if already registered.
 * Call once per token type at module initialization time.
 */
export function registerTokenType(name: string): number {
	const existing = _tokenTypeNameToId.get(name);
	if (existing !== undefined) return existing;
	const id = _nextTokenTypeId++;
	_tokenTypeNameToId.set(name, id);
	_tokenTypeIdToName.set(id, name);
	return id;
}

/**
 * Get the integer ID for a token type name.
 * Lazily registers unknown token types on first access, enabling plugin providers
 * to define custom token types (VEC2, VEC3, etc.) without pre-registration.
 * All built-in TokenTypes are pre-registered via registerAllTokenTypes().
 */
export function tokenTypeId(name: string): number {
	return registerTokenType(name);  // registerTokenType is idempotent
}

/**
 * Get the string name for a token type ID (for error messages and debugging).
 * Returns `UNKNOWN_${id}` if the ID is not registered.
 */
export function tokenTypeName(id: number): string {
	return _tokenTypeIdToName.get(id) ?? `UNKNOWN_${id}`;
}

/**
 * Bootstrap all known token types from TokenTypes at module load.
 * Call this once after TokenTypes is defined.
 */
export function registerAllTokenTypes(): void {
	for (const name of Object.values(TokenTypes)) {
		registerTokenType(name);
	}
}
