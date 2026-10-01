import { describe, expect, test } from "@jest/globals";
import { newTrackedEngine } from "@tools/trackedEngine";
import { evaluateDocument } from "@solve-js/engine/evaluateDocument";
import type { EngineConfigOverride } from "@solve-js/constants/Configuration";
import { ValueType, type Value } from "@solve-js/vm/Value";
import { ERROR_CODE_CATALOGUES } from "@solve-js/packages/ErrorCodeCatalogue";
import { BUILTIN_PACKAGES } from "@solve-js/packages/builtins";
import { createStocksPackage } from "@solve-js/packages/stocks";
import type { ParsingResult } from "@solve-js/types/ParsingResult";

/**
 * Issue #769: every catalogued code is one a line can produce, shown by an
 * example that produces it, or one no line can, with the reason.
 *
 * A catalogue that lists a code nothing raises is a promise about nothing,
 * and a code that only a host API, a package's registration or the network
 * can raise is worth saying so about: a host reading the reference should
 * know which codes its reader can cause by typing. So each code sits in
 * exactly one place here. A new code added to a catalogue with neither an
 * example nor a reason fails the first test, which is what flags a code
 * nothing can reach.
 *
 * Every example runs on a fresh engine with live data switched off, so none
 * of them depends on the network or on another example's variables. A line
 * is evaluated on its own, and the code is the one it throws or the one on
 * the error value it returns; a document is evaluated whole, through the
 * batch pass unless the example needs the incremental one (goal seek does),
 * and the code is the one on any of its lines or inline solves.
 */

/**
 * A line, or a document with the pass it needs, with settings where the
 * example needs a limit lowered and the stocks package where it is one of its
 * forms.
 */
type Example =
	| string
	| { readonly line: string; readonly config?: EngineConfigOverride; readonly stocks?: boolean; readonly doc?: undefined; readonly pass?: undefined }
	| { readonly doc: readonly string[]; readonly pass?: "parse" | "evaluate"; readonly config?: EngineConfigOverride; readonly stocks?: boolean };

