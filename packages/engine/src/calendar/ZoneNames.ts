/**
 * The names a reader can call a time zone by, and the IANA identifier each
 * resolves to.
 *
 * The tables were written for the time package's timezone forms and lived in
 * `packages/time/timezones/CityZones.ts`, which still re-exports every one of
 * them so nothing that imported them there changed. They moved here because
 * `<datetime> in <zone>` is answered in the VM, which may not import from
 * `packages/`, and because two copies of a name table is how two spellings of
 * one question come to disagree.
 *
 * An IANA identifier is never typed directly: `2026-04-03 in Asia/Tokyo` lexes
 * the slash as division and does not reach a zone at all. The names below are
 * what a reader actually writes.
 *
 * @module ZoneNames
 */

import { encodeFixedOffset } from "./IntlZone";

/**
 * City/country/abbreviation name -> IANA timezone identifier.
 *
 * Scoped to ~80 major cities, common standard-time abbreviations, and a
 * handful of countries (mapped to their capital's zone, per SoulverCore's
 * own documented convention for countries spanning multiple zones)
 * deliberately not exhaustive. Additive: extend this table as gaps are
 * found, no other code needs to change.
 *
 * Keys are lowercase. Single-word entries are looked up directly against
 * a bare `IDENT` token's text; multi-word entries (see
 * {@link MULTI_WORD_CITY_ZONES}) are looked up the same way, but only
 * after `TimePackage.ts`'s `phrases` field has fused them into one token.
 *
 * Abbreviations are inherently ambiguous (PST/CST/EST/etc. don't
 * self-describe standard vs. daylight time, and some collide with other
 * meanings, e.g. IST is also used for Irish/Israel Standard Time). This
 * table picks the single most common convention for each, matching how
 * every comparable calculator tool resolves the same ambiguity, not
 * claimed as the only valid reading.
 */
export const CITY_TO_IANA_ZONE: Record<string, string> = {
  // ── Oceania ──
  sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne",
  brisbane: "Australia/Brisbane",
  perth: "Australia/Perth",
  adelaide: "Australia/Adelaide",
  canberra: "Australia/Sydney",
  auckland: "Pacific/Auckland",
  wellington: "Pacific/Auckland",
  fiji: "Pacific/Fiji",

  // ── North America ──
  chicago: "America/Chicago",
  seattle: "America/Los_Angeles",
  denver: "America/Denver",
  phoenix: "America/Phoenix",
  toronto: "America/Toronto",
  montreal: "America/Toronto",
  vancouver: "America/Vancouver",
  ottawa: "America/Toronto",
  honolulu: "Pacific/Honolulu",
  anchorage: "America/Anchorage",
  miami: "America/New_York",
  boston: "America/New_York",
  atlanta: "America/New_York",
  dallas: "America/Chicago",
  houston: "America/Chicago",

  // ── South America ──
  lima: "America/Lima",
  bogota: "America/Bogota",
  caracas: "America/Caracas",
  santiago: "America/Santiago",
  montevideo: "America/Montevideo",
  quito: "America/Guayaquil",

  // ── Europe ──
  london: "Europe/London",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  madrid: "Europe/Madrid",
  rome: "Europe/Rome",
  amsterdam: "Europe/Amsterdam",
  dublin: "Europe/Dublin",
  lisbon: "Europe/Lisbon",
  vienna: "Europe/Vienna",
  zurich: "Europe/Zurich",
  geneva: "Europe/Zurich",
  moscow: "Europe/Moscow",
  istanbul: "Europe/Istanbul",
  athens: "Europe/Athens",
  stockholm: "Europe/Stockholm",
  oslo: "Europe/Oslo",
  helsinki: "Europe/Helsinki",
  warsaw: "Europe/Warsaw",
  prague: "Europe/Prague",
  budapest: "Europe/Budapest",
  brussels: "Europe/Brussels",
  copenhagen: "Europe/Copenhagen",
  reykjavik: "Atlantic/Reykjavik",
  kiev: "Europe/Kyiv",
  kyiv: "Europe/Kyiv",

  // ── Asia ──
  tokyo: "Asia/Tokyo",
  osaka: "Asia/Tokyo",
  beijing: "Asia/Shanghai",
  shanghai: "Asia/Shanghai",
  seoul: "Asia/Seoul",
  singapore: "Asia/Singapore",
  bangkok: "Asia/Bangkok",
  jakarta: "Asia/Jakarta",
  manila: "Asia/Manila",
  mumbai: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  bangalore: "Asia/Kolkata",
  dubai: "Asia/Dubai",
  abudhabi: "Asia/Dubai",
  karachi: "Asia/Karachi",
  dhaka: "Asia/Dhaka",
  hanoi: "Asia/Ho_Chi_Minh",
  taipei: "Asia/Taipei",
  islamabad: "Asia/Karachi",
  riyadh: "Asia/Riyadh",
  telaviv: "Asia/Jerusalem",
  jerusalem: "Asia/Jerusalem",

  // ── Africa ──
  cairo: "Africa/Cairo",
  lagos: "Africa/Lagos",
  nairobi: "Africa/Nairobi",
  johannesburg: "Africa/Johannesburg",
  casablanca: "Africa/Casablanca",
  accra: "Africa/Accra",
  tunis: "Africa/Tunis",
  addisababa: "Africa/Addis_Ababa",

  // ── Countries (capital's zone. See doc comment) ──
  france: "Europe/Paris",
  germany: "Europe/Berlin",
  spain: "Europe/Madrid",
  italy: "Europe/Rome",
  japan: "Asia/Tokyo",
  china: "Asia/Shanghai",
  india: "Asia/Kolkata",
  brazil: "America/Sao_Paulo",
  russia: "Europe/Moscow",
  australia: "Australia/Sydney",
  canada: "America/Toronto",
  mexico: "America/Mexico_City",
  uk: "Europe/London",
  usa: "America/New_York",
  ireland: "Europe/Dublin",
  netherlands: "Europe/Amsterdam",
  sweden: "Europe/Stockholm",
  norway: "Europe/Oslo",
  poland: "Europe/Warsaw",
  turkey: "Europe/Istanbul",
  egypt: "Africa/Cairo",
  nigeria: "Africa/Lagos",
  // "singapore" (the city entry above) already covers the country too
  // Singapore is a city-state, one zone either way, no separate entry needed.
};

