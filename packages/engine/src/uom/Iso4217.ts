/**
 * Every active ISO 4217 currency code.
 *
 * This exists because `CurrencyExchange.isCurrency()` used to hold a
 * hand-written list of forty-six codes, and a code missing from it did not
 * error: `$100 in UAH` returned the original hundred dollars, unconverted, as
 * though the rate were 1. A wrong answer, not a missing feature.
 *
 * The list is the ISO 4217 active set, so "is this a currency" is answered by
 * the standard rather than by whichever codes happened to get added. Whether a
 * *rate* is available for one is a separate question, answered at resolution
 * time by whatever the exchange provider supports; conflating the two is what
 * produced the silent failure.
 *
 * Deliberately excluded:
 * - The historical/withdrawn codes (DEM, FRF, and the rest). They are not
 *   active, no provider quotes them, and recognising them would only move the
 *   failure later.
 * - The X-series non-currencies: XAU/XAG/XPT/XPD (metals), XDR (IMF special
 *   drawing rights), XTS (reserved for testing) and XXX (explicitly "no
 *   currency"). XXX in particular must never resolve.
 *
 * Cryptocurrencies are not here either. They are not ISO 4217 and are tracked
 * separately in `CurrencyExchangeService.CRYPTO_IDS`.
 */
export const ISO_4217_CODES: ReadonlySet<string> = new Set([
	"AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
	"BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BOV",
	"BRL", "BSD", "BTN", "BWP", "BYN", "BZD",
	"CAD", "CDF", "CHE", "CHF", "CHW", "CLF", "CLP", "CNY", "COP", "COU",
	"CRC", "CUP", "CVE", "CZK",
	"DJF", "DKK", "DOP", "DZD",
	"EGP", "ERN", "ETB", "EUR",
	"FJD", "FKP",
	"GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD",
	"HKD", "HNL", "HTG", "HUF",
	"IDR", "ILS", "INR", "IQD", "IRR", "ISK",
	"JMD", "JOD", "JPY",
	"KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT",
	"LAK", "LBP", "LKR", "LRD", "LSL", "LYD",
	"MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR",
	"MWK", "MXN", "MXV", "MYR", "MZN",
	"NAD", "NGN", "NIO", "NOK", "NPR", "NZD",
	"OMR",
	"PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG",
	"QAR",
	"RON", "RSD", "RUB", "RWF",
	"SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD",
	"SSP", "STN", "SVC", "SYP", "SZL",
	"THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS",
	"UAH", "UGX", "USD", "USN", "UYI", "UYU", "UYW", "UZS",
	"VED", "VES", "VND", "VUV",
	"WST",
	"XAF", "XCD", "XCG", "XOF", "XPF",
	"YER",
	"ZAR", "ZMW", "ZWG",
]);

/**
 * Whether `code` is an active ISO 4217 currency code.
 *
 * @param code - A three-letter code, in any case.
 */
export function isIso4217(code: string): boolean {
	return ISO_4217_CODES.has(code.toUpperCase());
}