const EXAMPLES: Readonly<Record<string, Example>> = {
	AGGREGATE_CALL_EMPTY: "mean()",
	AGGREGATE_NAME_RESERVED: "stdev(a) = a",
	AGGREGATE_NON_NUMERIC: "min(\"a\", 3)",
	ALLOCATION_LIMIT_EXCEEDED: { line: "map(x * 2, 0:100)", config: { vm: { maxAllocatedElements: 10 } } },
	AS_CONVERTER_EXPECTED_NAME: "1 as as",
	AS_CONVERTER_EXPECTED_NUMBER: "\"x\" as compact",
	AS_CONVERTER_UNSUPPORTED_BASE: "5 as base 40",
	AS_ISO8601_DURATION_TOO_LONG: "1e300 seconds as iso8601",
	AS_ISO8601_NEEDS_DATE: "5 kg as iso8601",
	AS_UNIT_EXPECTED_QUANTITY: "5 as n",
	AS_UNIT_INCOMPATIBLE: "5 kg as n",
	BASE_NOT_FINITE: "(1/0) in hex",
	BIGINT_DIVISION_BY_ZERO: "10n / 0",
	BIGINT_INEXACT_OPERAND: "e / 8n",
	BIGINT_POW_LIMIT_EXCEEDED: "2n ^ 100000",
	BIGINT_SHIFT_LIMIT_EXCEEDED: "1n << 66000",
	BUILTIN_ARITY_MISMATCH: "ln()",
	CASH_FLOW_EXPECTED_AMOUNT: "npv of true, 3 at 10%",
	CASH_FLOW_MISSING_RATE: "npv of -1000, 300, 400, 500",
	CASH_FLOW_OUT_OF_RANGE: "npv of [-1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] at -99.9999999%",
	CASH_FLOW_TOO_FEW: "irr of -1000",
	CHECK_FAILED: "check 3 < 3",
	CHECK_INCOMPARABLE: "check \"a\" < \"b\"",
	CHECK_JOIN_UNSUPPORTED: "check 1 == 1 or 1 == 2",
	NOT_NEEDS_BOOLEAN: "not 5",
	CLAMP_EXPECTED_BETWEEN_OR_FROM: "clamp 5 3",
	COLLECTION_TOO_LARGE: "map(10*x, 0:2000000000)",
	COLOUR_ARITHMETIC: "#ff0000 + 2",
	COLOUR_BAD_ARGUMENTS: "hsl(0)",
	COLOUR_EXPECTED_COLOUR: "mix(1, 2, 3)",
	COLOUR_INVALID: "color(\"#...\")",
	COMBINATION_OVERFLOW: "combination(1e12, 5e11)",
	COMPOUND_ASSIGN_REQUIRES_EXPRESSION: "z +=",
	CONSTANT_UNIT_UNSUPPORTED: "planck * $5",
	CONVERT_NON_NUMERIC: "#ff0000 in km",
	COOKING_CONVERSION_UNSUPPORTED_UNIT: "2 kg flour in metres",
	COOKING_UNKNOWN_INGREDIENT: "100g unobtainium in cups",
	DATETIME_NOT_CONVERTIBLE: "2026-04-03 in USD",
	DATETIME_ZONE_UNKNOWN: "2026-04-03 in Atlantis",
	DATE_EXPECTED: "age of 5",
	DATE_FIELD_EXPECTED_DATE: "90 days as week",
	DATE_NOT_A_CALENDAR_DAY: "2023-02-29",
	DATE_OFFSET_LIMIT_EXCEEDED: "today + 100000 workdays",
	DATE_ORDER_MISMATCH: "12.13.14",
	DATE_OUT_OF_RANGE: "(2^53) as iso8601",
	DESCENDING_RANGE: "sum(x, 5:1)",
	DETERMINANT_REQUIRES_SQUARE_MATRIX: "det([1,2,3;4,5,6])",
	DIMENSION_MISMATCH: "[1,2] + [1,2,3]",
	DIRECTION_CONTROL_IN_NAME: "\u202Erent = 5",
	DOCUMENT_ELEMENT_LIMIT_EXCEEDED: { doc: ["[1, 2, 3, 4, 5, 6]", "[1, 2, 3, 4, 5, 6]"], config: { vm: { maxRetainedElements: 8 } } },
	DOCUMENT_TOO_LARGE: { doc: ["1", "2", "3"], config: { performance: { maxDocumentLines: 2 } } },
	EMPTY_MATRIX_LITERAL: "[]",
	ENCODING_DECODE_FAILED: "\"not valid base64!\" from base64",
	ENCODING_EXPECTED_TEXT: "5 as base64",
	EQUATION_FACTOR_UNDEFINED: { doc: ["m * x = [1; 2]", "x =>"] },
	EQUATION_RHS_NOT_MATRIX: { doc: ["a = [1, 2; 3, 4]", "a * m = 5", "m =>"] },
	EQUATION_SEVERAL_UNKNOWNS: "(salary / 12) * rate / 100 = net",
	EXPECTED_IDENTIFIER: ":=",
	NAME_HAS_RESERVED_WORD: "take home = 5",
	NAME_HAS_QUOTE_MARK: "Alice‘s food = 3",
	EXPRESSION_TOO_COMPLEX: "(((((((((((((((((((((((((((((((((((((((((((((((((((((1)))))))))))))))))))))))))))))))))))))))))))))))))))))",
	EXPRESSION_TOO_LONG: { line: "1 + 1 + 1", config: { validation: { maxExpressionLength: 5 } } },
	FACTORIAL_OVERFLOW: "171!",
	FACTOR_TOO_LARGE: "factor(2^64 + 1)",
	FROZEN_DATE_EXPECTED: "2 + 2 frozen on",
	FROZEN_UNSUPPORTED: "f(x) = 2x frozen",
	FROZEN_VALUE_MISSING: "10 USD in GBP frozen on 2026-09-23",
	FUNCTION_ARITY_MISMATCH: { doc: ["g(x) = x", "g(1, 2)"] },
	FUNCTION_BODY_MUST_BE_SYNCHRONOUS: "f(x) = weather in London",
	FUNCTION_CALL_LIMIT_EXCEEDED: { doc: ["f(x) = x + 1", "f(f(f(1)))"], config: { vm: { maxFunctionCalls: 2 } } },
	FUNCTION_DOMAIN: "ln(0)",
	FUNCTION_RECURSION_LIMIT_EXCEEDED: { doc: ["f(x) = f(x)", "f(10)"] },
	FUNCTION_TAKES_NUMBER: "sin(1 m)",
	GAS_MARK_EXPECTED_TEMPERATURE: "5 kg in gas mark",
	GAS_MARK_OFF_THE_DIAL: "300C in gas mark",
	GAS_MARK_UNKNOWN: "gas mark 12",
	GEOMETRY_ERROR: "area of circle",
	GEOMETRY_EXPECTED_SHAPE: "area / circumference of a circle",
	GEO_BAD_ANGLE: "91°N",
	GEO_EXPECTED_ANGLE: "5 kg as dms",
	GEO_EXPECTED_PLACE: "distance from 5 to (0, 0)",
	GEO_EXPECTED_SECOND_PLACE: "distance from (0, 0)",
	GEO_NOT_A_PLACE: "51°N 48°N",
	GEO_NO_BEARING: "bearing from (0, 0) to (0, 0)",
	GEO_OUT_OF_RANGE: "distance from (91, 0) to (0, 0)",
	GOAL_SEEK_DID_NOT_CONVERGE: { doc: ["x = 5", "floor(x)", "solve line 2 for x = 2.5"], pass: "evaluate" },
	GOAL_SEEK_LINE_NOT_READY: { doc: ["x = 5", "solve line 5 for x = 20"], pass: "evaluate" },
	GOAL_SEEK_NESTED: { doc: ["x = 5", "solve line 2 for x = 20"], pass: "evaluate" },
	GOAL_SEEK_NON_FINITE: { doc: ["x = 5", "x / 0", "solve line 2 for x = 5"], pass: "evaluate" },
	GOAL_SEEK_NO_DOCUMENT: "solve line 1 for x = 20",
	GOAL_SEEK_TARGET_UNIT_MISMATCH: { doc: ["price = £10", "price * 3", "solve line 2 for price = 5 kg"], pass: "evaluate" },
	GOAL_SEEK_NO_SOLUTION: { doc: ["x = 5", "x * x", "solve line 2 for x = -4"], pass: "evaluate" },
	GOAL_SEEK_RANGE_INVALID: { doc: ["x = 5", "x * 2", "solve line 2 for x = 6 between 1 and 1"], pass: "evaluate" },
	GOAL_SEEK_SEVERAL_SOLUTIONS: { doc: [":p = 5 km", "p * p / 1 km", "solve line 2 for p = 4 km"], pass: "evaluate" },
	GOAL_SEEK_TOO_MANY_SOLUTIONS: { doc: ["x = 1", "sin(x)", "solve line 2 for x = 0.5"], pass: "evaluate" },
	GOAL_SEEK_REQUIRES_VARIABLE_NAME: { doc: ["x = 5", "x * 2", "solve line 2 for 5 = 20"] },
	GOAL_SEEK_SYNTAX: "solve line 1 x = 5",
	GOAL_SEEK_TARGET_IS_DEFINITION: { doc: ["x = 5", "y = x * 2", "solve line 2 for x = 20"], pass: "evaluate" },
	GOAL_SEEK_TARGET_NOT_NUMERIC: { doc: ["x = 5", "x * 2", "solve line 2 for x = 1/0"], pass: "evaluate" },
	GOAL_SEEK_VARIABLE_NOT_USED: { doc: ["x = 5", "y = 2", "solve line 2 for x = 20"], pass: "evaluate" },
	HASH_EXPECTED_TEXT: "md5(5)",
	HEALTH_BAD_INPUT: "bmi(70, 0)",
	INCOMPATIBLE_UNITS: "$5 + 3 m",
	INFLATION_EXPECTED_INFLATION_WORD: "value of $100 in 2030 assuming 3% banana",
	INFLATION_EXPECTED_USD: "£100 in 1990 dollars",
	INFLATION_NO_INDEX: "what is ¥100 from 1990",
	INFLATION_YEAR_OUT_OF_RANGE: "what is $100 from 1900",
	INSTRUCTION_LIMIT_EXCEEDED: { line: "1+2+3+4+5+6+7+8", config: { vm: { maxInstructions: 5 } } },
	INVALID_DATETIME_OP: "9am + 2",
	INVALID_DECIMAL_PLACES: "1.5 to 101 dp",
	INVALID_FACTORIAL_INPUT: "(3.5)!",
	INVALID_INTEGER_OPERAND: "gcd(4, 1/0 - 1/0)",
	INVALID_ISO8601_STRING: "\"not a real date\" to date",
	INVALID_MATRIX_SLICE_ARITY: "[1, 2][0:1]",
	INVALID_NUMBER_LITERAL: "0x",
	INVALID_RANGE: "roll(6, 1)",
	INVALID_RANGE_BOUND: "[1, 2; 3, 4][\"a\", 1:1]",
	INVALID_RATE: "5 kg at 60 mph",
	INVALID_RATE_UNIT: "$50/week per month",
	INVALID_ROUNDING_INCREMENT: "5 to nearest X",
	INVALID_SIGNIFICANT_FIGURES: "1234 to 0 sf",
	INVALID_TERM: "interest on £2,400 over 5 kg at 8%",
	INVALID_TIME_LITERAL: "5:60",
	INVERSE_REQUIRES_SQUARE_MATRIX: "inv([1,2,3;4,5,6])",
	IP_EXPECTED: "hosts in 5",
	IP_EXPECTED_BLOCK: "192.168.1.1 in 10.0.0.1",
	IP_NEEDS_ADDRESS_AND_PREFIX: "broadcast of 192.168.1.1",
	IP_NO_PREFIX: "netmask of 192.168.1.1",
	IP_PREFIX_OUT_OF_RANGE: "netmask of /200",
	IP_FAMILY_MISMATCH: "192.168.1.1 in 2001:db8::/32",
	IPV6_NO_BROADCAST: "broadcast of 2001:db8::/32",
	IPV6_ARITHMETIC: "fe80::1 + 2",
	IRR_NONE: "irr of -100, 250, -200",
	IRR_NOT_UNIQUE: "irr of -100, 230, -132",
	IRR_NO_SIGN_CHANGE: "irr of 0, 0",
	IRR_UNRESOLVED: "irr of -0.405, 1.71, -2.3, 1",
	IS_WHAT_EXPECTED_PERCENT: "20 is what of 200",
	IS_WHAT_EXPECTED_PREPOSITION: "20 is 10% banana",
	IS_WHAT_EXPECTED_WORD: "factoring is inverse to expansion",
	ISO_DURATION_MALFORMED: "P1H",
	LINE_NOT_YET_EVALUATED: { doc: ["line 2 + 1", "7"] },
	LINE_RANGE_EMPTY: { doc: ["# Heading", "total above"] },
	LINE_RANGE_NON_NUMERIC: { doc: ["1", "\"a\"", "total above"] },
	LINE_REFERENCE_DELETED: "line deleted * 2",
	LINE_REF_NO_DOCUMENT: "ans",
	LINE_RESULT_ERROR: { doc: ["5 kg + 3 m", "line 1 + 1"] },
	MAP_COLLECTION_LENGTH_MISMATCH: "map(10*y+x, x=[1,2,3], y=[3,4])",
	MAP_REDUCE_EXPECTED_COLLECTION_NAME: "map(x + y, x = [1, 2], [3, 4])",
	MAP_REDUCE_REQUIRES_COLLECTION: "map(x * 2, 5)",
	MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS: "sum(x * (weather in London), [1, 2])",
	MATRIX_CELL_NON_NUMERIC: "[\"a\", 1]",
	MATRIX_CELL_UNITS_DIFFER: "[$1, €2]",
	MATRIX_CELL_NO_UNIT: "[true, 1 km]",
	MATRIX_UNIT_OPERATION_UNSUPPORTED: "[1 km, 2 km] * 3 m",
	MATRIX_UNIT_ALGEBRA: "det([1 km, 2 km; 3 km, 4 km])",
	MATRIX_INDEX_NOT_A_MATRIX: "5[0]",
	MATRIX_INDEX_OUT_OF_BOUNDS: "[1,2][9]",
	MATRIX_POWER_REQUIRES_SQUARE_MATRIX: "[1,2,3]^2",
	MATRIX_POWER_REQUIRES_WHOLE_EXPONENT: "[1,2;3,4]^-2",
	MATRIX_POWER_UNSUPPORTED: "2^[1,2;3,4]",
	MISSING_WEEKDAY: "next",
	NESTING_DEPTH_EXCEEDED: { line: "((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((1))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))", config: { validation: { maxComplexity: 100000 } } },
	NETWORK_DISABLED: "10 USD in EUR",
	NON_INTEGER_RANGE_BOUND: "map(10*x, 1.5:3)",
	NOT_WHOLE_NUMBER: "5.5 choose 2",
	NO_MATCHING_PHRASE_ALTERNATIVE: "roll",
	NO_PREFIX_PARSELET: "~>",
	NTH_WEEKDAY_OUT_OF_RANGE: "5th Friday of April 2026",
	NUMBER_THEORY_DOMAIN: "factor(0)",
	NUMBER_THEORY_EXPECTED_INTEGER: "factor(3.5)",
	NUMBER_THEORY_NO_INVERSE: "modinv(4, 8)",
	NUMERAL_EXPECTED_NUMBER: "\"x\" as roman",
	NUMERAL_EXPECTED_TEXT: "5 from roman",
	NUMERAL_INVALID_ROMAN: "\"IIII\" from roman",
	NUMERAL_OUT_OF_RANGE: "0 as roman",
	OVERLAP_EXPECTED_CITY: "overlap of 9am to 5pm in",
	OVERLAP_EXPECTED_HOURS: "overlap of 9-5 in London and Paris",
	OVERLAP_EXPECTED_IN: "overlap of 9am to 5pm London and Paris",
	OVERLAP_HOURS_EMPTY: "overlap of 9am to 9am in London and Paris on 23 September 2026",
	OVERLAP_NEEDS_TWO_ZONES: "overlap of 9am to 5pm in London on 23 September 2026",
	PASS_WORK_BUDGET_EXCEEDED: { doc: ["x = 1", "x * 2", "line 2 for x from 1 to 5 step 1"], config: { vm: { maxLineRunsPerPass: 2 } } },
	PAYBACK_NEVER: "payback of -$1000, $100, $100",
	PAYBACK_NO_OUTLAY: "payback of 100, 200",
	PAYROLL_EXPECTED_GBP: "50000 after tax",
	PAYROLL_EXPECTED_RATE: "50000 after 120% tax",
	PAYROLL_CONFLICTING_CASE: "£50,000 after tax in Scotland in England",
	PAYROLL_EXPECTED_PENSION_RATE: "£50,000 after tax with 150% pension",
	PAYROLL_UNKNOWN_LOAN_PLAN: "£50,000 after tax with student loan",
	PAYROLL_NEGATIVE_SALARY: "-£50,000 after tax",
	PERCENTAGE_NOT_FINITE: "1/0 as %",
	PERCENTAGE_OVERFLOW: "1e308 as %",
	PERCENTAGE_OF_QUANTITY: "$5 as %",
	PERCENT_CHANGE_EXPECTED_TO: "percent change from 50",
	PERCENT_CHANGE_FROM_ZERO: "0 to 0",
	PERCENT_CHANGE_NEGATIVE_BASE: "-100 to 50",
	PERMUTATION_OVERFLOW: "permutation(1000000, 1000000)",
	PHRASE_KEYWORD_MISMATCH: "roll between 1 6",
	PLOT_EXPR_MUST_BE_SYNCHRONOUS: "plot weather in London from 1 to 2",
	PLOT_INVALID_RANGE: "plot x from 1 to 1/0",
	POWER_NO_REAL_VALUE: "(-1)^0.5",
	PROPORTION_DIVIDE_BY_ZERO: "0 is to 5 as 3 is to what",
	PROPORTION_EXPECTED_WHAT: "5 is to 3 as 3 is to 4",
	QUANTITY_NON_NUMERIC: "#ff0000 * 1 km",
	RAGGED_MATRIX_LITERAL: "[1, 2; 3]",
	RANDOM_EXPECTED_COUNT: "random hex -1",
	RANDOM_PICK_EMPTY: "pick()",
	RANDOM_SEED_EXPECTED_VALUE: "random seed",
	RANDOM_SHUFFLE_EXPECTED_LIST: "shuffle 5",
	RATE_MUL_MEASURE_MISMATCH: "30/week * 3 kg",
	RATIO_EXPECTED_NUMBERS: "ratio(\"a\", 2)",
	RATIO_INVALID: "ratio(5)",
	RECURRING_INTERVAL_NOT_POSITIVE: "100 every 0 weeks for 6 months",
	REMAINDER_EXPECTED_DIVIDED_BY: "remainder of 5",
	REMAINDER_UNDEFINED: "5 mod 0",
	QUOTIENT_UNDEFINED: "0/0",
	RESIZE_EXPECTED_SHAPE: "resize 1920x1080 to 5",
	ROOT_EXPECTED_OF: "root 5 100",
	SECTION_AMBIGUOUS: { doc: ["# March", "## Travel", "Train: $40", "# April", "## Travel", "Train: $55", "", "# Summary", "total of section \"Travel\""] },
	SECTION_EMPTY: { doc: ["# Travel", "", "# Summary", "total of section \"Travel\""] },
	SECTION_NOT_FOUND: { doc: ["# Travel", "Flights: $450", "", "# Summary", "total of section \"Travle\""] },
	SECTION_NO_DOCUMENT: "total of section \"Travel\"",
	SERVINGS_NOT_POSITIVE: "scale 0 servings to 6",
	SINGULAR_MATRIX: "[1, 2; 2, 4]^-1",
	SOLVE_REQUIRES_VARIABLE_NAME: "solve(x^2-4=0, 5)",
	SPARKLINE_NOT_A_SERIES: "5 as sparkline",
	STACK_LIMIT_EXCEEDED: { line: "1+(2+(3+(4+5)))", config: { vm: { maxStackDepth: 2 } } },
	STATISTIC_NOT_FINITE: "variance of (-1/0) m, 2 m",
	STAT_ARGUMENT_COUNT: "percentile([1, 2, 3])",
	STAT_COUNT_RANGE: "poissoncdf(2, -1)",
	STAT_EXPECTED_LIST: "zscore(5, 5)",
	STAT_EXPECTED_LISTS: "correlation of \"a\" and [1, 2]",
	STAT_EXPECTED_PERCENT: "percentile([1, 2], \"a\")",
	STAT_EXPECTED_VALUE: "erf(50%)",
	STAT_GAMMA_POLE: "gamma(0)",
	STAT_LENGTH_MISMATCH: "slope of [1, 2] and 5",
	STAT_NOT_WHOLE: "poissonpdf(2, 1.5)",
	STAT_NO_CONVERGENCE: "poissoncdf(1e12, 1e12)",
	STAT_OVERFLOW: "gamma(172)",
	STAT_PERCENT_RANGE: "percentile([1, 2], 900)",
	STAT_PROBABILITY_RANGE: "invnorm(1)",
	STAT_SD_NOT_POSITIVE: "normalinv(0.9, 100, 0)",
	STAT_TOO_FEW: "correlation of [1] and [2]",
	STOCKS_EXPECTED_DATE: { line: "stock(AAPL) on banana", stocks: true },
	STOCKS_EXPECTED_ON: { line: "stock(AAPL) close banana", stocks: true },
	STOCKS_INVALID_DATE: { line: "stock(AAPL) on 5 banana", stocks: true },
	STOCKS_INVALID_TICKER: { line: "stock(5)", stocks: true },
	SWEEP_ANSWER_NOT_NUMERIC: { doc: ["x = 5", "\"a\"", "line 2 for x from 1 to 3 step 1"] },
	SWEEP_DATE_STEP_NOT_DURATION: { doc: ["start = 2026-01-01", "finish = 2026-12-31", "working days between start and finish", "line 3 for start from 2026-01-01 to 2026-04-01 step 5"] },
	SCENARIO_UNKNOWN: { doc: ["x = 1", "x * 2", "line 2 under bull"] },
	SCENARIO_DUPLICATE: { doc: ["x = 1", "scenario a with x = 2", "scenario a with x = 3", "x * 10", "line 4 under a"] },
	SWEEP_OVER_BUDGET: { doc: ["k = 1", "sum(x, map(x*1, 1:99999)) * k", "line 2 for k from 1 to 20 step 1"] },
	SWEEP_RANGE_MISMATCH: { doc: ["x = 5", "x * 2", "line 2 for x from 1 to 3 kg step 1"] },
	SWEEP_RANGE_NOT_NUMERIC: { doc: ["x = 5", "x * 2", "line 2 for x from \"a\" to 3 step 1"] },
	SWEEP_REQUIRES_STEP: { doc: ["x = 5", "x * 2", "line 2 for x from 1 to 3"] },
	SWEEP_STEP_FAILED: { doc: ["k = 1", "k * zz", "line 2 for k from 1 to 3 step 1"] },
	SWEEP_STEP_WRONG_SIGN: { doc: ["x = 5", "x * 2", "line 2 for x from 1 to 3 step -1"] },
	SWEEP_STEP_ZERO: { doc: ["x = 5", "x * 2", "line 2 for x from 1 to 3 step 0"] },
	SWEEP_TOO_MANY_STEPS: { doc: ["x = 5", "x * 2", "line 2 for x from 1 to 1000000 step 1"] },
	SWEEP_TOO_MUCH_WORK: "line 201 for x from 1 to 1000 step 1",
	SYMBOLIC_ARGUMENT_MUST_BE_SYNCHRONOUS: "der(weather in London, x)",
	SYMBOLIC_BOUND_INVALID: "integral(x, x, 0, X)",
	SYMBOLIC_DERIVATIVE_ORDER_LIMIT: "der(x^2, x, 99)",
	SYMBOLIC_FACTOR_LIMIT_EXCEEDED: "factor(735134400x^2 - 25626846353)",
	SYMBOLIC_INTEGRAL_IMPROPER: "integral(1/x, x, 0, 1)",
	SYMBOLIC_INTEGRAL_UNSETTLED: "integral(tan(x), x, 0, 2)",
	SYMBOLIC_INTEGRAL_UNSUPPORTED: "integral(exp(x^2), x)",
	SYMBOLIC_INVERSE_DIMENSION_LIMIT: { doc: ["m = [a, 1, 1, 1, 1, 1, 1, 1, 1; 1, a, 1, 1, 1, 1, 1, 1, 1; 1, 1, a, 1, 1, 1, 1, 1, 1; 1, 1, 1, a, 1, 1, 1, 1, 1; 1, 1, 1, 1, a, 1, 1, 1, 1; 1, 1, 1, 1, 1, a, 1, 1, 1; 1, 1, 1, 1, 1, 1, a, 1, 1; 1, 1, 1, 1, 1, 1, 1, a, 1; 1, 1, 1, 1, 1, 1, 1, 1, a]", "inv(m)"] },
	SYMBOLIC_JACOBIAN_NO_VARIABLES: "jacobian(2+2)",
	SYMBOLIC_LIMIT_DIVERGES: "limit(1/x^2, x, 0)",
	SYMBOLIC_LIMIT_SIDES_DISAGREE: "limit(abs(x)/x, x, 0)",
	SYMBOLIC_LIMIT_UNDEFINED: "limit(sqrt(-x^2-1), x, 0)",
	SYMBOLIC_LIMIT_UNSETTLED: "limit(sin(1/x), x, 0)",
	SYMBOLIC_LIMIT_UNSUPPORTED: "limit(sin(x)/a, x, 0)",
	SYMBOLIC_NONFINITE_OPERAND: "0^-1 * x =>",
	SYMBOLIC_QUANTITY_OPERAND: "foo * 5 km =>",
	SYMBOLIC_RATIONAL_OVERFLOW: "expand((x + 2^400)^20)",
	SYMBOLIC_REQUIRES_BOTH_BOUNDS: "integral(x^2, x, 0)",
	SYMBOLIC_REQUIRES_LIMIT_POINT: "limit(sin(x)/x, x)",
	SYMBOLIC_REQUIRES_VARIABLE_NAME: "der(x^2, 5)",
	SYMBOLIC_SINGULAR_OR_UNSUPPORTED_PIVOT: { doc: ["m = [a, b; a, b]", "inv(m)"] },
	SYMBOLIC_SOLVE_NO_ROOT_FOUND: "solve(1/x=0, x)",
	SYMBOLIC_SOLVE_TOO_MANY_ROOTS: "solve(sin(x)=0, x)",
	SYMBOLIC_SOLVE_UNSUPPORTED: "solve(x^2 = X, x)",
	SYMBOLIC_TAYLOR_DEGREE_LIMIT: "taylor(exp(x), x=0, 99)",
	SYMBOLIC_TAYLOR_INEXACT: "taylor(sqrt(x), x = 2, 3)",
	SYMBOLIC_FORMULA_VALUE_UNSUPPORTED: { doc: ["y = x + 1", "x = $5", "y + x"] },
	SYMBOLIC_UNSUPPORTED_FUNCTION: "k = min(r, n-r)",
	TABLE_BANDS_MALFORMED: { doc: ["| up to | rate |", "| --- | --- |", "| 10,000 | 0% |", "| 40,000 | 20% |", "", "45,000 through bands above"] },
	TABLE_BANDS_NOT_FROM_ZERO: { doc: ["| from | rate |", "| --- | --- |", "| 10,000 | 20% |", "| 40,000 | 40% |", "", "45,000 through bands above"] },
	TABLE_BAND_AMOUNT_INVALID: { doc: ["| from | rate |", "| --- | --- |", "| 0 | 20% |", "| 40,000 | 40% |", "", "-5 through bands above"] },
	TABLE_BAND_BELOW_FIRST: { doc: ["| from | rate |", "| --- | --- |", "| 10,000 | 20% |", "| 40,000 | 40% |", "", "column \"rate\" for 5,000 in bands above"] },
	TABLE_BAND_UNIT_MISMATCH: { doc: ["| from | rate |", "| --- | --- |", "| $0 | 20% |", "| $40,000 | 40% |", "", "€45,000 through bands above"] },
	TABLE_CELL_EMPTY: { doc: ["| a | b |", "| --- | --- |", "| x | |", "column \"b\" for \"x\""] },
	TABLE_CELL_NOT_A_VALUE: { doc: ["| a | b |", "| --- | --- |", "| x | y |", "column \"b\" for \"x\""] },
	TABLE_COLUMN_AMBIGUOUS: { doc: ["| a | a |", "| --- | --- |", "| x | 5 |", "column \"a\" for \"x\""] },
	TABLE_COLUMN_NAME_EXPECTED: { doc: ["| a |", "| --- |", "| 5 |", "sum of column"] },
	TABLE_COLUMN_NOT_FOUND: { doc: ["| a |", "| --- |", "| 5 |", "sum of column \"b\""] },
	TABLE_COLUMN_NO_NUMERIC_CELLS: { doc: ["| a |", "| --- |", "| x |", "sum of column \"a\""] },
	TABLE_COLUMN_PERCENT_CELL: { doc: ["| a |", "| --- |", "| 5% |", "sum of column \"a\""] },
	TABLE_LOOKUP_FOR_EXPECTED: { doc: ["| a |", "| --- |", "| 5 |", "column \"a\" 5"] },
	TABLE_LOOKUP_KEY_INVALID: { doc: ["| a | b |", "| --- | --- |", "| x | 5 |", "column \"b\" for 5 kg"] },
	TABLE_NOT_FOUND: { doc: ["sum of column \"cost\""] },
	TABLE_NO_DOCUMENT: "sum of column \"cost\"",
	TABLE_ROW_AMBIGUOUS: { doc: ["| a | b |", "| --- | --- |", "| x | 5 |", "| x | 6 |", "column \"b\" for \"x\""] },
	TABLE_ROW_NOT_FOUND: { doc: ["| a | b |", "| --- | --- |", "| x | 5 |", "column \"b\" for \"y\""] },
	TAG_BREAKDOWN_NO_WHOLE: { doc: ["$40 #food", "-$40 #refund", "total by tag"] },
	TAG_EMPTY: { doc: ["total of #food"] },
	TAG_NON_NUMERIC: { doc: ["\"x\" #food", "total by tag"] },
	TAG_NO_DOCUMENT: "sum of #a",
	TEXT_ARGUMENT_COUNT: "match()",
	TEXT_ARITHMETIC: "9 / \"\"",
	TEXT_COMPARISON: "\"5\" > 3",
	TEXT_EXPECTED: "42 as upper",
	TEXT_FIELD_INEXACT_NUMBER: "field(\"{\\\"a\\\": 12345678901234567890}\", \"a\")",
	TEXT_FIELD_NOT_FOUND: "field(\"{\\\"a\\\": 1}\", \"b\")",
	TEXT_FIELD_NULL: "field(\"{\\\"a\\\": null}\", \"a\")",
	TEXT_FIELD_PATH_INVALID: "field(\"{\\\"a\\\": 1}\", \"a..b\")",
	TEXT_NOT_A_NUMBER: "\"\" as number",
	TEXT_NOT_JSON: "field(\"Total: 12\", \"Total\")",
	TEXT_NO_AMOUNTS: "amounts in \"12 EURO\"",
	TEXT_NO_MATCH: "match(\"TOTAL: 42\", \"total\")",
	TEXT_NO_NUMBERS: "numbers in \"nothing here\"",
	TEXT_PATTERN_INVALID: "match(\"abc\", \"(a\")",
	TEXT_PATTERN_TOO_COSTLY: "matchcount(\"a\" repeated 1000000 times, \"a\")",
	TEXT_PATTERN_TOO_LARGE: "match(\"abc\", \"a{2000}\")",
	TEXT_PATTERN_UNSUPPORTED: "match(\"abc\", \"a(?=b)\")",
	TEXT_TOO_MANY_NUMBERS: "total of numbers in (\"7 \" repeated 900000 times)",
	THEREFORE_REQUIRES_EXPRESSION: "=>",
	TIMECODE_EXPECTED_FPS: "10:00:00:00 in frames",
	TIMECODE_EXPECTED_FRAMES: "10:00:00:00 at 30 fps in banana",
	TIMECODE_FPS_MISMATCH: "00:00:01:00 at 30 fps - 00:00:01:00 at 25 fps",
	TIMECODE_FRAME_OUT_OF_RANGE: "00:00:00:30 at 30 fps",
	TIME_DIFFERENCE_EXPECTED_CITY: "time difference between Atlantis and Tokyo",
	TIME_DIFFERENCE_EXPECTED_SECOND_CITY: "time difference between London and 5",
	TIME_ZONE_EXPECTED_CITY: "time in X",
	TIME_ZONE_EXPECTED_DATE: "3pm on 5",
	TIME_ZONE_EXPECTED_IN: "6pm Sydney",
	TIME_ZONE_EXPECTED_TIME: { doc: ["t = 5", "t London in Tokyo"] },
	TIME_ZONE_EXPECTED_TARGET: "6pm Sydney in",
	TIME_ZONE_MISSING_DATE: "3pm on",
	TIME_ZONE_REPEATED_TIME: "1:30am London on 25 October 2026 in Tokyo",
	TIME_ZONE_SKIPPED_TIME: "1:30am London on 29 March 2026 in Tokyo",
	TIME_ZONE_TOO_MANY: "9:00 London in Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid, Paris, Tokyo, Rome, Oslo, Madrid",
	TIME_ZONE_UNKNOWN: "3pm London in Tokyo and Atlantis",
	TOO_MANY_ANONYMOUS_BODIES: { line: "map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])+map(x*1, [1])", config: { validation: { maxComplexity: 1000000, maxExpressionLength: 100000, maxNestingDepth: 10000 } } },
	TOO_MANY_NUMERIC_CONSTANTS: { line: "1+2+3+4+5+6+7+8+9+10+11+12+13+14+15+16+17+18+19+20+21+22+23+24+25+26+27+28+29+30+31+32+33+34+35+36+37+38+39+40+41+42+43+44+45+46+47+48+49+50+51+52+53+54+55+56+57+58+59+60+61+62+63+64+65+66+67+68+69+70+71+72+73+74+75+76+77+78+79+80+81+82+83+84+85+86+87+88+89+90+91+92+93+94+95+96+97+98+99+100+101+102+103+104+105+106+107+108+109+110+111+112+113+114+115+116+117+118+119+120+121+122+123+124+125+126+127+128+129+130+131+132+133+134+135+136+137+138+139+140+141+142+143+144+145+146+147+148+149+150+151+152+153+154+155+156+157+158+159+160+161+162+163+164+165+166+167+168+169+170+171+172+173+174+175+176+177+178+179+180+181+182+183+184+185+186+187+188+189+190+191+192+193+194+195+196+197+198+199+200+201+202+203+204+205+206+207+208+209+210+211+212+213+214+215+216+217+218+219+220+221+222+223+224+225+226+227+228+229+230+231+232+233+234+235+236+237+238+239+240+241+242+243+244+245+246+247+248+249+250+251+252+253+254+255+256+257+258+259+260+261+262+263+264+265+266+267+268+269+270+271+272+273+274+275+276+277+278+279+280+281+282+283+284+285+286+287+288+289+290+291+292+293+294+295+296+297+298+299+300", config: { validation: { maxComplexity: 100000, maxExpressionLength: 100000 } } },
	TOO_MANY_STRING_CONSTANTS: { line: "\"s1\"+\"s2\"+\"s3\"+\"s4\"+\"s5\"+\"s6\"+\"s7\"+\"s8\"+\"s9\"+\"s10\"+\"s11\"+\"s12\"+\"s13\"+\"s14\"+\"s15\"+\"s16\"+\"s17\"+\"s18\"+\"s19\"+\"s20\"+\"s21\"+\"s22\"+\"s23\"+\"s24\"+\"s25\"+\"s26\"+\"s27\"+\"s28\"+\"s29\"+\"s30\"+\"s31\"+\"s32\"+\"s33\"+\"s34\"+\"s35\"+\"s36\"+\"s37\"+\"s38\"+\"s39\"+\"s40\"+\"s41\"+\"s42\"+\"s43\"+\"s44\"+\"s45\"+\"s46\"+\"s47\"+\"s48\"+\"s49\"+\"s50\"+\"s51\"+\"s52\"+\"s53\"+\"s54\"+\"s55\"+\"s56\"+\"s57\"+\"s58\"+\"s59\"+\"s60\"+\"s61\"+\"s62\"+\"s63\"+\"s64\"+\"s65\"+\"s66\"+\"s67\"+\"s68\"+\"s69\"+\"s70\"+\"s71\"+\"s72\"+\"s73\"+\"s74\"+\"s75\"+\"s76\"+\"s77\"+\"s78\"+\"s79\"+\"s80\"+\"s81\"+\"s82\"+\"s83\"+\"s84\"+\"s85\"+\"s86\"+\"s87\"+\"s88\"+\"s89\"+\"s90\"+\"s91\"+\"s92\"+\"s93\"+\"s94\"+\"s95\"+\"s96\"+\"s97\"+\"s98\"+\"s99\"+\"s100\"+\"s101\"+\"s102\"+\"s103\"+\"s104\"+\"s105\"+\"s106\"+\"s107\"+\"s108\"+\"s109\"+\"s110\"+\"s111\"+\"s112\"+\"s113\"+\"s114\"+\"s115\"+\"s116\"+\"s117\"+\"s118\"+\"s119\"+\"s120\"+\"s121\"+\"s122\"+\"s123\"+\"s124\"+\"s125\"+\"s126\"+\"s127\"+\"s128\"+\"s129\"+\"s130\"+\"s131\"+\"s132\"+\"s133\"+\"s134\"+\"s135\"+\"s136\"+\"s137\"+\"s138\"+\"s139\"+\"s140\"+\"s141\"+\"s142\"+\"s143\"+\"s144\"+\"s145\"+\"s146\"+\"s147\"+\"s148\"+\"s149\"+\"s150\"+\"s151\"+\"s152\"+\"s153\"+\"s154\"+\"s155\"+\"s156\"+\"s157\"+\"s158\"+\"s159\"+\"s160\"+\"s161\"+\"s162\"+\"s163\"+\"s164\"+\"s165\"+\"s166\"+\"s167\"+\"s168\"+\"s169\"+\"s170\"+\"s171\"+\"s172\"+\"s173\"+\"s174\"+\"s175\"+\"s176\"+\"s177\"+\"s178\"+\"s179\"+\"s180\"+\"s181\"+\"s182\"+\"s183\"+\"s184\"+\"s185\"+\"s186\"+\"s187\"+\"s188\"+\"s189\"+\"s190\"+\"s191\"+\"s192\"+\"s193\"+\"s194\"+\"s195\"+\"s196\"+\"s197\"+\"s198\"+\"s199\"+\"s200\"+\"s201\"+\"s202\"+\"s203\"+\"s204\"+\"s205\"+\"s206\"+\"s207\"+\"s208\"+\"s209\"+\"s210\"+\"s211\"+\"s212\"+\"s213\"+\"s214\"+\"s215\"+\"s216\"+\"s217\"+\"s218\"+\"s219\"+\"s220\"+\"s221\"+\"s222\"+\"s223\"+\"s224\"+\"s225\"+\"s226\"+\"s227\"+\"s228\"+\"s229\"+\"s230\"+\"s231\"+\"s232\"+\"s233\"+\"s234\"+\"s235\"+\"s236\"+\"s237\"+\"s238\"+\"s239\"+\"s240\"+\"s241\"+\"s242\"+\"s243\"+\"s244\"+\"s245\"+\"s246\"+\"s247\"+\"s248\"+\"s249\"+\"s250\"+\"s251\"+\"s252\"+\"s253\"+\"s254\"+\"s255\"+\"s256\"+\"s257\"+\"s258\"+\"s259\"+\"s260\"+\"s261\"+\"s262\"+\"s263\"+\"s264\"+\"s265\"+\"s266\"+\"s267\"+\"s268\"+\"s269\"+\"s270\"+\"s271\"+\"s272\"+\"s273\"+\"s274\"+\"s275\"+\"s276\"+\"s277\"+\"s278\"+\"s279\"+\"s280\"+\"s281\"+\"s282\"+\"s283\"+\"s284\"+\"s285\"+\"s286\"+\"s287\"+\"s288\"+\"s289\"+\"s290\"+\"s291\"+\"s292\"+\"s293\"+\"s294\"+\"s295\"+\"s296\"+\"s297\"+\"s298\"+\"s299\"+\"s300\"", config: { validation: { maxComplexity: 100000, maxExpressionLength: 100000 } } },
	TRACE_CYCLE: { doc: ["line 2 + 5", "line 1 + 5", "inputs of line 2"] },
	TRACE_FORWARD_REFERENCE: { doc: ["inputs of line 2", "5"] },
	TRIG_UNDEFINED: "tand(90)",
	TRIP_EXPECTED_AT: "cost to drive 100 km",
	TRIP_EXPECTED_DISTANCE: "fuel for 50 kg at 7 l/100km",
	TRIP_EXPECTED_ECONOMY: "fuel for 500 km at 35 kg",
	TRIP_EXPECTED_FUEL_PRICE: "cost to drive 300 miles at 35 mpg at 5 kg",
	UNCERTAINTY_UNIT_MISMATCH: "5 +/- 1 cm",
	UNCERTAINTY_WITHOUT_UNIT: "(5 +/- 0.1) km",
	UNDEFINED_FUNCTION: "f()",
	UNDEFINED_VARIABLE: "fs",
	UNEXPECTED_END_OF_INPUT: "a/",
	UNEXPECTED_TOKEN_TYPE: "map(x)",
	UNEXPECTED_TRAILING_TOKEN: "5.",
	UNIT_AFTER_UNIT: "$5 kg",
	UNIT_IN_EXPONENT: "2^(3 m)",
	UNIT_POWER_UNSUPPORTED: "2s^2",
	UNIT_PRODUCT_UNSUPPORTED: "$5 * $3",
	UNIT_QUOTIENT_UNSUPPORTED: "10 kg / (5 m/s)",
	UNIT_RECIPROCAL_UNSUPPORTED: "1 / (20 C)",
	UNIT_ROOT_UNSUPPORTED: "sqrt(4 m)",
	UNKNOWN_AS_CONVERTER: "5 as a",
	UNKNOWN_COMPOUNDING_INTERVAL: "$1,000 for 3 years at 7% compounding hourly",
	SAVINGS_GOAL_SYNTAX: "how much per month to reach $10,000 for 2 years",
	UNKNOWN_SAVINGS_PERIOD: "how long to save $10,000 at $500 fortnightly",
	UNKNOWN_UNIT: "5 in X",
	UNTERMINATED_STRING: "12\"",
	USER_FUNCTION_INVALID_PARAM_NAME: "f(1) = 1",
	USER_FUNCTION_NO_PARAMS: "f() = 1",
	VS_INCOMPARABLE: "500g vs £4",
	WEATHER_EXPECTED_CITY: "low in",
	WEB_EXPECTED_PIXELS: "1920.5x1080 as ratio",
	WEB_EXPECTED_PX_OR_REM: "5 kg at 20px base",
	WEB_EXPECTED_ROOT_SIZE: "1.5rem at 0px base",
	WEIGHTED_AVERAGE_MISSING_WEIGHT: "weighted average of 72, 88",
	WEIGHTED_AVERAGE_ZERO_WEIGHT: "weighted average of 5 at 0%, 6 at 0%",
	WHAT_IF_DUPLICATE_INPUT: { doc: ["x = 5", "x * 2", "line 2 with x = 6 and x = 7"] },
	WHAT_IF_INPUT_NOT_USED: { doc: ["x = 5", "x * 2", "line 2 with y = 5"] },
	WHAT_IF_IN_GOAL_SEEK: { doc: ["k = 1", "x = 1", "x * 2", "(line 3 with x = 5) * k", "solve line 4 for k = 30"], pass: "evaluate" },
	WHAT_IF_LINE_OUT_OF_RANGE: { doc: ["x = 5", "x * 2", "line 9 with x = 5"] },
	WHAT_IF_NESTED: { doc: ["x = 1", "x * 2", "line 2 for x from 1 to 3 step 1", "line 3 with x = 5"] },
	WHAT_IF_NO_DOCUMENT: "line 1 with x = 5",
	WHAT_IF_TARGETS_ITSELF: { doc: ["line 1 with x = 5"] },
	WHAT_IF_TARGET_ERROR: { doc: ["k = 1", "k * zz", "line 2 with k = 3"] },
	WHAT_IF_TARGET_HAS_SEVERAL_ANSWERS: { doc: ["x = 5", "y = s`x` and s`x + 1`", "line 2 with x = 6"] },
	WHAT_IF_TARGET_NOT_A_CALCULATION: { doc: ["x = 5", "x * 2", "", "line 3 with x = 1"] },
	WHAT_IF_TOO_MANY_INPUTS: { doc: ["x = 5", "x * 2", "line 2 with v0 = 0 and v1 = 1 and v2 = 2 and v3 = 3 and v4 = 4 and v5 = 5 and v6 = 6 and v7 = 7 and v8 = 8 and v9 = 9 and v10 = 10 and v11 = 11 and v12 = 12 and v13 = 13 and v14 = 14 and v15 = 15 and v16 = 16"] },
	WHAT_IF_WRITES_GLOBAL: { doc: ["global :g = 5", "line 1 with x = 5"] },
	WORKDAYS_BETWEEN_EXPECTED_DATES: "working days between 2024-01-01 and 5",
	WORKDAYS_BETWEEN_RANGE_TOO_LARGE: "working days between 1900-01-01 and 2400-01-01",
	WORKDAYS_IN_EXPECTED_DURATION: "workdays in 5 kg",
	WORKDAYS_UNTIL_UNSUPPORTED: "workdays until",
	WORKDAY_OFFSET_EXPECTED_DATE: "5 working days after 3",
	// The as-converter prefix refusals (#824), the named-offset range (#730) and a stated density (#749).
	AS_CONVERTER_AMBIGUOUS_CASE: "5 W as mw",
	AS_CONVERTER_PREFIX_CASE: "1 V as MV",
	TIME_ZONE_OFFSET_OUT_OF_RANGE: "2026-04-03 in UTC+25",
	DENSITY_EXPECTED_NUMBER: "4000px at d dpi",
	WEB_EXPECTED_DENSITY: "4000px at 0 dpi",
	WEB_EXPECTED_PIXELS_OR_LENGTH: "5 kg at 300 dpi",
	// float and as multiplier refuse what has no plain number (#828, #829).
	FLOAT_TAKES_NUMBER: "float(\"hello\")",
	MULTIPLIER_TAKES_NUMBER: "\"hello\" as multiplier",
};

