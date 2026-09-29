/**
 * Every error code the engine and its built-in packages answer with, gathered
 * in one place a host can read (#769).
 *
 * An error code is the stable name a host branches on when a line fails
 * (`INCOMPATIBLE_UNITS`, `NO_PREFIX_PARSELET`), where the message beside it is
 * prose for a person and may be reworded in any release. A code a host can
 * receive keeps its name (see the versioning guide), so this list only grows.
 *
 * Each catalogue is the one its layer or package exports, keyed by its own
 * export name, and each maps a code to itself:
 * `ERROR_CODE_CATALOGUES.FinanceErrorCodes.IRR_NONE` is `"IRR_NONE"`. The one
 * exception is `QueryResolverErrorCodePatterns`, whose values are patterns
 * for codes named at run time; see {@link isCataloguedErrorCode}. The error
 * code reference in the documentation is generated from these same
 * catalogues, with a sentence for each code.
 *
 * A package outside this repository is free to answer with codes of its own:
 * the list is what the engine ships, not a closed set.
 */
import { CoreErrorCodes } from "@solve-js/errors/ErrorCode";
import { DatetimeZoneErrorCodes } from "@solve-js/errors/ErrorCode";
import { CurrencyErrorCodes } from "@solve-js/uom/CurrencyExchange";
import { HistoricalCurrencyErrorCodes } from "@solve-js/uom/HistoricalCurrency";
import { SnapshotErrorCodes } from "@solve-js/engine/EngineSnapshot";
import { DefineFunctionErrorCodes } from "@solve-js/api/defineFunction";
import { WorkerErrorCodes } from "@solve-js/errors/WorkerError";
import { QueryResolverErrorCodePatterns } from "@solve-js/resolvers/QueryResolverErrorCodes";
import { ChartErrorCodes } from "@solve-js/packages/chart/ChartErrorCodes";
import { ColourErrorCodes } from "@solve-js/packages/colour/ColourPluginFunctions";
import { ConditionalsErrorCodes } from "@solve-js/packages/conditionals/ConditionalsErrorCodes";
import { ConstantsErrorCodes } from "@solve-js/packages/constants/ConstantsErrorCodes";
import { ConvertersErrorCodes } from "@solve-js/packages/converters/ConvertersErrorCodes";
import { CookingErrorCodes } from "@solve-js/packages/cooking/CookingPackage";
import { CryptoErrorCodes } from "@solve-js/packages/crypto/CryptoErrorCodes";
import { DateFormErrorCodes } from "@solve-js/packages/datetime/DateFormErrorCodes";
import { DatetimeErrorCodes } from "@solve-js/packages/datetime/DateReading";
import { DerivedUnitsErrorCodes } from "@solve-js/packages/derived/DerivedUnitsErrorCodes";
import { EncodingErrorCodes } from "@solve-js/packages/encoding/EncodingErrorCodes";
import { FinanceErrorCodes } from "@solve-js/packages/finance/FinanceErrorCodes";
import { GeoErrorCodes } from "@solve-js/packages/geo/GeoPackage";
import { GeometryErrorCodes } from "@solve-js/packages/geometry/GeometryErrorCodes";
import { GoalSeekErrorCodes } from "@solve-js/packages/goalseek/GoalSeekErrorCodes";
import { HashErrorCodes } from "@solve-js/packages/hash/HashErrorCodes";
import { HealthErrorCodes } from "@solve-js/packages/health/HealthErrorCodes";
import { IpErrorCodes } from "@solve-js/packages/ip/IpErrorCodes";
import { KnowledgeErrorCodes } from "@solve-js/packages/knowledge/KnowledgeErrorCodes";
import { LinesErrorCodes } from "@solve-js/packages/lines/LinesErrorCodes";
import { MapReduceErrorCodes } from "@solve-js/packages/mapreduce/MapReduceErrorCodes";
import { MathPhrasesErrorCodes } from "@solve-js/packages/mathphrases/MathPhrasesErrorCodes";
import { MatrixErrorCodes } from "@solve-js/packages/matrix/MatrixErrorCodes";
import { NumeralsErrorCodes } from "@solve-js/packages/numerals/NumeralsErrorCodes";
import { PayrollErrorCodes } from "@solve-js/packages/payroll/PayrollPackage";
import { PercentageErrorCodes } from "@solve-js/packages/percentage/PercentageErrorCodes";
import { RandomErrorCodes } from "@solve-js/packages/random/RandomErrorCodes";
import { RatioErrorCodes } from "@solve-js/packages/ratio/RatioErrorCodes";
import { RecurringScheduleErrorCodes } from "@solve-js/packages/finance/normalizer/RecurringScheduleNormalizerRule";
import { ShoppingErrorCodes } from "@solve-js/packages/shopping/ShoppingErrorCodes";
import { StatisticsErrorCodes } from "@solve-js/packages/statistics/StatisticsErrorCodes";
import { StocksErrorCodes } from "@solve-js/packages/stocks/StocksErrorCodes";
import { SymbolicErrorCodes } from "@solve-js/packages/symbolic/SymbolicErrorCodes";
import { TablesErrorCodes } from "@solve-js/packages/tables/TablesPluginFunctions";
import { TagsErrorCodes } from "@solve-js/packages/tags/TagsErrorCodes";
import { TextExtractionErrorCodes } from "@solve-js/packages/text/TextExtractionFunctions";
import { TimeFormErrorCodes } from "@solve-js/packages/time/TimeFormErrorCodes";
import { TimezoneErrorCodes } from "@solve-js/packages/time/parselets/TimezonePluginFunctions";
import { TravelErrorCodes } from "@solve-js/packages/travel/TravelPackage";
import { UomErrorCodes } from "@solve-js/packages/uom/UomErrorCodes";
import { VariablesErrorCodes } from "@solve-js/packages/variables/VariablesErrorCodes";
import { WeatherErrorCodes } from "@solve-js/packages/weather/OpenMeteoClient";
import { WebErrorCodes } from "@solve-js/packages/web/WebPackage";
import { WhatIfErrorCodes } from "@solve-js/packages/whatif/WhatIfErrorCodes";

