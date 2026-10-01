/**
 * Which built-in plugin functions answer at once, so their calls are allowed
 * inside a held expression.
 *
 * A held expression is one the engine keeps to run later or many times: a
 * function body (`f(s) = upper(s)`), a map or reduce transform, the expression
 * of `solve`, a plot. Each refuses a program that may wait for data, and a
 * plugin call marks its program so unless it is emitted as synchronous (see
 * `BytecodeBuilder.emitPluginCall`). Every built-in call site asks
 * {@link pluginCallOptions} for its options, so this list is the one place
 * that decides, and `__tests__/bugs/FoundBug_synchronousPluginCalls.spec.ts`
 * checks every name on it against its handler.
 *
 * A name is on the list when its handler never returns a promise and answers
 * from its arguments (and the engine's own settings: the clock, the time zone,
 * the random source). Two kinds are left off on purpose:
 *
 * - a lookup that waits for the network: weather, stocks, crypto, the
 *   knowledge lookups and a currency rate on a past date (`historicalCurrency`);
 * - a call that reads other lines of the document (line references, `prev`,
 *   the aggregates over lines, sections, tags and table columns, a table
 *   lookup, goal seek, what-if and scenarios). It does not wait, but a held
 *   expression is run away from the line that wrote it, where there is no
 *   document to read, so it keeps the mark and the refusal.
 *
 * @module SynchronousPluginFunctions
 */

import type { BytecodeBuilder, PluginCallOptions } from "@solve-js/parser/BytecodeBuilder";

/** The built-in plugin functions whose handlers answer at once, by package. */
export const SYNCHRONOUS_PLUGIN_FUNCTIONS: ReadonlySet<string> = new Set([
	// colour
	"color", "colour", "rgb", "rgba", "hsl", "hsla", "lighten", "darken", "saturate", "desaturate", "desat",
	"rotate", "spin", "adjusthue", "complement", "grayscale", "greyscale", "invert", "mix", "alpha", "opacity",
	"fade", "contrast", "luminance", "red", "green", "blue", "hue", "saturation", "lightness", "hsv", "hsb",
	"hsva", "hwb", "tint", "shade", "tone", "negate", "isdark", "islight", "readable", "contrastcolor",
	"contrastcolour", "iscontrastcompliant", "wcaglevel", "wcag",
	// conditionals
	"checkComparison", "checkLink", "checkBoth", "logicalNot",
	// constants
	"constantValue",
	// cooking
	"gasMarkToCelsius", "recipeScalingFactor",
	// datetime
	"workdaysInDuration", "weekdayOnDate", "toDateFromAny", "toTimestampFromAny", "datetimeLiteralGrain",
	"monthOnDate", "weekOnDate", "isWeekendOnDate", "isWorkdayOnDate", "spanBetweenDates", "weekdaysBetween",
	"nthWeekdayOfMonth", "monthAnchorShift", "ageBetween", "dateLiteralFault", "periodEdge", "thisWeekday", "monthThisYear",
	// encoding
	"base64", "jwt", "query", "fromEncoding",
	// finance
	"inflationFromYearToPresent", "inflationToYearFromPresent", "inflationToYearInCurrency",
	"inflationCountedAmount", "inflationFutureValue", "cashFlowNpv", "cashFlowIrr", "cashFlowPayback",
	// geo
	"geoAngle", "geoPlaceFromAngles", "geoPlace", "geoDistance", "geoBearing",
	// geometry
	"geometryCompute",
	// hash
	"hashMd5", "hashSha1", "hashSha256", "hashSha512", "hashCrc32",
	// health
	"healthBmi", "healthPace", "healthSpeed",
	// ip
	"ipLiteral", "ipv6Literal", "hostsIn", "netmaskOf", "broadcastOf", "networkOf", "lastAddressOf", "ipInCidr",
	// numerals
	"romanFromString",
	// payroll
	"payrollTakeHome", "payrollTakeHomeMonthly", "payrollHourly", "payrollTakeHomeAtRate",
	// random
	"randomUuid", "randomCoin", "randomHex", "randomPick", "randomShuffle",
	// ratio
	"ratioReduce",
	// shopping
	"shoppingCompare",
	// statistics
	"statCorrelation", "statSlope", "statIntercept", "statRSquared", "statPercentile", "statZScore",
	"statNormalCdf", "statNormalPdf", "statNormalInv", "statInvNorm", "statBinomPdf", "statBinomCdf",
	"statPoissonPdf", "statPoissonCdf", "statTPdf", "statTCdf", "statTInv", "statInvT", "statErf", "statErfc",
	"statGamma", "statLGamma",
	// symbolic
	"symbolicLimit",
	// text
	"textLength", "textWordCount", "textCharCount", "textLineCount", "textTrim", "textReverse", "textUpper",
	"textLower", "textTitle", "textSlug", "textContains", "textStartsWith", "textEndsWith", "textReplace",
	"textRepeat", "textNumbers", "textAmounts", "textExtractAggregate", "textMatch", "textMatches",
	"textMatchCount", "textField",
	// time
	"zoneConvert", "zoneConvertAt", "zoneConvertNamed", "timeInZone", "dateInZone", "timeDifference",
	"clockTimeOnDate", "hoursOverlap", "isoDurationFault",
	// travel
	"tripCost", "tripFuel",
	// uom
	"cookingConvert",
	// web
	"aspectRatio", "atPixelDensity", "atRootFontSize", "resizeDimensions",
]);