/** Raised by a host calling the engine, never by a line it evaluates. */
const HOST_API: Readonly<Record<string, string>> = {
	CALENDAR_TEMPORAL_UNAVAILABLE: "the calendar engine option, asking for Temporal on a runtime without it",
	CONFIG_PATH_NOT_FOUND: "the configuration manager's get and set, given a path that does not exist",
	CONFIG_PROPERTY_NOT_FOUND: "the configuration manager's get and set, given a property that does not exist",
	CONFIG_SECTION_NOT_FOUND: "the configuration manager's get and set, given a section that does not exist",
	DATE_CLOCK_INVALID: "a calendar backend's now option, a host clock that is not a function or answers no moment in time",
	DATE_INPUT_LOCALE_INVALID: "the date.inputLocale setting, given something that is not a locale tag",
	DATE_ZONE_UNKNOWN: "dateCalendarInZone, given a zone the runtime cannot compute in",
	DEFINE_FUNCTION_ARGUMENT_TYPE: "a host's own function from defineFunction, which no built-in line calls",
	DEFINE_FUNCTION_ARITY_MISMATCH: "a host's own function from defineFunction, which no built-in line calls",
	DEFINE_FUNCTION_INVALID_NAME: "defineFunction, building a host's own function",
	DEFINE_FUNCTION_INVALID_SPEC: "defineFunction, building a host's own function",
	DEFINE_FUNCTION_RETURN_TYPE: "a host's own function from defineFunction, which no built-in line calls",
	EXPLAIN_ASYNC_UNSUPPORTED: "engine.explainLine, asked to derive a line that waits on live data",
	INVALID_CONFIG_PATH: "the configuration manager's get and set, given a path not written as section.property",
	SNAPSHOT_MALFORMED: "ExpressionEngine.fromJSON, given a snapshot whose contents do not hold together",
	SNAPSHOT_PACKAGE_MISSING: "ExpressionEngine.fromJSON, restoring onto an engine without a package the snapshot calls",
	SNAPSHOT_UNSUPPORTED_VALUE: "engine.toJSON, meeting a value the snapshot format cannot hold",
	SNAPSHOT_VERSION_MISMATCH: "ExpressionEngine.fromJSON, given something that is not a snapshot of this version",
	TEMPORAL_IMPLEMENTATION_INVALID: "createTemporalCalendar, given something that is not a Temporal implementation",
	TEMPORAL_TIME_ZONE_UNKNOWN: "createTemporalCalendar, given a zone Temporal does not know",
	TRACE_NO_DOCUMENT: "engine.traceLine, called with no document to read",
	TRACE_NO_SUCH_LINE: "engine.traceLine, asked for a line the document does not have",
	WHAT_IF_OVERRIDE_INVALID: "engine.whatIf, given an override that is not a name and a value",
	SETTLE_TIMEOUT: "engine.settle, reaching its deadline with a fetch still in flight",
	SETTLE_TIMEOUT_INVALID: "engine.settle, given a timeoutMs that is not a finite number of zero or more",
	WORKER_CANCELLED: "the worker client, when the host aborts a request",
	WORKER_NOT_INITIALISED: "the worker runtime, given a request before its init",
	WORKER_TERMINATED: "the worker client, when the host terminates the worker",
	WORKER_TRANSPORT_FAILED: "the worker client, when the transport fails",
	WORKER_UNKNOWN_METHOD: "the worker runtime, given a request by a method it does not have",
	WORKER_UNKNOWN_PACKAGE: "the worker runtime, given an init naming a package it cannot resolve",
	WORKER_ARGUMENT_NOT_CLONEABLE: "the worker client, given a call argument postMessage cannot copy",
};

