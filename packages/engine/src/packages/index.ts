// Every built-in package, so a host building a slim engine can register any
// one the docs name (#556), and the full list for the rest.
export {
	ARITHMETIC_PACKAGE,
	PERCENTAGE_PACKAGE,
	FUNCTION_PACKAGE,
	DATETIME_PACKAGE,
	TIME_PACKAGE,
	DICE_PACKAGE,
	VARIABLES_PACKAGE,
	GLOBAL_VARIABLES_PACKAGE,
	UOM_PACKAGE,
	CURRENCY_PACKAGE,
	VECTOR_PACKAGE,
	MATRIX_PACKAGE,
	MAPREDUCE_PACKAGE,
	SYMBOLIC_PACKAGE,
	BIGINT_PACKAGE,
	CONDITIONALS_PACKAGE,
	CONVERTERS_PACKAGE,
	MATHPHRASES_PACKAGE,
	FINANCE_PACKAGE,
	PAYROLL_PACKAGE,
	SHOPPING_PACKAGE,
	UNCERTAINTY_PACKAGE,
	WEATHER_PACKAGE,
	createStocksPackage,
	createCryptoPackage,
	createCurrencyPackage,
	createKnowledgePackage,
	LINES_PACKAGE,
	GOALSEEK_PACKAGE,
	TABLES_PACKAGE,
	COLOUR_PACKAGE,
	CHART_PACKAGE,
	ENCODING_PACKAGE,
	IP_PACKAGE,
	COOKING_PACKAGE,
	FUEL_PACKAGE,
	TRAVEL_PACKAGE,
	WEB_PACKAGE,
	DERIVED_UNITS_PACKAGE,
	TAGS_PACKAGE,
	TEXT_PACKAGE,
	HASH_PACKAGE,
	RANDOM_PACKAGE,
	STATISTICS_PACKAGE,
	NUMERALS_PACKAGE,
	RATIO_PACKAGE,
	GEOMETRY_PACKAGE,
	CONSTANTS_PACKAGE,
	HEALTH_PACKAGE,
	GEO_PACKAGE,
	BUILTIN_PACKAGES,
} from "./builtins";

export type { IVector2 } from "./vector/IVector2";
export type { IVector3 } from "./vector/IVector3";
export type { IVector4 } from "./vector/IVector4";

export type { CurrencyPackageConfig } from "./currency";
export type { HistoricalRateProvider } from "@solve-js/uom/HistoricalCurrency";
export type { StocksPackageConfig, StockQuote, StockHistoricalQuote } from "./stocks";
export type { KnowledgePackageConfig } from "./knowledge";
export type { CityWeather, WeatherQueryKind } from "./weather";