/**
 * Multi-word city/country names, fused into a single `CITY_NAME` token
 * by `TimePackage.ts`'s `phrases` field before parsing, since
 * {@link CITY_TO_IANA_ZONE} lookups only ever see one already-tokenized
 * word. Keys here double as the phrase text registered with the fuser;
 * the resolved zone lives in {@link CITY_TO_IANA_ZONE} under the same
 * (lowercase, space-separated) key.
 */
export const MULTI_WORD_CITY_ZONES: Record<string, string> = {
  "new york": "America/New_York",
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  "las vegas": "America/Los_Angeles",
  "mexico city": "America/Mexico_City",
  "hong kong": "Asia/Hong_Kong",
  "kuala lumpur": "Asia/Kuala_Lumpur",
  "sao paulo": "America/Sao_Paulo",
  "buenos aires": "America/Argentina/Buenos_Aires",
  "rio de janeiro": "America/Sao_Paulo",
  "cape town": "Africa/Johannesburg",
  "new delhi": "Asia/Kolkata",
  "united kingdom": "Europe/London",
  "united states": "America/New_York",
  "south africa": "Africa/Johannesburg",
};

/** Standard-time-zone abbreviations. See the doc comment above on ambiguity. */
export const ZONE_ABBREVIATION_TO_IANA: Record<string, string> = {
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
  est: "America/New_York",
  edt: "America/New_York",
  cst: "America/Chicago",
  cdt: "America/Chicago",
  mst: "America/Denver",
  mdt: "America/Denver",
  hst: "Pacific/Honolulu",
  bst: "Europe/London",
  cet: "Europe/Paris",
  cest: "Europe/Paris",
  jst: "Asia/Tokyo",
  ist: "Asia/Kolkata",
  aest: "Australia/Sydney",
  aedt: "Australia/Sydney",
};

/** Merged single-word lookup table used by `tryConsumeZoneReference`. */
export const ZONE_LOOKUP: Record<string, string> = {
  ...CITY_TO_IANA_ZONE,
  ...MULTI_WORD_CITY_ZONES,
  ...ZONE_ABBREVIATION_TO_IANA,
};

/**
 * Resolve a name a reader typed to a zone reference, or `null` when the name
 * is not a zone this engine knows.
 *
 * Case-insensitive, over the same {@link ZONE_LOOKUP} the time package's
 * timezone forms read, so `time in Tokyo` and `2026-04-03 in Tokyo` cannot
 * resolve `Tokyo` to two different places. `utc` and `gmt` on their own are
 * the zero fixed offset, matching what `tryConsumeZoneReference` makes of a
 * bare `GMT`; the signed `GMT+9` spelling is a multi-token form only that
 * parselet can read, and is out of reach here.
 *
 * @param name - The name as typed.
 * @returns An IANA identifier or a fixed-offset reference, or null.
 */
export function resolveZoneName(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (lower === "utc" || lower === "gmt") return encodeFixedOffset(0);
  return ZONE_LOOKUP[lower] ?? null;
}