/** Raised while a package registers, or by a package the built-in set does not include. */
const PACKAGE_AUTHORING: Readonly<Record<string, string>> = {
	BYTECODE_OPERAND_OUT_OF_RANGE: "a package's parselet emitting an operand outside a byte",
	CRYPTO_NOT_CONFIGURED: "a host registering the crypto package without a fetchPrice; the built-in set does not register it",
	INVALID_PHRASE_PATTERN: "a package defining a phrase pattern whose alternative does not start with a keyword",
	KNOWLEDGE_NOT_CONFIGURED: "a host registering the knowledge package without an answerQuery; the built-in set does not register it",
	OPCODE_POOL_EXHAUSTED: "registering more packages with opcodes of their own than the range holds",
	PACKAGE_ENGINE_VERSION_INVALID_RANGE: "registering a package whose engineVersion is not a semver range",
	PACKAGE_ENGINE_VERSION_MISMATCH: "registering a package whose engineVersion range excludes this engine",
	PLUGIN_CALL_FUSION_UNREACHABLE: "registering a package whose callFusions name a word the engine already reads",
	PLUGIN_UNIT_ALIAS_UNREACHABLE: "registering a package whose unitAliases name a word the engine already reads",
	PLUGIN_UNIT_ALIAS_TARGET_UNKNOWN: "registering a package whose unitAliases map a word to no unit the engine reads",
	PLUGIN_FUNCTION_INDEX_POOL_EXHAUSTED: "registering more plugin functions than a compiled call can index",
	PLUGIN_FUNCTION_INDEX_TOO_LARGE: "registering more plugin functions than a compiled call can index",
	PLUGIN_KEYWORD_COLLISION: "registering a package that claims a built-in keyword",
	PLUGIN_OPERATOR_COLLISION: "registering a package that claims a built-in operator",
	PLUGIN_OPERATOR_UNSUPPORTED: "registering a package with an operator the scanner cannot read",
	PLUGIN_UNIT_COLLISION: "registering a package that claims a built-in unit",
	UNKNOWN_PLUGIN_FUNCTION: "a package whose parselet calls a plugin function it never registered",
};