/**
 * The built-in plugin functions that read other lines of the document: the
 * line references, `prev` and the totals above or over a section, the table
 * columns and lookups, the tag aggregates, goal seek, what-if and scenarios.
 * Their calls carry `readsDocument`, so a function body that makes one is
 * refused as reading lines (`FUNCTION_BODY_READS_LINES`), not as waiting for
 * data: `f(x) = x + prev` waits for nothing.
 */
export const DOCUMENT_READING_PLUGIN_FUNCTIONS: ReadonlySet<string> = new Set([
	// lines
	"prev", "lineRef", "sumRange", "averageRange", "totalAbove", "averageAbove", "countAbove", "minAbove",
	"maxAbove", "medianAbove", "columnTotal", "sectionSum", "sectionAverage", "sectionCount",
	// goal seek
	"goalseek",
	// tables
	"TABLE_COLUMN_SUM", "TABLE_COLUMN_AVERAGE", "TABLE_COLUMN_MIN", "TABLE_COLUMN_MAX", "TABLE_COLUMN_COUNT",
	"TABLE_COLUMN_MEDIAN", "TABLE_COLUMN_STDEV", "TABLE_COLUMN_SAMPLE_STDEV", "TABLE_COLUMN_VARIANCE",
	"TABLE_COLUMN_SAMPLE_VARIANCE", "TABLE_COLUMN_SPREAD", "TABLE_COLUMN_MODE", "TABLE_ROW_LOOKUP",
	"TABLE_BAND_LOOKUP", "TABLE_THROUGH_BANDS",
	// tags
	"sum", "average", "count", "tagBreakdown",
	// what-if
	"whatif", "sweep", "scenariodeclare", "scenarioread",
]);

/** The options of a call that reads other lines of the document. */
const READS_DOCUMENT: PluginCallOptions = Object.freeze({ readsDocument: true });

/** The options of a call that answers at once. */
const SYNCHRONOUS: PluginCallOptions = Object.freeze({ synchronous: true });

/** The options of a call that may wait or reads the document: none, so it marks its program. */
const MAY_WAIT: PluginCallOptions = Object.freeze({});

/**
 * The options a built-in call site passes to `emitPluginCall` for the plugin
 * function it names: synchronous when the name is on
 * {@link SYNCHRONOUS_PLUGIN_FUNCTIONS}, reading the document when it is on
 * {@link DOCUMENT_READING_PLUGIN_FUNCTIONS}, otherwise none.
 *
 * @param name - The plugin function's registered name.
 * @returns `{ synchronous: true }`, `{ readsDocument: true }`, or `{}`.
 */
export function pluginCallOptions(name: string): PluginCallOptions {
	if (SYNCHRONOUS_PLUGIN_FUNCTIONS.has(name)) return SYNCHRONOUS;
	return DOCUMENT_READING_PLUGIN_FUNCTIONS.has(name) ? READS_DOCUMENT : MAY_WAIT;
}

/**
 * Emits a built-in package's plugin call with the options
 * {@link pluginCallOptions} gives its name, so a call whose handler answers at
 * once is allowed inside a held expression and one that may wait is not.
 *
 * @param builder - The builder to emit into.
 * @param name - The plugin function's registered name.
 * @param argCount - How many values the call takes from the stack.
 */
export function emitBuiltinPluginCall(builder: BytecodeBuilder, name: string, argCount: number): void {
	builder.emitPluginCall(name, argCount, pluginCallOptions(name));
}