/**
 * Every catalogue, keyed by its export name: the engine's own layers first,
 * then the built-in packages alphabetically.
 */
export const ERROR_CODE_CATALOGUES = {
	CoreErrorCodes,
	DatetimeZoneErrorCodes,
	CurrencyErrorCodes,
	HistoricalCurrencyErrorCodes,
	SnapshotErrorCodes,
	DefineFunctionErrorCodes,
	WorkerErrorCodes,
	QueryResolverErrorCodePatterns,
	ChartErrorCodes,
	ColourErrorCodes,
	ConditionalsErrorCodes,
	ConstantsErrorCodes,
	ConvertersErrorCodes,
	CookingErrorCodes,
	CryptoErrorCodes,
	DateFormErrorCodes,
	DatetimeErrorCodes,
	DerivedUnitsErrorCodes,
	EncodingErrorCodes,
	FinanceErrorCodes,
	GeoErrorCodes,
	GeometryErrorCodes,
	GoalSeekErrorCodes,
	HashErrorCodes,
	HealthErrorCodes,
	IpErrorCodes,
	KnowledgeErrorCodes,
	LinesErrorCodes,
	MapReduceErrorCodes,
	MathPhrasesErrorCodes,
	MatrixErrorCodes,
	NumeralsErrorCodes,
	PayrollErrorCodes,
	PercentageErrorCodes,
	RandomErrorCodes,
	RatioErrorCodes,
	RecurringScheduleErrorCodes,
	ShoppingErrorCodes,
	StatisticsErrorCodes,
	StocksErrorCodes,
	SymbolicErrorCodes,
	TablesErrorCodes,
	TagsErrorCodes,
	TextExtractionErrorCodes,
	TimeFormErrorCodes,
	TimezoneErrorCodes,
	TravelErrorCodes,
	UomErrorCodes,
	VariablesErrorCodes,
	WeatherErrorCodes,
	WebErrorCodes,
	WhatIfErrorCodes,
} as const;

/**
 * The run-time patterns in {@link ERROR_CODE_CATALOGUES} as expressions:
 * `<NAMESPACE>` matches a namespace upper-cased (letters, digits, hyphens and
 * underscores).
 */
const PATTERNS: readonly RegExp[] = Object.values(QueryResolverErrorCodePatterns).map(
	(pattern) => new RegExp(`^${pattern.replace("<NAMESPACE>", "[A-Z0-9][A-Z0-9_-]*")}$`),
);

/** Every code in {@link ERROR_CODE_CATALOGUES} except the patterns, built on first use. */
let known: ReadonlySet<string> | undefined;

/**
 * Whether the engine or a built-in package can answer with `code`: it is in
 * one of the catalogues, or it matches a run-time pattern such as
 * `<NAMESPACE>_QUERY_FAILED`.
 *
 * A host uses it to tell a code it should expect to handle from one a
 * third-party package minted, or from a typo in its own branching.
 *
 * @param code - The code, as read from `EngineError.code` or `Value.errorCode`.
 * @returns True for a catalogued code or one matching a pattern.
 */
export function isCataloguedErrorCode(code: string): boolean {
	if (typeof code !== "string") return false;
	if (known === undefined) {
		const codes = new Set<string>();
		for (const [name, catalogue] of Object.entries(ERROR_CODE_CATALOGUES)) {
			if (name === "QueryResolverErrorCodePatterns") continue;
			for (const value of Object.values(catalogue)) codes.add(value);
		}
		known = codes;
	}
	return known.has(code) || PATTERNS.some((pattern) => pattern.test(code));
}