/** Raised only once live data is fetched, which every example here keeps switched off. */
const LIVE_DATA: Readonly<Record<string, string>> = {
	"<NAMESPACE>_NOT_PREFLIGHTED": "a live value read before its fetch started, which preflight makes unreachable",
	"<NAMESPACE>_QUERY_FAILED": "a live fetch that fails, which needs the network",
	ASYNC_RESOLVER_FAILED: "a live fetch that fails several times in a row, which needs the network",
	COMPOUND_ASSIGN_ASYNC_UNSUPPORTED: "a running total still waiting on live data, which needs the network",
	CRYPTO_PRICE_API_ERROR: "the crypto price service answering with an error, which needs the network",
	CURRENCY_API_ERROR: "the exchange-rate service answering with an error, which needs the network",
	CURRENCY_RATE_UNAVAILABLE: "a conversion with the network on and no rate fetched, which needs the network",
	GLOBAL_VARIABLE_NOT_RESOLVED: "a global read before the shared store answers, which only an asynchronous store does",
	GOAL_SEEK_ASYNC_UNSUPPORTED: "a goal seek target waiting on live data, which needs the network",
	HISTORICAL_RATES_NOT_CONFIGURED: "a historical conversion on an engine whose host switched historical rates off, which runs in the async resolver",
	HISTORICAL_RATE_DATE_OUT_OF_RANGE: "a historical conversion for a day before 1999 or after today, refused by the built-in provider in the async resolver",
	HISTORICAL_RATE_NOT_PREFLIGHTED: "a historical rate read before its fetch started, which preflight makes unreachable",
	HISTORICAL_RATE_QUERY_FAILED: "a historical rate provider that throws, which runs in the async resolver",
	HISTORICAL_RATE_UNSUPPORTED_CURRENCY: "a historical conversion for a currency the ECB does not quote, refused by the built-in provider in the async resolver",
	LINE_RESULT_PENDING: "a line read while it waits on live data, which needs the network",
	PLUGIN_CALL_FAILED: "a plugin function whose promise rejects, which no built-in plugin returns",
	PLUGIN_RESULT_NOT_A_VALUE: "a plugin function whose promise resolves to something that is not a Value, which no built-in plugin returns",
	STOCKS_NOT_CONFIGURED: "a stock line on an engine whose stocks package has no provider, once the network is on; with it off, NETWORK_DISABLED answers first",
	THEREFORE_ASYNC_UNSUPPORTED: "a => line still waiting on live data, which needs the network",
	UNKNOWN_CURRENCY_CODE: "a fetched rate table without the code asked for, which needs the network",
	WEATHER_CITY_NOT_FOUND: "the geocoding service finding no place, which needs the network",
	WEATHER_FORECAST_API_ERROR: "the forecast service answering with an error, which needs the network",
	WEATHER_FORECAST_RESPONSE_MALFORMED: "the forecast service answering with a body it should not, which needs the network",
	WEATHER_GEOCODING_API_ERROR: "the geocoding service answering with an error, which needs the network",
	WEATHER_UNKNOWN_QUERY_KIND: "the weather client given a query kind no parselet emits",
	WHAT_IF_INPUT_PENDING: "a what-if input still waiting on live data, which needs the network",
	WHAT_IF_LIVE_DATA: "a what-if target still waiting on live data, which needs the network",
};

