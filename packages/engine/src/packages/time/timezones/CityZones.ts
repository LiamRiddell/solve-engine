/**
 * The zone-name tables, re-exported from where they now live.
 *
 * They were written here, for the time package's timezone forms, and moved
 * unchanged to `calendar/ZoneNames.ts` when `<datetime> in <zone>` needed them
 * too: that form is answered in the VM, which may not import from `packages/`.
 * Re-exported rather than removed so the parselets and tests that import them
 * from this path are untouched, and so there is one table rather than two that
 * can drift apart. See `calendar/ZoneNames.ts` for the tables themselves and
 * for what each one covers.
 *
 * @module CityZones
 */

export {
  CITY_TO_IANA_ZONE,
  MULTI_WORD_CITY_ZONES,
  ZONE_ABBREVIATION_TO_IANA,
  ZONE_LOOKUP,
  resolveZoneName,
} from "@solve-js/calendar/ZoneNames";