/** Run-time guards whose parse-time twin refuses the same line first. */
const BEHIND_A_PARSE_TIME_REFUSAL: Readonly<Record<string, string>> = {
	MAP_REDUCE_ASYNC_UNSUPPORTED: "the run-time guard behind MAP_REDUCE_TRANSFORM_MUST_BE_SYNCHRONOUS, which refuses the line first",
	SYMBOLIC_ASYNC_UNSUPPORTED: "the run-time guard behind SYMBOLIC_ARGUMENT_MUST_BE_SYNCHRONOUS, which refuses the line first",
	USER_FUNCTION_ASYNC_UNSUPPORTED: "the run-time guard behind FUNCTION_BODY_MUST_BE_SYNCHRONOUS, which refuses the definition first",
};

/** Codes whose form the normaliser or the parselet checks before the code could be raised. */
const GUARDED_BEFORE_IT: Readonly<Record<string, string>> = {
	CASH_FLOW_ARGUMENT_COUNT: "a guard: the cash-flow parselets always pass at least one flow",
	CHECK_EXPECTED_COMPARISON: "a guard: the normaliser only makes check a keyword before a comparison",
	COOKING_CONVERSION_REQUIRES_UNIT: "a guard: the normaliser only fuses a cooking conversion whose amount has a unit",
	DAYS_IN_EXPECTED_PERIOD: "a guard: the normaliser only fuses days in before a month, a quarter or a year",
	DIMENSIONS_EXPECTED_FORM: "a guard: the normaliser only fuses a width and a height before as ratio or after resize",
	EQUATION_FACTOR_NOT_MATRIX: "a guard: a factor that is not a matrix sends the equation to the scalar solver instead",
	GOAL_SEEK_TARGET_ERROR: "the fallback for a goal seek re-run that throws with no code, which every current failure supplies",
	INFLATION_EXPECTED_FROM_OR_IN: "a guard: the normaliser only fuses what is <amount> before from or in",
	INPUTS_OF_SYNTAX: "a guard: the normaliser only fuses inputs of before a line reference",
	INVALID_DECIMAL_LITERAL: "a guard: the lexer only makes a decimal literal of digits and one point",
	INVALID_MATRIX_SLICE_BOUND: "a guard: the parser only slices a matrix with a range written in each place",
	INVALID_WEEKDAY: "a guard: the parselet only passes the number of a real weekday",
	IP_EXPECTED_ADDRESS: "a guard: a prefix on its own (/24) is read only after netmask of, which answers an address",
	LOG_EXPECTED_BASE: "a guard: the normaliser only fuses log before a base",
	NORMALIZED_TOKEN_LIMIT_EXCEEDED: "a normaliser rule that grows a line's tokens, which no built-in rule does past the line-length limit",
	PERCENT_CHANGE_FAILED: "the fallback for a percentage change that fails with no code, which every current failure supplies",
	RATE_CONVERT_MEASURE_MISMATCH: "an opcode (RATE_CONVERT) no built-in parselet emits; a package may",
	RATE_CONVERT_NOT_A_RATE: "an opcode (RATE_CONVERT) no built-in parselet emits; a package may",
	RATE_MISSING_DENOMINATOR_UNIT: "an opcode (RATE_DIV) no built-in parselet emits; a package may",
	RATE_MUL_LEFT_NOT_A_RATE: "an opcode (RATE_MUL) no built-in parselet emits; a package may",
	RATE_MUL_RIGHT_MISSING_UNIT: "an opcode (RATE_MUL) no built-in parselet emits; a package may",
	REDUCE_EMPTY_COLLECTION: "an empty list, which no list literal or range the engine reads produces",
	STAT_EMPTY: "an empty list, which no list literal or range the engine reads produces",
	SWEEP_REQUIRES_VARIABLE_NAME: "a guard: the normaliser only fuses a sweep whose for is followed by a name",
	SYMBOLIC_DIVISION_BY_ZERO: "the exact rational layer's guard; the symbolic simplifier folds a line's division by zero before it reaches that layer",
	SYMBOLIC_NODE_LIMIT_EXCEEDED: "a tree past the node ceiling, which the nesting and complexity limits keep one line well below",
	SYMBOLIC_SOLVE_INCOMPLETE: "a guard: the numerical stage finds the remaining roots of every equation the solver accepts",
	TOO_MANY_FUNCTION_DEFINITIONS: "one line defines one function, far below the limit",
	UNEXPECTED_END: "a guard: the parser's own consume raises UNEXPECTED_END_OF_INPUT at the end of a line first",
	UNKNOWN_COLOUR_FUNCTION: "a guard: the normaliser only makes a colour call of a name the colour package has",
	UNKNOWN_CONSTANT: "a guard: each constant's parselet asks for its own name, which the table has",
	UNKNOWN_ENCODING: "a guard: the parselet only pushes the name of a decoder the package has",
	UNKNOWN_FUNCTION: "a guard: the call tokens that reach it are made only for names that exist",
	WHAT_IF_REQUIRES_VARIABLE_NAME: "a guard: the normaliser only fuses a what-if whose with is followed by a name",
};

/** Engine invariants and fallbacks: reaching one is a fault worth reporting. */
const ENGINE_INVARIANT: Readonly<Record<string, string>> = {
	DECIMAL_DIVISION_BY_ZERO: "an engine invariant: the operators refuse a zero divisor before the decimal layer sees one",
	DECIMAL_INVALID_SCALE: "an engine invariant inside the decimal layer",
	DECIMAL_NEGATIVE_POWER: "an engine invariant inside the decimal layer",
	EVALUATION_ERROR: "the fallback for a failure with no code of its own, which every current path supplies",
	HISTORICAL_CURRENCY_INVALID_OPERAND: "a historical conversion of a non-currency, which the parselet never emits",
	INTERNAL_MISSING_ANONYMOUS_BODY: "a compiled program naming a body it does not carry, which the compiler never emits",
	INTERNAL_MISSING_FUNCTION_BODY: "a compiled program naming a body it does not carry, which the compiler never emits",
	INTERNAL_RATIONAL_PARSE: "a number whose decimal form cannot be read back, which the reader covers for every finite double",
	INVALID_TIMECODE_UNIT: "a caller-contract fault: the engine checks isTimecodeUnit first",
	LINE_FAILED: "the batch pass's fallback for a failed line with no code, which every thrown failure now carries",
	MALFORMED_BYTECODE_BIGINT_LITERAL: "executeBytecode given a program the compiler did not produce",
	MALFORMED_BYTECODE_BODY_KIND: "executeBytecode given a program the compiler did not produce",
	MALFORMED_BYTECODE_CONSTANT_INDEX: "executeBytecode given a program the compiler did not produce",
	MALFORMED_BYTECODE_OPERAND_TYPE: "executeBytecode given a program the compiler did not produce",
	MALFORMED_BYTECODE_PROGRAM: "executeBytecode given something that is not a program",
	MALFORMED_BYTECODE_TRUNCATED: "executeBytecode given a program the compiler did not produce",
	MALFORMED_BYTECODE_UNKNOWN_OPCODE: "executeBytecode given a program the compiler did not produce",
	NORMALIZER_PASS_LIMIT_EXCEEDED: "a normaliser rule chain that never settles, which no built-in rule set has",
	PARSE_ERROR: "the generic parse failure a caller may wrap one in; the parser raises specific codes",
	STACK_UNDERFLOW: "corrupted bytecode or a faulty plugin, which the compiler never emits",
	UNEXPECTED_ERROR: "the fallback for a thrown value that is not an EngineError, which is an engine or package fault",
	UNEXPECTED_PENDING_RESULT: "a caller-contract fault inside the engine",
	UNKNOWN_BUILTIN_FUNCTION: "a compiled call to a built-in index none is registered at, which the compiler never emits",
	UNKNOWN_ERROR: "the fallback for a thrown value that is not an Error, which is an engine or package fault",
};

/** Every reason a code cannot come from a line, by kind. */
const NOT_FROM_A_LINE: Readonly<Record<string, string>> = {
	...HOST_API,
	...PACKAGE_AUTHORING,
	...LIVE_DATA,
	...BEHIND_A_PARSE_TIME_REFUSAL,
	...GUARDED_BEFORE_IT,
	...ENGINE_INVARIANT,
};

/** Every catalogued code, the patterns included. */
const CATALOGUED: readonly string[] = [...new Set(Object.values(ERROR_CODE_CATALOGUES).flatMap((catalogue) => Object.values(catalogue) as string[]))].sort();

/**
 * An engine for one example: live data off, any limit the example lowers,
 * and the stocks package (which the built-in set leaves out, since it needs a
 * provider) where the example is one of its forms.
 */
function engineFor(example: Exclude<Example, string> | undefined) {
	const config = { ...(example?.config ?? {}), network: { enabled: false } };
	return example?.stocks === true
		? newTrackedEngine({ config, packages: [...BUILTIN_PACKAGES, createStocksPackage()] })
		: newTrackedEngine({ config });
}

/** The code on an error value, or none. */
function codeOf(value: Value | null | undefined): string | undefined {
	return value !== null && value !== undefined && value.type === ValueType.Error ? String(value.value) : undefined;
}

/** The code a throw carries. */
function thrownCode(error: unknown): string {
	return String((error as { code?: unknown }).code);
}

/** Every code an example produces. */
function codesOf(example: Example): string[] {
	if (typeof example === "string" || "line" in example) {
		const line = typeof example === "string" ? example : example.line;
		const engine = engineFor(typeof example === "string" ? undefined : example);
		try {
			const code = codeOf(engine.evaluateExpression(line));
			return code === undefined ? [] : [code];
		} catch (error) {
			return [thrownCode(error)];
		}
	}
	const text = example.doc.join("\n");
	const engine = engineFor(example);
	let result: ParsingResult;
	try {
		result = example.pass === "evaluate" ? evaluateDocument(engine, text) : engine.parseDocument(text);
	} catch (error) {
		// A document refused whole, such as one past the line limit.
		return [thrownCode(error)];
	}
	const codes: string[] = [];
	for (const line of result.lines) {
		for (const code of [line.errorCode, codeOf(line.result)]) if (code) codes.push(code);
		for (const solve of line.inlineSolves) for (const code of [solve.errorCode, codeOf(solve.result)]) if (code) codes.push(code);
	}
	return codes;
}

describe("every catalogued code has an example or a reason no line produces it", () => {
	test("each code is in exactly one of the two", () => {
		const unaccounted = CATALOGUED.filter((code) => !Object.prototype.hasOwnProperty.call(EXAMPLES, code) && !Object.prototype.hasOwnProperty.call(NOT_FROM_A_LINE, code));
		const both = CATALOGUED.filter((code) => Object.prototype.hasOwnProperty.call(EXAMPLES, code) && Object.prototype.hasOwnProperty.call(NOT_FROM_A_LINE, code));
		expect({ unaccounted, both }).toEqual({ unaccounted: [], both: [] });
	});

	test("and neither names a code no catalogue lists", () => {
		const known = new Set(CATALOGUED);
		expect([...Object.keys(EXAMPLES), ...Object.keys(NOT_FROM_A_LINE)].filter((code) => !known.has(code))).toEqual([]);
	});

	test("every reason says what raises the code", () => {
		expect(Object.entries(NOT_FROM_A_LINE).filter(([, reason]) => reason.trim().length < 20)).toEqual([]);
	});

	test("most codes are ones a line can produce", () => {
		// A floor rather than a count, so a new reachable code does not need
		// this edited; it is here so the reasons cannot quietly become the
		// easy way to account for a code.
		expect(Object.keys(EXAMPLES).length).toBeGreaterThan(Object.keys(NOT_FROM_A_LINE).length * 2);
	});
});

describe("each example produces its code", () => {
	test.each(Object.entries(EXAMPLES))("%s", (code, example) => {
		expect(codesOf(example)).toContain(code);
	});
});
